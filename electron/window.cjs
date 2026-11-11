const { BrowserWindow } = require('electron');

// Windows and Linux get Folio's own title bar. macOS keeps its traffic lights, set into the header.
const customFrame = process.platform !== 'darwin';

function frameOptions() {
  if (customFrame) return { frame: false };
  return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 22, y: 25 } };
}

function stateOf(win) {
  return {
    maximized: win.isMaximized(),
    fullScreen: win.isFullScreen(),
    focused: win.isFocused(),
  };
}

function watchWindow(win) {
  const send = (override = {}) => {
    if (!win.isDestroyed()) win.webContents.send('window:state', { ...stateOf(win), ...override });
  };
  for (const name of ['maximize', 'unmaximize', 'restore', 'focus', 'blur']) {
    win.on(name, () => send());
  }
  // isFullScreen() can still report the old value while these events fire, so say it outright.
  win.on('enter-full-screen', () => send({ fullScreen: true }));
  win.on('leave-full-screen', () => send({ fullScreen: false }));
}

function registerWindowIpc(ipcMain) {
  const target = (event) => BrowserWindow.fromWebContents(event.sender);
  ipcMain.handle('window:state', (event) => {
    const win = target(event);
    return win ? stateOf(win) : null;
  });
  ipcMain.handle('window:minimize', (event) => target(event)?.minimize());
  ipcMain.handle('window:toggle-maximize', (event) => {
    const win = target(event);
    if (!win) return;
    if (win.isFullScreen()) win.setFullScreen(false);
    else if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle('window:toggle-full-screen', (event) => {
    const win = target(event);
    if (win) win.setFullScreen(!win.isFullScreen());
  });
  ipcMain.handle('window:close', (event) => target(event)?.close());
}

module.exports = { customFrame, frameOptions, registerWindowIpc, watchWindow };
