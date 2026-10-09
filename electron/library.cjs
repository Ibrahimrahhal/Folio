const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const JSZip = require('jszip');
const { XMLParser } = require('fast-xml-parser');

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COVER_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'];

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
});

function createLibrary(root) {
  const writeQueues = new Map();

  function assertId(id) {
    if (!ID_RE.test(String(id || ''))) {
      throw new Error('Invalid book id.');
    }
    return id;
  }

  function bookDir(id) {
    return path.join(root, assertId(id));
  }

  async function ensureRoot() {
    await fs.promises.mkdir(root, { recursive: true });
  }

  async function writeJsonAtomic(file, data) {
    const dir = path.dirname(file);
    await fs.promises.mkdir(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    const bak = `${file}.bak`;
    await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fs.promises.rm(bak, { force: true });
    try {
      await fs.promises.rename(file, bak);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      await fs.promises.rename(tmp, file);
    } catch (error) {
      try {
        await fs.promises.copyFile(tmp, file);
        await fs.promises.rm(tmp, { force: true });
      } catch (copyError) {
        throw error;
      }
    }
    await fs.promises.rm(bak, { force: true });
  }

  async function readJson(file) {
    try {
      return JSON.parse(await fs.promises.readFile(file, 'utf8'));
    } catch {
      try {
        return JSON.parse(await fs.promises.readFile(`${file}.bak`, 'utf8'));
      } catch {
        return null;
      }
    }
  }

  async function readMeta(id) {
    return readJson(path.join(bookDir(id), 'meta.json'));
  }

  function enqueue(id, task) {
    const prev = writeQueues.get(id) || Promise.resolve();
    const run = prev.then(task, task);
    writeQueues.set(id, run.then(() => {}, () => {}));
    return run;
  }

  function updateMeta(id, patch) {
    assertId(id);
    return enqueue(id, async () => {
      const current = await readMeta(id);
      if (!current) throw new Error('Book not found.');
      const next = { ...current, ...patch };
      if (patch.location) {
        next.location = { ...(current.location || {}), ...patch.location };
      }
      await writeJsonAtomic(path.join(bookDir(id), 'meta.json'), next);
      return toPublic(next);
    });
  }

  function toPublic(meta) {
    return {
      id: meta.id,
      title: meta.title,
      author: meta.author || '',
      format: meta.format,
      filename: meta.filename,
      addedAt: meta.addedAt,
      lastReadAt: meta.lastReadAt || null,
      percentage: clamp01(meta.percentage),
      location: meta.location || {},
      pageCount: meta.pageCount || meta.location?.pageCount || null,
      hasCover: !!meta.hasCover,
      coverUpdatedAt: meta.coverUpdatedAt || null,
      enriched: !!meta.enriched,
      titleFromFile: !!meta.titleFromFile,
    };
  }

  async function listBooks() {
    await ensureRoot();
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    const books = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !ID_RE.test(entry.name)) continue;
      const meta = await readMeta(entry.name);
      if (meta) books.push(toPublic(meta));
    }
    books.sort((a, b) => {
      const ta = Date.parse(a.lastReadAt || a.addedAt || 0);
      const tb = Date.parse(b.lastReadAt || b.addedAt || 0);
      return tb - ta;
    });
    return books;
  }

  async function getBook(id) {
    const meta = await readMeta(id);
    if (!meta) return null;
    return toPublic(meta);
  }

  async function importFromPath(filePath) {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) throw new Error('Choose a file, not a folder.');
    if (stat.size === 0) throw new Error('That file is empty.');
    const originalName = path.basename(filePath);
    const id = crypto.randomUUID();
    const dir = path.join(root, id);
    const ext = path.extname(originalName).toLowerCase();
    const format = formatFor(ext);
    if (!format) throw new Error('Choose a PDF, EPUB, or Markdown file.');
    const storedName = `source${ext}`;
    await fs.promises.mkdir(dir, { recursive: true });
    try {
      await fs.promises.copyFile(filePath, path.join(dir, storedName));
      return await finalizeBook({ id, dir, storedName, originalName, format });
    } catch (error) {
      await fs.promises.rm(dir, { recursive: true, force: true });
      throw error;
    }
  }

  async function importFromBytes(name, bytes) {
    const originalName = path.basename(String(name || 'book'));
    const ext = path.extname(originalName).toLowerCase();
    const format = formatFor(ext);
    if (!format) throw new Error('Choose a PDF, EPUB, or Markdown file.');
    const buffer = Buffer.from(bytes);
    if (buffer.length === 0) throw new Error('That file is empty.');
    const id = crypto.randomUUID();
    const dir = path.join(root, id);
    const storedName = `source${ext}`;
    await fs.promises.mkdir(dir, { recursive: true });
    try {
      await fs.promises.writeFile(path.join(dir, storedName), buffer);
      return await finalizeBook({ id, dir, storedName, originalName, format });
    } catch (error) {
      await fs.promises.rm(dir, { recursive: true, force: true });
      throw error;
    }
  }

  async function finalizeBook({ id, dir, storedName, originalName, format }) {
    const storedPath = path.join(dir, storedName);
    let title = titleFromFilename(originalName);
    let author = '';
    let hasCover = false;
    let titleFromFile = true;

    if (format === 'md') {
      const heading = await markdownTitle(storedPath);
      if (heading) {
        title = heading;
        titleFromFile = false;
      }
    }

    if (format === 'epub') {
      try {
        const extracted = await extractEpub(storedPath, dir);
        if (extracted.title) {
          title = extracted.title;
          titleFromFile = false;
        }
        if (extracted.author) author = extracted.author;
        hasCover = extracted.hasCover;
      } catch {
        // The file is still copied. The reader reports it if the EPUB itself is unreadable.
      }
    }

    const now = new Date().toISOString();
    const meta = {
      id,
      title,
      author,
      format,
      filename: originalName,
      storedName,
      addedAt: now,
      lastReadAt: null,
      percentage: 0,
      location: {},
      pageCount: null,
      hasCover,
      coverUpdatedAt: hasCover ? now : null,
      enriched: format !== 'pdf',
      titleFromFile,
    };
    await writeJsonAtomic(path.join(dir, 'meta.json'), meta);
    return toPublic(meta);
  }

  async function readBook(id) {
    const meta = await readMeta(id);
    if (!meta) throw new Error('Book not found.');
    const file = path.join(bookDir(id), meta.storedName);
    try {
      const bytes = await fs.promises.readFile(file);
      return { bytes, book: toPublic(meta) };
    } catch {
      throw new Error('The copied book file is missing.');
    }
  }

  function coverPath(id) {
    const dir = bookDir(id);
    if (!fs.existsSync(dir)) return null;
    for (const ext of COVER_EXTS) {
      const file = path.join(dir, `cover${ext}`);
      if (fs.existsSync(file)) return file;
    }
    return null;
  }

  async function saveCover(id, bytes, mime) {
    assertId(id);
    const dir = bookDir(id);
    const meta = await readMeta(id);
    if (!meta) throw new Error('Book not found.');
    const ext = extFromMime(mime);
    const existing = await fs.promises.readdir(dir);
    await Promise.all(existing.filter((name) => name.startsWith('cover.')).map((name) => (
      fs.promises.rm(path.join(dir, name), { force: true })
    )));
    await fs.promises.writeFile(path.join(dir, `cover${ext}`), Buffer.from(bytes));
    return updateMeta(id, {
      hasCover: true,
      coverUpdatedAt: new Date().toISOString(),
    });
  }

  function saveProgress(id, progress) {
    const percentage = clamp01(progress?.percentage);
    const location = {};
    if (Number.isInteger(progress?.pdfPage) && progress.pdfPage > 0) location.pdfPage = progress.pdfPage;
    if (Number.isInteger(progress?.pageCount) && progress.pageCount > 0) location.pageCount = progress.pageCount;
    if (typeof progress?.cfi === 'string' && progress.cfi) location.cfi = progress.cfi;
    if (typeof progress?.scrollRatio === 'number' && Number.isFinite(progress.scrollRatio)) {
      location.scrollRatio = clamp01(progress.scrollRatio);
    }
    if (typeof progress?.zoom === 'number' && Number.isFinite(progress.zoom)) {
      location.zoom = clampZoom(progress.zoom);
    }
    const patch = {
      percentage,
      location,
      lastReadAt: new Date().toISOString(),
    };
    if (location.pageCount) patch.pageCount = location.pageCount;
    return updateMeta(id, patch);
  }

  function patchBook(id, patch) {
    const next = {};
    if (typeof patch?.title === 'string' && patch.title.trim()) next.title = cleanTitle(patch.title);
    if (typeof patch?.author === 'string') next.author = cleanTitle(patch.author);
    if (Number.isInteger(patch?.pageCount) && patch.pageCount > 0 && patch.pageCount < 100000) {
      next.pageCount = patch.pageCount;
    }
    if (patch?.titleFromFile === false) next.titleFromFile = false;
    if (patch?.enriched === true) next.enriched = true;
    return updateMeta(id, next);
  }

  async function removeBook(id) {
    assertId(id);
    await fs.promises.rm(bookDir(id), { recursive: true, force: true });
    return true;
  }

  async function readSidecar(id, name) {
    assertSidecar(name);
    try {
      return await fs.promises.readFile(path.join(bookDir(id), `${name}.json`), 'utf8');
    } catch {
      return null;
    }
  }

  async function writeSidecar(id, name, text) {
    assertSidecar(name);
    if (typeof text !== 'string') throw new Error('Sidecar must be text.');
    const file = path.join(bookDir(id), `${name}.json`);
    await writeTextAtomic(file, text);
    return true;
  }

  return {
    root,
    listBooks,
    getBook,
    importFromPath,
    importFromBytes,
    readBook,
    coverPath,
    saveCover,
    saveProgress,
    patchBook,
    removeBook,
    readSidecar,
    writeSidecar,
  };
}

