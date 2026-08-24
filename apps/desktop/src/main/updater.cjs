const fs = require('fs');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const { app, BrowserWindow, ipcMain, Notification } = require('electron');
const { getAppEdition } = require('./edition.cjs');
const { UPDATE_FEEDS } = require('./update-feed.cjs');

const SNOOZE_MS = {
  '1h': 1 * 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

const DEFAULT_SNOOZE = '4h';
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** @type {{
 *  status: 'idle'|'checking'|'available'|'downloading'|'downloaded'|'up-to-date'|'error'|'disabled',
 *  currentVersion: string,
 *  availableVersion: string|null,
 *  progress: number|null,
 *  lastCheckedAt: string|null,
 *  error: string|null,
 *  snoozeUntil: string|null,
 *  enabled: boolean,
 *  edition: string,
 * }} */
let state = {
  status: 'disabled',
  currentVersion: '0.0.0',
  availableVersion: null,
  progress: null,
  lastCheckedAt: null,
  error: null,
  snoozeUntil: null,
  enabled: false,
  edition: 'remote',
};

/** @type {ReturnType<typeof setTimeout>|null} */
let snoozeTimer = null;
/** @type {ReturnType<typeof setInterval>|null} */
let checkTimer = null;
let ipcRegistered = false;
let updaterWired = false;

function prefsPath() {
  return path.join(app.getPath('userData'), 'updater-prefs.json');
}

function readPrefs() {
  try {
    const raw = fs.readFileSync(prefsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      snoozeUntil: typeof parsed.snoozeUntil === 'number' ? parsed.snoozeUntil : null,
      snoozeVersion: typeof parsed.snoozeVersion === 'string' ? parsed.snoozeVersion : null,
    };
  } catch {
    return { snoozeUntil: null, snoozeVersion: null };
  }
}

function writePrefs(prefs) {
  try {
    fs.writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2), 'utf8');
  } catch (err) {
    console.error('[updater] prefs write failed', err?.message || err);
  }
}

function broadcast() {
  const payload = getPublicState();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('updater:state', payload);
    }
  }
}

function setState(patch) {
  state = { ...state, ...patch };
  broadcast();
}

function getPublicState() {
  return {
    status: state.status,
    currentVersion: state.currentVersion,
    availableVersion: state.availableVersion,
    progress: state.progress,
    lastCheckedAt: state.lastCheckedAt,
    error: state.error,
    snoozeUntil: state.snoozeUntil,
    enabled: state.enabled,
    edition: state.edition,
  };
}

function isSnoozed(version) {
  const prefs = readPrefs();
  if (!prefs.snoozeUntil) return false;
  if (prefs.snoozeVersion && version && prefs.snoozeVersion !== version) return false;
  return Date.now() < prefs.snoozeUntil;
}

function clearSnoozeTimer() {
  if (snoozeTimer) {
    clearTimeout(snoozeTimer);
    snoozeTimer = null;
  }
}

function scheduleSnoozeWake(version) {
  clearSnoozeTimer();
  const prefs = readPrefs();
  if (!prefs.snoozeUntil) return;
  const delay = prefs.snoozeUntil - Date.now();
  if (delay <= 0) {
    maybePromptAvailable(version, true);
    return;
  }
  snoozeTimer = setTimeout(() => {
    snoozeTimer = null;
    maybePromptAvailable(version || state.availableVersion, true);
  }, delay);
}

function showOsNotification(title, body) {
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body });
    n.on('click', () => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
        win.focus();
        win.webContents.send('updater:open-prompt');
      }
    });
    n.show();
  } catch (err) {
    console.error('[updater] notification failed', err?.message || err);
  }
}

function maybePromptAvailable(version, forceReminder) {
  if (!version) return;
  if (!forceReminder && isSnoozed(version)) {
    scheduleSnoozeWake(version);
    return;
  }

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('updater:open-prompt', {
        reason: forceReminder ? 'reminder' : 'available',
        version,
      });
    }
  }

  showOsNotification(
    forceReminder ? 'Rappel — mise à jour' : 'Mise à jour disponible',
    `La version ${version} est disponible pour POS Eau Cascade.`,
  );
}

function applySnooze(optionKey, version) {
  const ms = SNOOZE_MS[optionKey] || SNOOZE_MS[DEFAULT_SNOOZE];
  const until = Date.now() + ms;
  const v = version || state.availableVersion;
  writePrefs({ snoozeUntil: until, snoozeVersion: v });
  setState({ snoozeUntil: new Date(until).toISOString() });
  scheduleSnoozeWake(v);
  return getPublicState();
}

function clearSnooze() {
  writePrefs({ snoozeUntil: null, snoozeVersion: null });
  clearSnoozeTimer();
  setState({ snoozeUntil: null });
}

