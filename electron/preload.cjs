const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('folio', {
  listBooks: () => ipcRenderer.invoke('books:list'),
  getBook: (id) => ipcRenderer.invoke('books:get', id),
  pickBooks: () => ipcRenderer.invoke('books:pick'),
  importPath: (filePath) => ipcRenderer.invoke('books:import-path', filePath),
  pathForFile: (file) => webUtils.getPathForFile(file),
  readBook: (id) => ipcRenderer.invoke('books:read', id),
  saveProgress: (id, progress) => ipcRenderer.invoke('books:progress', id, progress),
  saveCover: (id, bytes, mime) => ipcRenderer.invoke('books:cover', id, bytes, mime),
  patchBook: (id, patch) => ipcRenderer.invoke('books:patch', id, patch),
  removeBook: (id) => ipcRenderer.invoke('books:remove', id),
  readSidecar: (id, name) => ipcRenderer.invoke('books:sidecar-read', id, name),
  writeSidecar: (id, name, text) => ipcRenderer.invoke('books:sidecar-write', id, name, text),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  platform: process.platform,
  frame: {
    custom: process.platform !== 'darwin',
    state: () => ipcRenderer.invoke('window:state'),
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    toggleFullScreen: () => ipcRenderer.invoke('window:toggle-full-screen'),
    close: () => ipcRenderer.invoke('window:close'),
    onState: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('window:state', listener);
      return () => ipcRenderer.removeListener('window:state', listener);
    },
  },
  onMenuAdd: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('menu:add', listener);
    return () => ipcRenderer.removeListener('menu:add', listener);
  },
});
