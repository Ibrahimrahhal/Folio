const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, net, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { createLibrary } = require('./library.cjs');

const isDev = process.env.FOLIO_DEV === '1';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'folio',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow = null;
let library = null;

function libraryRoot() {
  return path.join(app.getPath('userData'), 'library');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 880,
    minHeight: 640,
    backgroundColor: '#faf9f5',
    title: 'Folio',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = isDev && url.startsWith('http://localhost:5173');
    if (!devUrl) event.preventDefault();
  });

  mainWindow.webContents.on('zoom-changed', () => {
    mainWindow.webContents.setZoomFactor(1);
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  buildMenu(mainWindow);
}

function buildMenu(win) {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Add a book',
          accelerator: 'CmdOrCtrl+O',
          click: () => win.webContents.send('menu:add'),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
  ];

  if (isDev) {
    template.push({
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }],
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function openExternal(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      shell.openExternal(parsed.href);
    }
  } catch {
    // Ignore malformed links from books.
  }
}

function registerProtocol() {
  const mime = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
  };

  protocol.handle('folio', (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'cover') return new Response('Not found', { status: 404 });
      const id = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      const file = library.coverPath(id);
      if (!file) return new Response('Not found', { status: 404 });
      const type = mime[path.extname(file).toLowerCase()] || 'application/octet-stream';
      return net.fetch(pathToFileURL(file).toString()).then((response) => {
        const headers = new Headers(response.headers);
        headers.set('Content-Type', type);
        headers.set('Cache-Control', 'no-cache');
        return new Response(response.body, { status: response.status, headers });
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function registerIpc() {
  ipcMain.handle('books:list', () => library.listBooks());
  ipcMain.handle('books:get', (_event, id) => library.getBook(id));
  ipcMain.handle('books:pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Add a book',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Books', extensions: ['pdf', 'epub', 'md', 'markdown'] }],
    });
    if (result.canceled) return [];
    return result.filePaths;
  });
  ipcMain.handle('books:import-path', (_event, filePath) => library.importFromPath(filePath));
  ipcMain.handle('books:read', (_event, id) => library.readBook(id));
  ipcMain.handle('books:progress', (_event, id, progress) => library.saveProgress(id, progress));
  ipcMain.handle('books:cover', (_event, id, bytes, type) => library.saveCover(id, bytes, type));
  ipcMain.handle('books:patch', (_event, id, patch) => library.patchBook(id, patch));
  ipcMain.handle('books:remove', (_event, id) => library.removeBook(id));
  ipcMain.handle('books:sidecar-read', (_event, id, name) => library.readSidecar(id, name));
  ipcMain.handle('books:sidecar-write', (_event, id, name, text) => library.writeSidecar(id, name, text));
  ipcMain.handle('app:open-external', (_event, url) => openExternal(url));
}

if (gotLock) {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    library = createLibrary(libraryRoot());
    registerProtocol();
    registerIpc();
    createWindow();
  });

  app.on('window-all-closed', () => {
    // Progress is written on a timer while the book is open, not on quit.
    app.quit();
  });
}
