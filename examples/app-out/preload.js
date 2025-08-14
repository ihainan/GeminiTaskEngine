const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onFileOpened: (callback) => ipcRenderer.on('file-opened', (_event, value) => callback(value))
});