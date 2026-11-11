const { app, BrowserWindow, ipcMain, net, protocol } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const JSZip = require('jszip');
const { createLibrary } = require('../electron/library.cjs');
const { customFrame, frameOptions, registerWindowIpc, watchWindow } = require('../electron/window.cjs');

const outDir = path.join(__dirname, '..', '.verify');
const libraryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-ui-'));
const failures = [];
const logs = [];
let pickCalls = 0;

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

async function clickPoint(win, x, y) {
  win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
  win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
}

// Scrolls the element into view and returns its centre in window coordinates. A selector
// with " >> " reaches into the EPUB frame.
async function centerOf(win, selector) {
  return win.webContents.executeJavaScript(`
    (() => {
      const [outer, inner] = ${JSON.stringify(selector)}.split(' >> ');
      let el = document.querySelector(outer);
      let dx = 0;
      let dy = 0;
      if (el && inner) {
        const frameRect = el.getBoundingClientRect();
        dx = frameRect.left;
        dy = frameRect.top;
        el = el.contentDocument?.querySelector(inner);
      } else if (el) {
        el.scrollIntoView({ block: 'center' });
      }
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: Math.round(dx + rect.left + rect.width / 2), y: Math.round(dy + rect.top + rect.height / 2) };
    })()
  `);
}

async function clickOn(win, selector, timeout = 6000) {
  const start = Date.now();
  let point = null;
  while (!point && Date.now() - start < timeout) {
    point = await centerOf(win, selector);
    if (!point) await delay(150);
  }
  if (!point) throw new Error(`Nothing to click for ${selector}`);
  await delay(120);
  await clickPoint(win, point.x, point.y);
}

async function pressKey(win, keyCode, modifiers = []) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  if (keyCode.length === 1 && modifiers.every((m) => m === 'shift')) win.webContents.sendInputEvent({ type: 'char', keyCode, modifiers });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await delay(200);
}

async function viewerState(win) {
  return win.webContents.executeJavaScript(`
    (() => {
      const viewer = document.querySelector('.image-viewer');
      const img = viewer?.querySelector('.viewer-img');
      let center = null;
      if (img && img.naturalWidth) {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const context = canvas.getContext('2d');
        context.drawImage(img, 0, 0);
        center = [...context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data].slice(0, 3);
      }
      return {
        open: !!viewer,
        width: img?.naturalWidth || 0,
        height: img?.naturalHeight || 0,
        scheme: (img?.src || '').split(':')[0],
        center,
        shown: Math.round(img?.getBoundingClientRect().width || 0),
        caption: viewer?.querySelector('.viewer-caption')?.textContent || '',
        zoom: viewer?.querySelector('.zoom-label')?.textContent || '',
        focus: document.activeElement?.getAttribute('aria-label') || '',
        inReader: !!document.querySelector('.reader-title'),
      };
    })()
  `);
}