async function runCheck({ manual = false } = {}) {
  if (!state.enabled) {
    return getPublicState();
  }
  if (state.status === 'checking' || state.status === 'downloading') {
    return getPublicState();
  }

  setState({ status: 'checking', error: null });
  try {
    const result = await autoUpdater.checkForUpdates();
    const checkedAt = new Date().toISOString();
    const info = result?.updateInfo;
    const remoteVersion = info?.version || null;
    const statusNow = state.status;

    // Pendant l’await, download / downloaded peuvent déjà avoir avancé.
    if (statusNow === 'downloaded' || statusNow === 'downloading') {
      setState({
        lastCheckedAt: checkedAt,
        availableVersion: remoteVersion || state.availableVersion,
      });
      return getPublicState();
    }

    if (!remoteVersion || remoteVersion === state.currentVersion) {
      setState({
        status: 'up-to-date',
        availableVersion: null,
        progress: null,
        lastCheckedAt: checkedAt,
      });
      return getPublicState();
    }

    setState({
      status: 'available',
      availableVersion: remoteVersion,
      progress: null,
      lastCheckedAt: checkedAt,
    });
    if (manual || !isSnoozed(remoteVersion)) {
      maybePromptAvailable(remoteVersion, false);
    } else {
      scheduleSnoozeWake(remoteVersion);
    }
    return getPublicState();
  } catch (err) {
    const message = err?.message || String(err);
    console.error('[updater] check failed', message);
    setState({
      status: 'error',
      error: message,
      lastCheckedAt: new Date().toISOString(),
    });
    return getPublicState();
  }
}

function wireAutoUpdater() {
  if (updaterWired) return;
  updaterWired = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (error) => {
    const message = error?.message || String(error);
    console.error('[updater]', message);
    setState({ status: 'error', error: message });
  });

  autoUpdater.on('update-available', (info) => {
    const version = info?.version || null;
    setState({
      status: state.status === 'downloading' ? 'downloading' : 'available',
      availableVersion: version,
      error: null,
    });
  });

  autoUpdater.on('update-not-available', () => {
    setState({
      status: 'up-to-date',
      availableVersion: null,
      progress: null,
      error: null,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    const pct =
      typeof progress?.percent === 'number' ? Math.max(0, Math.min(100, progress.percent)) : null;
    setState({ status: 'downloading', progress: pct });
  });

  autoUpdater.on('update-downloaded', (info) => {
    const version = info?.version || state.availableVersion;
    clearSnooze();
    setState({
      status: 'downloaded',
      availableVersion: version,
      progress: 100,
      error: null,
    });
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('updater:open-prompt', {
          reason: 'downloaded',
          version,
        });
      }
    }
    showOsNotification(
      'Mise à jour prête',
      `La version ${version} est téléchargée. Redémarrez pour l'installer.`,
    );
  });
}

function registerIpc() {
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.handle('updater:get-state', () => getPublicState());
  ipcMain.handle('updater:check', async () => runCheck({ manual: true }));
  ipcMain.handle('updater:download', async () => {
    if (!state.enabled) return getPublicState();
    if (state.status === 'downloaded') return getPublicState();
    clearSnooze();
    setState({ status: 'downloading', progress: 0, error: null });
    try {
      await autoUpdater.downloadUpdate();
    } catch (err) {
      const message = err?.message || String(err);
      setState({ status: 'error', error: message });
    }
    return getPublicState();
  });
  ipcMain.handle('updater:install', () => {
    if (!state.enabled) return { ok: false };
    try {
      autoUpdater.quitAndInstall(false, true);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });
  ipcMain.handle('updater:snooze', (_e, optionKey) => {
    const key = typeof optionKey === 'string' && SNOOZE_MS[optionKey] ? optionKey : DEFAULT_SNOOZE;
    return applySnooze(key, state.availableVersion);
  });
  ipcMain.handle('updater:dismiss', () => applySnooze(DEFAULT_SNOOZE, state.availableVersion));
  ipcMain.handle('updater:get-snooze-options', () => [
    { id: '1h', label: 'Dans 1 heure' },
    { id: '4h', label: 'Dans 4 heures' },
    { id: '1d', label: 'Demain' },
    { id: '7d', label: 'Dans 1 semaine' },
  ]);
}

/**
 * Active les mises à jour (Remote + Server packagés) et l’API IPC.
 * En dev, l’IPC répond avec enabled=false pour que l’UI reste stable.
 */
function initUpdater() {
  const edition = getAppEdition();
  const feed = UPDATE_FEEDS[edition];
  const packaged = app.isPackaged && !process.env.VITE_DEV_SERVER_URL;
  const enabled = Boolean(packaged && feed);

  state = {
    ...state,
    currentVersion: app.getVersion(),
    edition,
    enabled,
    status: enabled ? 'idle' : 'disabled',
  };

  registerIpc();

  if (!enabled || !feed) {
    broadcast();
    return;
  }

  autoUpdater.setFeedURL({
    provider: 'generic',
    url: feed,
  });
  wireAutoUpdater();

  const prefs = readPrefs();
  if (prefs.snoozeUntil && Date.now() < prefs.snoozeUntil) {
    setState({ snoozeUntil: new Date(prefs.snoozeUntil).toISOString() });
  }

  // Première vérif après un court délai (laisser la fenêtre s’ouvrir).
  setTimeout(() => {
    void runCheck({ manual: false });
  }, 8_000);

  if (checkTimer) clearInterval(checkTimer);
  checkTimer = setInterval(() => {
    void runCheck({ manual: false });
  }, CHECK_INTERVAL_MS);
}

module.exports = { initUpdater, getPublicState };
