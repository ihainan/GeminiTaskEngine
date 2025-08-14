const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSimulatedTextContent: () => ipcRenderer.invoke('get-simulated-text-content'),
  getSimulatedConsoleOutput: () => ipcRenderer.invoke('get-simulated-console-output'),
});
