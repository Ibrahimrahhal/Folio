const { app, BrowserWindow, ipcMain, net, protocol } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const JSZip = require('jszip');
const { createLibrary } = require('../electron/library.cjs');

const outDir = path.join(__dirname, '..', '.verify');
const libraryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-ui-'));
const failures = [];
const logs = [];

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'folio',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function check(name, ok, detail) {
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  console.log(`${ok ? 'ok' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function shot(win, name) {
  const image = await win.webContents.capturePage();
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, name), image.toPNG());
}

async function bodyText(win) {
  return win.webContents.executeJavaScript('document.body.innerText');
}

async function waitForText(win, text, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const textBody = await bodyText(win);
    if (textBody.includes(text)) return textBody;
    await delay(200);
  }
  const textBody = await bodyText(win);
  throw new Error(`Timed out waiting for "${text}". Saw: ${textBody.slice(0, 400)}`);
}

async function clickText(win, text) {
  const clicked = await win.webContents.executeJavaScript(`
    (() => {
      const target = ${JSON.stringify(text)};
      const el = [...document.querySelectorAll('button')].find((node) => node.textContent.includes(target));
      if (!el) return false;
      el.click();
      return true;
    })()
  `);
  if (!clicked) throw new Error(`Could not click ${text}`);
}

function simplePdf(pageTexts) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const contentIds = [];
  const pageIds = [];
  for (const text of pageTexts) {
    const stream = `BT /F1 22 Tf 64 720 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
    contentIds.push(add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`));
    pageIds.push(add(''));
  }
  const pagesId = add('');
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  objects[pagesId - 1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`;
  pageIds.forEach((pageId, index) => {
    objects[pageId - 1] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${contentIds[index]} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
  });
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    body += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body);
}

async function sampleEpub(file) {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC', 'base64');
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('OEBPS/content.opf', `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>The Warm Harbor</dc:title>
    <dc:creator>Ada Marin</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="uid">folio-ui</dc:identifier>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cover-image" href="cover.png" media-type="image/png"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`);
  zip.file('OEBPS/toc.ncx', `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="folio-ui"/></head>
  <docTitle><text>The Warm Harbor</text></docTitle>
  <navMap>
    <navPoint id="n1" playOrder="1"><navLabel><text>One</text></navLabel><content src="c1.xhtml"/></navPoint>
    <navPoint id="n2" playOrder="2"><navLabel><text>Two</text></navLabel><content src="c2.xhtml"/></navPoint>
  </navMap>
</ncx>`);
  zip.file('OEBPS/c1.xhtml', '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head><body><h1>Chapter One</h1><p>The harbor was the color of tea.</p></body></html>');
  zip.file('OEBPS/c2.xhtml', '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Two</title></head><body><h1>Chapter Two</h1><p>The second lamp marked the turn.</p></body></html>');
  zip.file('OEBPS/cover.png', png);
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
}

function register(library) {
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
  protocol.handle('folio', (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'cover') return new Response('no', { status: 404 });
    const id = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    const file = library.coverPath(id);
    if (!file) return new Response('no', { status: 404 });
    return net.fetch(pathToFileURL(file).toString()).then((response) => {
      const headers = new Headers(response.headers);
      headers.set('Content-Type', mime[path.extname(file).toLowerCase()] || 'application/octet-stream');
      return new Response(response.body, { status: response.status, headers });
    });
  });
  ipcMain.handle('books:list', () => library.listBooks());
  ipcMain.handle('books:get', (_e, id) => library.getBook(id));
  ipcMain.handle('books:pick', () => []);
  ipcMain.handle('books:import-path', (_e, filePath) => library.importFromPath(filePath));
  ipcMain.handle('books:read', (_e, id) => library.readBook(id));
  ipcMain.handle('books:progress', (_e, id, progress) => library.saveProgress(id, progress));
  ipcMain.handle('books:cover', (_e, id, bytes, type) => library.saveCover(id, bytes, type));
  ipcMain.handle('books:patch', (_e, id, patch) => library.patchBook(id, patch));
  ipcMain.handle('books:remove', (_e, id) => library.removeBook(id));
  ipcMain.handle('books:sidecar-read', (_e, id, name) => library.readSidecar(id, name));
  ipcMain.handle('books:sidecar-write', (_e, id, name, text) => library.writeSidecar(id, name, text));
  ipcMain.handle('app:open-external', () => {});
}

