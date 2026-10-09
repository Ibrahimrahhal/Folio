const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'docs', 'screenshots');

async function settle(win) {
  await win.webContents.executeJavaScript('document.fonts.ready');
  await new Promise((resolve) => setTimeout(resolve, 400));
}

async function save(win, name) {
  const image = await win.capturePage();
  fs.writeFileSync(path.join(outDir, name), image.toPNG());
}

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({
    width: 1280,
    height: 1180,
    useContentSize: true,
    show: true,
    backgroundColor: '#faf9f5',
    webPreferences: { contextIsolation: true },
  });
  await win.loadURL('http://localhost:5173/#preview');
  await win.webContents.insertCSS(`
    ::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
    .shelf { grid-template-columns: repeat(2, 240px) !important; }
  `);
  await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (document.querySelectorAll('.book-card').length >= 2 || Date.now() - start > 4000) resolve(true);
        else setTimeout(tick, 80);
      };
      tick();
    })
  `);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await win.webContents.executeJavaScript(`
    const card = [...document.querySelectorAll('.book-card')].find((node) => node.textContent.includes('Atlas'));
    if (card) card.style.display = 'none';
    const lede = document.querySelector('.library-header .lede');
    if (lede) lede.textContent = '2 books, kept on this machine.';
  `);
  await save(win, 'library.png');

  await win.webContents.executeJavaScript(`
    [...document.querySelectorAll('.book-open')].find((button) => button.textContent.includes('Field notes')).click()
  `);
  await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (document.querySelector('.reader')) resolve(true);
        else if (Date.now() - start > 8000) resolve(false);
        else setTimeout(tick, 50);
      };
      tick();
    })
  `);
  await win.webContents.insertCSS('.shelf { grid-template-columns: none !important; }');
  await settle(win);
  await save(win, 'reader.png');

  await win.webContents.executeJavaScript(`document.querySelector('.outline-toggle')?.click()`);
  await settle(win);
  await save(win, 'outline.png');
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
