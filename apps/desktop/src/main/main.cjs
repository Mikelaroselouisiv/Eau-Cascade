const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { printReceipt } = require('./thermal-printer.cjs');
const localDb = require('./local-db.cjs');
const { initUpdater } = require('./updater.cjs');
const { getAppEdition } = require('./edition.cjs');
const { ensureServerStack } = require('./server-bootstrap.cjs');

const isDev = !!process.env.VITE_DEV_SERVER_URL;

function resolveWindowIcon() {
  if (process.resourcesPath) {
    const resourceIco = path.join(process.resourcesPath, 'icon.ico');
    const resourcePng = path.join(process.resourcesPath, 'icon.png');
    if (process.platform === 'win32' && fs.existsSync(resourceIco)) return resourceIco;
    if (fs.existsSync(resourcePng)) return resourcePng;
  }

  const fromRepo = path.join(__dirname, '../../../../assets/icons/icon.png');
  const fromRepoIco = path.join(__dirname, '../../../../assets/icons/icon.ico');
  const buildIco = path.join(__dirname, '../../build/icon.ico');
  const publicIco = path.join(__dirname, '../../public/icon.ico');
  const buildPng = path.join(__dirname, '../../build/icon.png');
  const devPublic = path.join(__dirname, '../../public/icon.png');
  const prodDist = path.join(__dirname, '../../dist/icon.png');

  if (process.platform === 'win32') {
    if (fs.existsSync(buildIco)) return buildIco;
    if (fs.existsSync(publicIco)) return publicIco;
    if (fs.existsSync(fromRepoIco)) return fromRepoIco;
  }

  if (fs.existsSync(fromRepo)) return fromRepo;
  if (fs.existsSync(buildPng)) return buildPng;
  const p = isDev ? devPublic : prodDist;
  return fs.existsSync(p) ? p : undefined;
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    title: 'POS Eau Cascade',
    icon: resolveWindowIcon(),
    backgroundColor: '#f7f4ef',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Installateur (file://) → API distante : sans ça, Chromium peut bloquer les appels HTTP.
      webSecurity: isDev,
    },
  });

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    // DevTools: ouvrir avec Ctrl+Shift+I (Windows/Linux) ou Cmd+Option+I (macOS).
    // Pour les ouvrir au lancement : definir ELECTRON_OPEN_DEVTOOLS=1 avant npm run dev.
    if (process.env.ELECTRON_OPEN_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

app.whenReady().then(async () => {
  app.setName('POS Eau Cascade');
  if (process.platform === 'win32') {
    const edition = getAppEdition();
    app.setAppUserModelId(
      edition === 'server'
        ? 'com.eaucascade.pos.desktop.server'
        : edition === 'remote'
          ? 'com.eaucascade.pos.desktop.remote'
          : 'com.eaucascade.pos.desktop',
    );
  }

  await localDb.initLocalDb(app.getPath('userData'));

  if (getAppEdition() === 'server' && !isDev) {
    const stack = await ensureServerStack();
    if (!stack.ok) {
      await dialog.showMessageBox({
        type: 'error',
        title: 'Serveur local',
        message: stack.message || 'Impossible de démarrer le serveur local.',
      });
    }
  }

  ipcMain.handle('localdb:outboxEnqueue', (_e, payload) => localDb.outboxEnqueue(payload));
  ipcMain.handle('localdb:outboxList', () => localDb.outboxList());
  ipcMain.handle('localdb:outboxRemove', (_e, id) => {
    localDb.outboxRemove(id);
  });
  ipcMain.handle('localdb:cacheSet', (_e, { key, json }) => {
    localDb.cacheSet(key, json);
  });
  ipcMain.handle('localdb:cacheGet', (_e, key) => localDb.cacheGet(key));

  ipcMain.handle('printer:print-receipt', async (_event, saleData) => printReceipt(saleData));
  ipcMain.handle('printer:list', async () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return [];
    return win.webContents.getPrintersAsync();
  });

  ipcMain.handle('app:get-edition', () => getAppEdition());

  createWindow();

  if (!isDev && getAppEdition() === 'remote') {
    initUpdater();
  }

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
