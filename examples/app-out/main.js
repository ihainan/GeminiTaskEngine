const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    title: 'fastmodel - Untitled1' // Mimic original title
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Open the DevTools.
  // mainWindow.webContents.openDevTools();

  // Simulate opening a text file window
  const textWindow = new BrowserWindow({
    width: 600,
    height: 400,
    parent: mainWindow,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    title: 'FastCap2 - woven15x15.txt'
  });
  textWindow.loadFile(path.join(__dirname, 'renderer', 'text-window.html'));
  textWindow.once('ready-to-show', () => {
    textWindow.show();
  });

  // Simulate opening a console/log window
  const consoleWindow = new BrowserWindow({
    width: 700,
    height: 500,
    parent: mainWindow,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    title: 'D:\Documents and Settings\All Users\Documents\FastFieldSolvers\FasterCap\woven...'
  });
  consoleWindow.loadFile(path.join(__dirname, 'renderer', 'console-window.html'));
  consoleWindow.once('ready-to-show', () => {
    consoleWindow.show();
  });

  ipcMain.handle('get-simulated-text-content', async () => {
    return `O Geometry file generated with Wov...\n* 15X15 woven bus crossing problem\n* origin = (0 0 0)\n*\n* Bar corners: (2 0 0) (3 0 0) (2`;
  });

  ipcMain.handle('get-simulated-console-output', async () => {
    const iterations = Array.from({ length: 20 }, (_, i) => i).join(' ');
    const matrix = [
      [1.48958e-009, -1.65965e-012, -2.77457e-012, -3.55555e-012, 1.91953e-012],
      [1.03506e-012, -1.43633e-012, 4.25822e-013, 2.61491e-013, 2.2636e-013],
      [-4.92669e-012, 9.29452e-012, 7.38568e-013, -3.70903e-013, -1.17285e-010]
    ].map(row => row.join(' ')).join('\n');

    return `GMRES Iteration: ${iterations} \nGMRES Iteration: ${iterations} \nGMRES Iteration: ${iterations} \nGMRES Iteration: ${iterations} \nGMRES Iteration: ${iterations} \nGMRES Iteration: ${iterations} \nGMRES Iteration: ${iterations} \nGMRES Iteration: ${iterations} \nCapacitance matrix is:\nDimension 30 x 30\n${matrix}`;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
