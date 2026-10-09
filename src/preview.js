import JSZip from 'jszip';

const encoder = new TextEncoder();

function byteLength(value) {
  return encoder.encode(value).length;
}

function escapePdf(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export function makeSimplePdf(pageTexts) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };

  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const contentIds = [];
  const pageIds = [];
  pageTexts.forEach((text, index) => {
    const stream = `BT /F1 22 Tf 64 ${720 - index * 0} Td (${escapePdf(text)}) Tj ET`;
    contentIds.push(add(`<< /Length ${byteLength(stream)} >>\nstream\n${stream}\nendstream`));
    pageIds.push(add(''));
  });
  const pagesId = add('');
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  objects[pagesId - 1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`;
  pageIds.forEach((pageId, index) => {
    objects[pageId - 1] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${contentIds[index]} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
  });

  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefAt = byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (let index = 1; index < offsets.length; index += 1) {
    body += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return encoder.encode(body);
}

async function makeSampleEpub() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>The Warm Harbor</dc:title>
    <dc:creator>Ada Marin</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="uid">folio-preview-harbor</dc:identifier>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="chap1" href="chap1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cover-image" href="cover.png" media-type="image/png" properties="cover-image"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="chap1"/>
  </spine>
</package>`);
  zip.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="folio-preview-harbor"/></head>
  <docTitle><text>The Warm Harbor</text></docTitle>
  <navMap>
    <navPoint id="np1" playOrder="1">
      <navLabel><text>Chapter 1</text></navLabel>
      <content src="chap1.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`);
  zip.file('OEBPS/chap1.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 1</title></head>
<body>
  <h1>The Warm Harbor</h1>
  <p>The harbor was the color of tea left too long in the cup.</p>
  <p>Ada walked the pier with the book still open, one finger keeping a sentence she was not ready to leave.</p>
  <p>A bell rang somewhere past the crates. She did not look up. The page had more weather in it than the sky.</p>
  <p>By the second lamp the paragraph turned, and the town became a list of doors she had not knocked on yet.</p>
</body>
</html>`);
  zip.file('OEBPS/cover.png', tinyPng(), { base64: false });
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
}

function tinyPng() {
  return Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (char) => char.charCodeAt(0));
}

const NOTES = `# Field notes

A margin is a place to return to.

## What the shelf remembers

Folio copies the file, then keeps the page. Leave in the middle of a thought. The place is written every five seconds.

- PDF pages
- EPUB locations
- Markdown scroll

> The cream page is the paper. The coral mark is how far you have come.

\`inline code\` stays in the sentence.

\`\`\`js
function remember(page) {
  return page;
}
\`\`\`

| Format | Place kept |
| --- | --- |
| PDF | Page number |
| EPUB | Location |
| Markdown | Scroll |

A longer stretch, so the page can actually move. The lamp was low. The paragraph did not hurry. Somewhere a kettle clicked off and the room got quieter than the book.

The next line is only here so the scroll bar has somewhere to go, and so returning to a ratio still means something after the app has been closed.

Then another. And another. The harbor, again, in a different set of clothes. You can leave here and come back to the same line.
`;

function publicBook(record) {
  return {
    id: record.id,
    title: record.title,
    author: record.author,
    format: record.format,
    filename: record.filename,
    addedAt: record.addedAt,
    lastReadAt: record.lastReadAt,
    percentage: record.percentage,
    location: record.location,
    pageCount: record.pageCount,
    hasCover: record.hasCover,
    coverUpdatedAt: record.coverUpdatedAt,
    coverUrl: record.coverUrl || null,
    enriched: record.enriched,
    titleFromFile: record.titleFromFile,
  };
}

export async function installPreview() {
  const notes = encoder.encode(NOTES);
  const pdf = makeSimplePdf([
    'Atlas of Quiet Cities — page one',
    'Atlas of Quiet Cities — page two',
    'Atlas of Quiet Cities — page three',
  ]);
  const epub = await makeSampleEpub();
  const now = Date.now();
  const records = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Field notes',
      author: '',
      format: 'md',
      filename: 'field-notes.md',
      addedAt: new Date(now - 86400000).toISOString(),
      lastReadAt: new Date(now - 60000).toISOString(),
      percentage: 0.42,
      location: { scrollRatio: 0.42 },
      pageCount: null,
      hasCover: false,
      coverUpdatedAt: null,
      coverUrl: null,
      enriched: true,
      titleFromFile: false,
      bytes: notes,
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      title: 'The Warm Harbor',
      author: 'Ada Marin',
      format: 'epub',
      filename: 'the-warm-harbor.epub',
      addedAt: new Date(now - 172800000).toISOString(),
      lastReadAt: new Date(now - 7200000).toISOString(),
      percentage: 0,
      location: {},
      pageCount: null,
      hasCover: false,
      coverUpdatedAt: null,
      coverUrl: null,
      enriched: true,
      titleFromFile: false,
      bytes: epub,
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      title: 'Atlas of Quiet Cities',
      author: 'North Press',
      format: 'pdf',
      filename: 'atlas-of-quiet-cities.pdf',
      addedAt: new Date(now - 400000).toISOString(),
      lastReadAt: new Date(now - 400000).toISOString(),
      percentage: 2 / 3,
      location: { pdfPage: 2, pageCount: 3 },
      pageCount: 3,
      hasCover: false,
      coverUpdatedAt: null,
      coverUrl: null,
      enriched: false,
      titleFromFile: false,
      bytes: pdf,
    },
  ];

  function must(id) {
    const record = records.find((item) => item.id === id);
    if (!record) throw new Error('Book not found.');
    return record;
  }

  window.folio = {
    async listBooks() {
      return records
        .map(publicBook)
        .sort((a, b) => Date.parse(b.lastReadAt || b.addedAt) - Date.parse(a.lastReadAt || a.addedAt));
    },
    async getBook(id) {
      return publicBook(must(id));
    },
    async pickBooks() {
      return ['preview://margin-notes.md'];
    },
    async importPath(filePath) {
      const record = {
        id: crypto.randomUUID(),
        title: 'Margin notes',
        author: '',
        format: 'md',
        filename: 'margin-notes.md',
        addedAt: new Date().toISOString(),
        lastReadAt: null,
        percentage: 0,
        location: {},
        pageCount: null,
        hasCover: false,
        coverUpdatedAt: null,
        coverUrl: null,
        enriched: true,
        titleFromFile: false,
        bytes: encoder.encode(`# Margin notes\n\nAdded from ${filePath}.\n`),
      };
      records.unshift(record);
      return publicBook(record);
    },
    pathForFile() {
      throw new Error('Drop a file in the Folio desktop window.');
    },
    async readBook(id) {
      const record = must(id);
      return { bytes: record.bytes, book: publicBook(record) };
    },
    async saveProgress(id, progress) {
      const record = must(id);
      record.percentage = progress.percentage;
      record.location = {
        ...(record.location || {}),
        ...(progress.pdfPage ? { pdfPage: progress.pdfPage } : {}),
        ...(progress.pageCount ? { pageCount: progress.pageCount } : {}),
        ...(progress.cfi ? { cfi: progress.cfi } : {}),
        ...(typeof progress.scrollRatio === 'number' ? { scrollRatio: progress.scrollRatio } : {}),
        ...(typeof progress.zoom === 'number' ? { zoom: progress.zoom } : {}),
      };
      if (progress.pageCount) record.pageCount = progress.pageCount;
      record.lastReadAt = new Date().toISOString();
      return publicBook(record);
    },
    async saveCover(id, bytes, mime) {
      const record = must(id);
      const blob = new Blob([bytes], { type: mime || 'image/jpeg' });
      if (record.coverUrl) URL.revokeObjectURL(record.coverUrl);
      record.coverUrl = URL.createObjectURL(blob);
      record.hasCover = true;
      record.coverUpdatedAt = new Date().toISOString();
      return publicBook(record);
    },
    async patchBook(id, patch) {
      const record = must(id);
      if (patch.title) record.title = patch.title;
      if (typeof patch.author === 'string') record.author = patch.author;
      if (patch.pageCount) record.pageCount = patch.pageCount;
      if (patch.titleFromFile === false) record.titleFromFile = false;
      if (patch.enriched === true) record.enriched = true;
      return publicBook(record);
    },
    async removeBook(id) {
      const index = records.findIndex((item) => item.id === id);
      if (index >= 0) records.splice(index, 1);
      return true;
    },
    async readSidecar() {
      return null;
    },
    async writeSidecar() {
      return true;
    },
    async openExternal(url) {
      window.open(url, '_blank', 'noopener');
    },
    onMenuAdd() {
      return () => {};
    },
  };
}