async function main() {
  const library = createLibrary(libraryRoot);
  register(library);
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: true,
    backgroundColor: '#faf9f5',
    webPreferences: {
      preload: path.join(__dirname, '../electron/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.webContents.on('console-message', (event, level, message) => {
    const text = event && event.message ? event.message : message;
    const severity = event && event.level != null ? event.level : level;
    if (severity === 'error' || severity === 3 || severity >= 2) logs.push(String(text));
  });

  if (process.env.FOLIO_VERIFY_DIST === '1') {
    await win.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
    await win.loadURL('http://localhost:5173/');
  }
  await waitForText(win, 'Your shelf is waiting');
  await shot(win, '01-empty.png');

  const incoming = path.join(libraryRoot, 'incoming');
  fs.mkdirSync(incoming);
  const markdown = path.join(incoming, 'field_notes.md');
  fs.writeFileSync(markdown, `# Field notes

A margin is a place to return to.

## Kept on this machine

The paragraph below is long enough to scroll.

${'The lamp stayed low and the paragraph did not hurry. '.repeat(40)}

\`\`\`js
function remember(page) {
  return page;
}
\`\`\`

| Format | Kept |
| --- | --- |
| PDF | Page |
`);
  const pdfPath = path.join(incoming, 'atlas.pdf');
  fs.writeFileSync(pdfPath, simplePdf(['Atlas page one', 'Atlas page two', 'Atlas page three']));
  const epubPath = path.join(incoming, 'harbor.epub');
  await sampleEpub(epubPath);

  const notes = await win.webContents.executeJavaScript(`window.folio.importPath(${JSON.stringify(markdown)})`);
  const atlas = await win.webContents.executeJavaScript(`window.folio.importPath(${JSON.stringify(pdfPath)})`);
  const harbor = await win.webContents.executeJavaScript(`window.folio.importPath(${JSON.stringify(epubPath)})`);
  check('import titles', notes.title === 'Field notes' && harbor.title === 'The Warm Harbor' && atlas.format === 'pdf', `${notes.title} / ${harbor.title}`);
  fs.rmSync(incoming, { recursive: true, force: true });
  check('original file can be deleted', !fs.existsSync(markdown));
  check('copy survives', fs.existsSync(path.join(libraryRoot, notes.id, 'source.md')));

  await waitForText(win, 'Field notes');
  await waitForText(win, 'The Warm Harbor');
  await delay(1500);
  await shot(win, '02-shelf.png');
  const shelf = await bodyText(win);
  check('shelf shows percent', shelf.includes('0%'), 'expected a zero percent on a new book');
  check('continue hidden at zero', !shelf.includes('Continue'));

  const cover = await win.webContents.executeJavaScript(`
    (() => {
      const img = [...document.querySelectorAll('.cover img')].find((node) => node.src.startsWith('folio://cover/'));
      return img ? { src: img.src, width: img.naturalWidth } : null;
    })()
  `);
  check('epub cover rendered', !!(cover && cover.width > 0), JSON.stringify(cover));

  await clickText(win, 'Field notes');
  await waitForText(win, 'Kept on this machine');
  await shot(win, '03-markdown.png');
  const markdownState = await win.webContents.executeJavaScript(`
    (() => {
      const code = document.querySelector('.md-code');
      const table = document.querySelector('.markdown table');
      return { code: !!code, table: !!table, title: document.querySelector('.reader-title')?.textContent || '' };
    })()
  `);
  check('markdown renders code and table', markdownState.code && markdownState.table && markdownState.title === 'Field notes', JSON.stringify(markdownState));

  await clickText(win, 'Next');
  await clickText(win, 'Next');
  let sawSaved = false;
  for (let i = 0; i < 14; i += 1) {
    await delay(500);
    const text = await bodyText(win);
    if (text.includes('Saved')) {
      sawSaved = true;
      break;
    }
  }
  check('progress saved within 5 seconds', sawSaved);
  const savedMeta = JSON.parse(fs.readFileSync(path.join(libraryRoot, notes.id, 'meta.json'), 'utf8'));
  check('markdown position on disk', savedMeta.location.scrollRatio > 0 && savedMeta.percentage > 0, JSON.stringify(savedMeta.location));
  await shot(win, '04-markdown-saved.png');

  await clickText(win, 'Library');
  await waitForText(win, 'Your library');
  const after = await bodyText(win);
  check('shelf remembers percent', /100%|Finished/.test(after), after.match(/\d+%/g)?.join(','));
  await shot(win, '05-shelf-progress.png');

  await clickText(win, 'Atlas');
  await waitForText(win, '1 / 3', 15000);
  const ink = await win.webContents.executeJavaScript(`
    (() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return 0;
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let dark = 0;
      for (let i = 0; i < data.length; i += 16) {
        if (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240) dark += 1;
      }
      return dark;
    })()
  `);
  check('pdf page painted', ink > 20, `dark samples ${ink}`);
  await shot(win, '06-pdf.png');
  await clickText(win, 'Next');
  await waitForText(win, '2 / 3');
  await clickText(win, 'Library');
  await waitForText(win, 'Your library');

  await clickText(win, 'The Warm Harbor');
  await delay(2500);
  const epubState = await win.webContents.executeJavaScript(`
    (() => {
      const frame = document.querySelector('.epub-view iframe');
      let text = '';
      try { text = frame?.contentDocument?.body?.innerText || ''; } catch (error) { text = String(error); }
      return {
        frame: !!frame,
        height: frame ? frame.getBoundingClientRect().height : 0,
        text,
        error: document.body.innerText.includes('couldn’t be opened'),
      };
    })()
  `);
  check('epub opened', epubState.frame && epubState.height > 100 && !epubState.error, JSON.stringify(epubState));
  await shot(win, '07-epub.png');
  await clickText(win, 'Next');
  await delay(600);
  const epubNext = await win.webContents.executeJavaScript(`
    (() => document.querySelector('.epub-view iframe')?.contentDocument?.body?.innerText || '')()
  `);
  check('epub next chapter', epubNext.includes('Chapter Two') || epubNext.includes('second lamp'), epubNext.slice(0, 180));
  await shot(win, '08-epub-next.png');

  await clickText(win, 'Library');
  await waitForText(win, 'Atlas');
  const withContinue = await bodyText(win);
  check('continue reading', withContinue.includes('CONTINUE') && withContinue.includes('Resume'), withContinue.slice(0, 400));
  await shot(win, '09-continue.png');
  await clickText(win, 'Resume');
  await waitForText(win, '2 / 3', 15000);
  check('pdf resumes where it was left', true);
  await shot(win, '11-pdf-resume.png');
  await clickText(win, 'Library');
  await waitForText(win, 'Finished');
  await clickText(win, 'Finished');
  await delay(300);
  const finished = await bodyText(win);
  check('finished filter', finished.includes('The Warm Harbor') && !finished.includes('Atlas'), finished.slice(0, 240));
  await shot(win, '10-finished.png');

  if (logs.length) console.log('console:\\n' + logs.slice(0, 12).join('\\n'));
  if (failures.length) {
    console.error(failures.join('\\n'));
    app.exit(1);
    return;
  }
  console.log('ui verification ok');
  app.exit(0);
}

app.whenReady().then(main).catch((error) => {
  console.error(error);
  app.exit(1);
});
