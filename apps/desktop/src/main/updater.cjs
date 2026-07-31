const { autoUpdater } = require('electron-updater');
const { BrowserWindow, dialog } = require('electron');
const { getAppEdition } = require('./edition.cjs');
const { UPDATE_FEEDS } = require('./update-feed.cjs');

/** @type {import('electron').BrowserWindow | null} */
let mainWindow = null;
let initialized = false;
let checking = false;

/** @type {{
 *   state: 'idle'|'checking'|'available'|'not-available'|'downloading'|'downloaded'|'error'|'disabled',
 *   version?: string,
 *   currentVersion?: string,
 *   percent?: number,
 *   message?: string,
 * }} */
let lastStatus = {
  state: 'idle',
  currentVersion: undefined,
};

function getAppVersion() {
  try {
    const { app } = require('electron');
    return app.getVersion();
  } catch {
    return undefined;
  }
}

function broadcast(status) {
  lastStatus = {
    currentVersion: getAppVersion(),
    ...status,
  };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('updater:status', lastStatus);
    }
  }
}

function setMainWindow(win) {
  mainWindow = win || null;
}

function isUpdaterEnabled() {
  const edition = getAppEdition();
  return (
    (edition === 'remote' || edition === 'server') &&
    !process.env.VITE_DEV_SERVER_URL
  );
}

function getUpdateFeedUrl() {
  return getAppEdition() === 'server' ? UPDATE_FEEDS.server : UPDATE_FEEDS.remote;
}

function initUpdater(win) {
  if (win) setMainWindow(win);
  lastStatus.currentVersion = getAppVersion();

  if (!isUpdaterEnabled()) {
    broadcast({
      state: 'disabled',
      message: 'Mises à jour indisponibles en mode développement.',
    });
    return;
  }

  if (initialized) return;
  initialized = true;

  const feedUrl = getUpdateFeedUrl();
  const edition = getAppEdition();
  console.log(`[updater] edition=${edition} feed=${feedUrl}`);

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // Server embarque Docker (~400 Mo) : le diff/blockmap est fragile → téléchargement complet.
  if (edition === 'server') {
    autoUpdater.disableDifferentialDownload = true;
  }
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: feedUrl,
  });

  autoUpdater.on('checking-for-update', () => {
    checking = true;
    broadcast({ state: 'checking', message: 'Recherche de mise à jour…' });
  });

  autoUpdater.on('update-available', (info) => {
    checking = false;
    broadcast({
      state: 'available',
      version: info?.version,
      message: `Version ${info?.version ?? ''} disponible — téléchargement…`,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    checking = false;
    broadcast({
      state: 'not-available',
      version: info?.version,
      message: 'Application déjà à jour.',
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.max(0, Math.min(100, Number(progress?.percent) || 0));
    broadcast({
      state: 'downloading',
      version: lastStatus.version,
      percent,
      message: `Téléchargement ${percent.toFixed(0)} %`,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    checking = false;
    broadcast({
      state: 'downloaded',
      version: info?.version,
      percent: 100,
      message: `Version ${info?.version ?? ''} prête — redémarrez pour installer.`,
    });

    // Fallback si aucune fenêtre UI n’écoute (ex. démarrage très tôt).
    const hasWindow = BrowserWindow.getAllWindows().some((w) => !w.isDestroyed());
    if (!hasWindow) {
      void dialog
        .showMessageBox({
          type: 'question',
          buttons: ['Redémarrer maintenant', 'Plus tard'],
          defaultId: 0,
          cancelId: 1,
          title: 'Mise à jour prête',
          message: `La version ${info?.version ?? ''} est prête à être installée.`,
        })
        .then(({ response }) => {
          if (response === 0) autoUpdater.quitAndInstall(false, true);
        });
    }
  });

  autoUpdater.on('error', (error) => {
    checking = false;
    const message = error?.message || String(error);
    console.error('[updater]', message);
    broadcast({ state: 'error', message: `Erreur mise à jour : ${message}` });
  });

  void checkForUpdatesManual({ silent: true });

  const fourHoursMs = 4 * 60 * 60 * 1000;
  setInterval(() => {
    void checkForUpdatesManual({ silent: true });
  }, fourHoursMs);
}

async function checkForUpdatesManual(opts = {}) {
  const silent = !!opts.silent;
  lastStatus.currentVersion = getAppVersion();

  if (!isUpdaterEnabled()) {
    const status = {
      state: 'disabled',
      message: 'Mises à jour indisponibles en mode développement.',
    };
    broadcast(status);
    return status;
  }

  if (!initialized) {
    initUpdater(mainWindow);
  }

  if (checking) {
    return { ...lastStatus };
  }

  try {
    if (!silent) {
      broadcast({ state: 'checking', message: 'Recherche de mise à jour…' });
    }
    const result = await autoUpdater.checkForUpdates();
    // Les événements mettent à jour lastStatus ; renvoyer l’état courant.
    return {
      ...lastStatus,
      updateInfo: result?.updateInfo
        ? { version: result.updateInfo.version }
        : undefined,
    };
  } catch (error) {
    const message = error?.message || String(error);
    const status = { state: 'error', message: `Erreur mise à jour : ${message}` };
    broadcast(status);
    return status;
  }
}

function quitAndInstall() {
  if (!isUpdaterEnabled()) return { ok: false, reason: 'disabled' };
  try {
    // isSilent=false, isForceRunAfter=true — relance l’app après install NSIS.
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error?.message || String(error) };
  }
}

function getUpdaterStatus() {
  return {
    ...lastStatus,
    currentVersion: getAppVersion(),
    enabled: isUpdaterEnabled(),
  };
}

module.exports = {
  initUpdater,
  setMainWindow,
  checkForUpdatesManual,
  quitAndInstall,
  getUpdaterStatus,
  getAppVersion,
};