async function waitForViewer(win, timeout = 10000) {
  const start = Date.now();
  let state = await viewerState(win);
  while (!(state.open && state.width > 0 && /%/.test(state.zoom)) && Date.now() - start < timeout) {
    await delay(150);
    state = await viewerState(win);
  }
  return state;
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
  const plate = `${'C64545'.repeat(16)}>`;
  const imageId = add(`<< /Type /XObject /Subtype /Image /Width 4 /Height 4 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${plate.length} >>\nstream\n${plate}\nendstream`);
  const contentIds = [];
  const pageIds = [];
  for (const [index, text] of pageTexts.entries()) {
    const picture = index === 0 ? ' q 240 0 0 160 64 440 cm /Im1 Do Q' : '';
    const stream = `BT /F1 22 Tf 64 720 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET${picture}`;
    contentIds.push(add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`));
    pageIds.push(add(''));
  }
  const pagesId = add('');
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  objects[pagesId - 1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`;
  pageIds.forEach((pageId, index) => {
    objects[pageId - 1] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${contentIds[index]} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> /XObject << /Im1 ${imageId} 0 R >> >> >>`;
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
  zip.file('OEBPS/c1.xhtml', '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head><body><h1>Chapter One</h1><p>The harbor was the color of tea.</p><p><img src="cover.png" alt="Harbor map" style="width:120px;height:120px"/></p></body></html>');
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
  ipcMain.handle('books:pick', () => {
    pickCalls += 1;
    return [];
  });
  ipcMain.handle('books:import-path', (_e, filePath) => library.importFromPath(filePath));
  ipcMain.handle('books:read', (_e, id) => library.readBook(id));
  ipcMain.handle('books:progress', (_e, id, progress) => library.saveProgress(id, progress));
  ipcMain.handle('books:cover', (_e, id, bytes, type) => library.saveCover(id, bytes, type));
  ipcMain.handle('books:patch', (_e, id, patch) => library.patchBook(id, patch));
  ipcMain.handle('books:remove', (_e, id) => library.removeBook(id));
  ipcMain.handle('books:sidecar-read', (_e, id, name) => library.readSidecar(id, name));
  ipcMain.handle('books:sidecar-write', (_e, id, name, text) => library.writeSidecar(id, name, text));
  ipcMain.handle('app:open-external', () => {});
  registerWindowIpc(ipcMain);
}

async function main() {
  const library = createLibrary(libraryRoot);
  register(library);
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: true,
    backgroundColor: '#faf9f5',
    ...frameOptions(),
    webPreferences: {
      preload: path.join(__dirname, '../electron/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  watchWindow(win);
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

  const labelOf = (selector) => win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-label') || ''`);
  if (customFrame) {
    const controls = await win.webContents.executeJavaScript(`[...document.querySelectorAll('.window-controls .wc')].map((b) => b.getAttribute('aria-label')).join(',')`);
    check('window controls in the title bar', controls === 'Minimize,Maximize,Close', controls);
    await clickOn(win, '.wc-max');
    await delay(700);
    check('maximize button maximizes', win.isMaximized() && (await labelOf('.wc-max')) === 'Restore', `${win.isMaximized()} ${await labelOf('.wc-max')}`);
    await shot(win, '01b-maximized.png');
    await clickOn(win, '.wc-max');
    await delay(700);
    check('restore button restores', !win.isMaximized() && (await labelOf('.wc-max')) === 'Maximize', `${win.isMaximized()} ${await labelOf('.wc-max')}`);
    for (const name of ['min', 'max', 'close']) {
      const point = await centerOf(win, `.wc-${name}`);
      win.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
      await delay(350);
      const image = await win.webContents.capturePage({ x: 940, y: 0, width: 340, height: 64 });
      fs.writeFileSync(path.join(outDir, `01d-hover-${name}.png`), image.toPNG());
    }
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 600, y: 400 });
    const dragRegion = await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.top-nav')).webkitAppRegion || getComputedStyle(document.querySelector('.top-nav')).getPropertyValue('-webkit-app-region')`);
    check('title bar drags the window', dragRegion === 'drag', dragRegion);
  }

  await clickOn(win, '.title-btn[aria-label="Keyboard shortcuts"]');
  await delay(300);
  const librarySheet = await bodyText(win);
  check('shortcuts sheet opens from the title bar', librarySheet.includes('Shortcuts') && librarySheet.includes('Add a book') && librarySheet.includes('Search the shelf'), librarySheet.slice(0, 120));
  await shot(win, '01c-shortcuts-library.png');
  await pressKey(win, 'Escape');
  check('escape closes the sheet', !(await win.webContents.executeJavaScript(`!!document.querySelector('.shortcuts-sheet')`)));
  if (customFrame) {
    await pressKey(win, 'O', ['control']);
    await delay(200);
    check('ctrl+o asks for a book', pickCalls === 1, `pick dialog opened ${pickCalls} times`);
  }

  const incoming = path.join(libraryRoot, 'incoming');
  fs.mkdirSync(incoming);
  const markdown = path.join(incoming, 'field_notes.md');
  fs.writeFileSync(markdown, `# Field notes

A margin is a place to return to.

![Harbor lamp](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC)

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
  await pressKey(win, 'F', ['control']);
  const searchFocused = await win.webContents.executeJavaScript(`document.activeElement?.classList.contains('search') || false`);
  check('ctrl+f focuses the search', searchFocused);
  await win.webContents.executeJavaScript(`document.activeElement?.blur()`);
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

  const mdScroll = () => win.webContents.executeJavaScript(`Math.round(document.querySelector('.md-scroll').scrollTop)`);
  await pressKey(win, 'Space');
  const afterSpace = await mdScroll();
  await pressKey(win, 'Down');
  const afterDown = await mdScroll();
  await pressKey(win, 'Space', ['shift']);
  const afterShiftSpace = await mdScroll();
  check('space pages down, arrow scrolls, shift+space pages up', afterSpace > 200 && afterDown > afterSpace && afterShiftSpace < afterDown, `${afterSpace} -> ${afterDown} -> ${afterShiftSpace}`);
  await pressKey(win, 'Home');
  check('home goes to the start', (await mdScroll()) === 0);
  await pressKey(win, 'O');
  const outlineShown = await win.webContents.executeJavaScript(`!!document.querySelector('.outline')`);
  await pressKey(win, 'Escape');
  const outlineAfterEsc = await win.webContents.executeJavaScript(`({ outline: !!document.querySelector('.outline'), reader: !!document.querySelector('.reader-title') })`);
  check('o opens the outline, escape closes only the outline', outlineShown && !outlineAfterEsc.outline && outlineAfterEsc.reader, JSON.stringify({ outlineShown, ...outlineAfterEsc }));
  await pressKey(win, '?', ['shift']);
  await delay(200);
  const readerSheet = await win.webContents.executeJavaScript(`document.querySelector('.shortcuts-sheet')?.textContent || ''`);
  check('? opens reading shortcuts', readerSheet.includes('Turning pages') && readerSheet.includes('Previous page'), readerSheet.slice(0, 100));
  await shot(win, '03c-shortcuts-reader.png');
  await pressKey(win, 'Escape');
  const sheetGone = await win.webContents.executeJavaScript(`({ sheet: !!document.querySelector('.shortcuts-sheet'), reader: !!document.querySelector('.reader-title') })`);
  check('escape closes the sheet, not the book', !sheetGone.sheet && sheetGone.reader, JSON.stringify(sheetGone));
  const markdownState = await win.webContents.executeJavaScript(`
    (() => {
      const code = document.querySelector('.md-code');
      const table = document.querySelector('.markdown table');
      return { code: !!code, table: !!table, title: document.querySelector('.reader-title')?.textContent || '' };
    })()
  `);
  check('markdown renders code and table', markdownState.code && markdownState.table && markdownState.title === 'Field notes', JSON.stringify(markdownState));

  await clickOn(win, '.markdown img.md-zoomable');
  const mdViewer = await waitForViewer(win);
  check('markdown image opens viewer', mdViewer.open && mdViewer.width === 10 && mdViewer.caption === 'Harbor lamp', JSON.stringify(mdViewer));
  check('viewer takes focus', mdViewer.focus === 'Close image', mdViewer.focus);
  await clickOn(win, '.viewer-bar [aria-label="Zoom in"]');
  await delay(250);
  const zoomed = await viewerState(win);
  check('viewer zooms', zoomed.zoom !== mdViewer.zoom, `${mdViewer.zoom} -> ${zoomed.zoom}`);
  await shot(win, '03b-markdown-image.png');
  await pressKey(win, 'Escape');
  const mdClosed = await viewerState(win);
  check('escape closes viewer, not the book', !mdClosed.open && mdClosed.inReader, JSON.stringify(mdClosed));

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

  const hits = await win.webContents.executeJavaScript(`document.querySelectorAll('.pdf-image-hit').length`);
  check('pdf image found on page', hits === 1, `targets ${hits}`);
  await clickOn(win, '.pdf-image-hit');
  const pdfViewer = await waitForViewer(win);
  const [red, green, blue] = pdfViewer.center || [];
  check('pdf image opens viewer', pdfViewer.open && pdfViewer.scheme === 'blob' && pdfViewer.width >= 480 && pdfViewer.caption === 'Page 1', JSON.stringify(pdfViewer));
  check('pdf viewer shows the picture', red > 170 && green < 110 && blue < 110, JSON.stringify(pdfViewer.center));
  await shot(win, '06b-pdf-image.png');
  for (let i = 0; i < 4; i += 1) {
    win.webContents.sendInputEvent({ type: 'mouseWheel', x: 640, y: 400, deltaX: 0, deltaY: 240 });
    await delay(60);
  }
  await delay(200);
  const wheeled = await viewerState(win);
  check('wheel zooms the image', parseInt(wheeled.zoom, 10) > 200, `${pdfViewer.zoom} -> ${wheeled.zoom}`);
  const transformOf = () => win.webContents.executeJavaScript(`document.querySelector('.viewer-img')?.style.transform || ''`);
  const beforeDrag = await transformOf();
  win.webContents.sendInputEvent({ type: 'mouseDown', x: 640, y: 400, button: 'left', clickCount: 1 });
  for (let step = 1; step <= 6; step += 1) {
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 640 + step * 25, y: 400 + step * 10, button: 'left' });
    await delay(30);
  }
  win.webContents.sendInputEvent({ type: 'mouseUp', x: 790, y: 460, button: 'left', clickCount: 1 });
  await delay(200);
  const afterDrag = await transformOf();
  const dragged = await viewerState(win);
  check('drag pans without closing or zooming', afterDrag !== beforeDrag && dragged.open && dragged.zoom === wheeled.zoom, `${beforeDrag} -> ${afterDrag}`);
  await clickOn(win, '.viewer-close');
  await delay(250);
  const pdfClosed = await viewerState(win);
  check('close button closes viewer', !pdfClosed.open && (await bodyText(win)).includes('1 / 3'), JSON.stringify(pdfClosed));

  const pdfScroll = () => win.webContents.executeJavaScript(`Math.round(document.querySelector('.pdf-stage').scrollTop)`);
  await pressKey(win, 'Down');
  const firstStep = await pdfScroll();
  let presses = 1;
  while (!(await bodyText(win)).includes('2 / 3') && presses < 60) {
    await pressKey(win, 'Down');
    presses += 1;
  }
  check('down arrow scrolls the sheet, then turns the page', firstStep > 0 && (await bodyText(win)).includes('2 / 3'), `first step ${firstStep}px, ${presses} presses`);
  await pressKey(win, 'Up');
  await delay(500);
  const backUp = await pdfScroll();
  check('up arrow at the top returns to the end of the last page', (await bodyText(win)).includes('1 / 3') && backUp > 100, `scrollTop ${backUp}`);
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

  await clickOn(win, '.epub-view iframe >> img');
  const epubViewer = await waitForViewer(win);
  check('epub image opens viewer', epubViewer.open && epubViewer.width === 10 && epubViewer.caption === 'Harbor map', JSON.stringify(epubViewer));
  check('viewer is no smaller than the page', epubViewer.shown >= 119, `shown ${epubViewer.shown}px, page 120px`);
  await shot(win, '07b-epub-image.png');
  await pressKey(win, 'Escape');
  const epubClosed = await viewerState(win);
  check('epub viewer closes', !epubClosed.open && epubClosed.inReader, JSON.stringify(epubClosed));

  // Keys pressed while the book's own frame has focus still have to turn pages.
  const frameText = () => win.webContents.executeJavaScript(`document.querySelector('.epub-view iframe')?.contentDocument?.body?.innerText || ''`);
  await clickOn(win, '.epub-view iframe >> p');
  await pressKey(win, 'Right');
  await delay(600);
  check('right arrow turns the page from inside the book', (await frameText()).includes('Chapter Two'), (await frameText()).slice(0, 80));
  await pressKey(win, 'Left');
  await delay(600);
  check('left arrow turns back', (await frameText()).includes('Chapter One'), (await frameText()).slice(0, 80));

  await pressKey(win, 'F11');
  await delay(1200);
  const wentFull = win.isFullScreen();
  await shot(win, '07c-full-screen.png');
  await pressKey(win, 'Escape');
  await delay(1200);
  const stillReading = await win.webContents.executeJavaScript(`!!document.querySelector('.reader-title')`);
  check('f11 goes full screen, escape leaves it but keeps the book open', wentFull && !win.isFullScreen() && stillReading, `${wentFull} ${win.isFullScreen()} ${stillReading}`);
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