function assertSidecar(name) {
  if (name !== 'locations') throw new Error('Unknown sidecar.');
}

async function writeTextAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, text, 'utf8');
  try {
    await fs.promises.rename(tmp, file);
  } catch (error) {
    await fs.promises.copyFile(tmp, file);
    await fs.promises.rm(tmp, { force: true });
  }
}

function formatFor(ext) {
  if (ext === '.pdf') return 'pdf';
  if (ext === '.epub') return 'epub';
  if (ext === '.md' || ext === '.markdown') return 'md';
  return null;
}

function titleFromFilename(filename) {
  const base = cleanTitle(filename.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' '));
  if (!base) return 'Untitled';
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function cleanTitle(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

function clampZoom(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 1;
  const stepped = Math.round(number * 10) / 10;
  return Math.min(2, Math.max(0.7, stepped));
}

async function markdownTitle(file) {
  const handle = await fs.promises.open(file, 'r');
  try {
    const buffer = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buffer, 0, 8192, 0);
    let text = buffer.slice(0, bytesRead).toString('utf8').replace(/^\uFEFF/, '');
    if (text.startsWith('---')) {
      const end = text.indexOf('\n---', 3);
      if (end !== -1) text = text.slice(end + 4);
    }
    const match = text.match(/^#\s+(.+?)\s*#*\s*$/m);
    return match ? cleanTitle(match[1]) : null;
  } finally {
    await handle.close();
  }
}

async function extractEpub(file, dir) {
  const zip = await JSZip.loadAsync(await fs.promises.readFile(file));
  const entries = new Map();
  zip.forEach((relPath, entry) => {
    if (!entry.dir) entries.set(relPath.replace(/\\/g, '/').toLowerCase(), entry);
  });

  const containerEntry = entries.get('meta-inf/container.xml');
  if (!containerEntry) return { title: '', author: '', hasCover: false };
  const container = xmlParser.parse(await containerEntry.async('string'));
  const rootfiles = asArray(container?.container?.rootfiles?.rootfile);
  const opfPath = rootfiles.map((item) => item?.['@_full-path']).find(Boolean);
  if (!opfPath) return { title: '', author: '', hasCover: false };

  const opfEntry = zipEntry(entries, opfPath);
  if (!opfEntry) return { title: '', author: '', hasCover: false };
  const opf = xmlParser.parse(await opfEntry.async('string'));
  const metadata = opf?.package?.metadata || {};
  const title = firstText(metadata.title);
  const author = asArray(metadata.creator).map(textOf).map((item) => item.trim()).filter(Boolean).join(', ');

  const items = asArray(opf?.package?.manifest?.item);
  const metas = asArray(metadata.meta);
  const coverId = metas.find((meta) => String(meta?.['@_name'] || '').toLowerCase() === 'cover')?.['@_content'];
  let coverItem = items.find((item) => coverId && item?.['@_id'] === coverId);
  if (!coverItem) {
    coverItem = items.find((item) => String(item?.['@_properties'] || '').toLowerCase().split(/\s+/).includes('cover-image'));
  }
  if (!coverItem) {
    coverItem = items.find((item) => {
      const href = String(item?.['@_href'] || '');
      const media = String(item?.['@_media-type'] || '');
      return /cover/i.test(href) && media.startsWith('image/');
    });
  }

  let hasCover = false;
  if (coverItem?.['@_href']) {
    const href = decodeURIComponent(String(coverItem['@_href']).split('?')[0]);
    const coverZipPath = resolveZipPath(opfPath, href);
    const coverEntry = zipEntry(entries, coverZipPath);
    if (coverEntry) {
      const ext = extFromMime(coverItem['@_media-type']) || extFromHref(href);
      const bytes = await coverEntry.async('nodebuffer');
      await fs.promises.writeFile(path.join(dir, `cover${ext}`), bytes);
      hasCover = true;
    }
  }

  return { title: cleanTitle(title), author: cleanTitle(author), hasCover };
}

function zipEntry(entries, zipPath) {
  return entries.get(String(zipPath || '').replace(/\\/g, '/').toLowerCase()) || null;
}

function resolveZipPath(opfPath, href) {
  const base = String(opfPath).replace(/\\/g, '/').split('/').slice(0, -1);
  const parts = [...base, ...String(href).replace(/\\/g, '/').split('/')];
  const stack = [];
  for (const part of parts) {
    if (part === '..') stack.pop();
    else if (part && part !== '.') stack.push(part);
  }
  return stack.join('/');
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(node) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (typeof node === 'object' && node['#text'] != null) return String(node['#text']);
  return '';
}

function firstText(node) {
  for (const item of asArray(node)) {
    const text = textOf(item).trim();
    if (text) return text;
  }
  return '';
}

function extFromMime(mime) {
  const map = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
  };
  return map[String(mime || '').toLowerCase()] || '.jpg';
}

function extFromHref(href) {
  const ext = path.extname(href).toLowerCase();
  if (ext === '.jpeg') return '.jpg';
  if (COVER_EXTS.includes(ext)) return ext;
  return '.jpg';
}

module.exports = { createLibrary };
