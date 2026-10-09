const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const { createLibrary } = require('../electron/library.cjs');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-library-'));
  const library = createLibrary(root);
  const source = path.join(root, 'incoming');
  fs.mkdirSync(source);

  const markdown = path.join(source, 'harbor_notes.md');
  fs.writeFileSync(markdown, '---\ntitle: ignore\n---\n\n# Harbor Notes\n\nThe pier was quiet.\n');

  const pdfPath = path.join(source, 'atlas.pdf');
  fs.writeFileSync(pdfPath, Buffer.from('%PDF-1.4\n'));

  const epubPath = path.join(source, 'warm-harbor.epub');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  zip.file('OEBPS/content.opf', `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>The Warm Harbor</dc:title>
    <dc:creator>Ada Marin</dc:creator>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="cover-image" href="images/cover.png" media-type="image/png"/>
  </manifest>
</package>`);
  zip.file('OEBPS/images/cover.png', png);
  fs.writeFileSync(epubPath, await zip.generateAsync({ type: 'nodebuffer' }));

  const notes = await library.importFromPath(markdown);
  const atlas = await library.importFromPath(pdfPath);
  const harbor = await library.importFromPath(epubPath);

  if (notes.title !== 'Harbor Notes') throw new Error(`markdown title: ${notes.title}`);
  if (notes.format !== 'md' || atlas.format !== 'pdf' || harbor.format !== 'epub') throw new Error('formats');
  if (harbor.title !== 'The Warm Harbor') throw new Error(`epub title: ${harbor.title}`);
  if (harbor.author !== 'Ada Marin') throw new Error(`epub author: ${harbor.author}`);
  if (!harbor.hasCover) throw new Error('epub cover missing');
  if (!fs.existsSync(path.join(root, harbor.id, 'cover.png'))) throw new Error('cover file missing');

  await Promise.all([
    library.saveProgress(notes.id, { percentage: 0.2, scrollRatio: 0.2 }),
    library.saveProgress(notes.id, { percentage: 0.55, scrollRatio: 0.55 }),
  ]);
  const saved = await library.getBook(notes.id);
  if (saved.percentage !== 0.55) throw new Error(`progress clobber: ${saved.percentage}`);
  if (saved.location.scrollRatio !== 0.55) throw new Error('scroll ratio missing');
  if (saved.title !== 'Harbor Notes') throw new Error('progress wiped the title');

  const read = await library.readBook(harbor.id);
  if (!read.bytes.length) throw new Error('empty read');

  await library.removeBook(atlas.id);
  const remaining = await library.listBooks();
  if (remaining.some((book) => book.id === atlas.id)) throw new Error('remove failed');
  if (remaining.length !== 2) throw new Error(`expected 2 books, got ${remaining.length}`);

  fs.rmSync(root, { recursive: true, force: true });
  console.log('library self-check ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
