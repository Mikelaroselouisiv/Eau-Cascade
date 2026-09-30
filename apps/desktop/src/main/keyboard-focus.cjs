/**
 * Windows + Electron : après un dialogue natif (confirm/alert/print/fichier),
 * la fenêtre a l’air active mais le renderer n’accepte plus le clavier
 * jusqu’au redémarrage (ou un Alt-Tab). Chromium ne restaure pas le focus
 * après un TaskDialog Win32.
 *
 * https://github.com/electron/electron/issues/31917
 */
function restoreKeyboardFocus(win) {
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.focus();
  } catch {
    /* ignore */
  }
  if (process.platform !== 'win32') return;
  try {
    win.blur();
    win.focus();
    win.webContents.focus();
  } catch {
    /* ignore */
  }
}

function registerKeyboardFocusIpc(ipcMain, BrowserWindow, dialog) {
  ipcMain.on('app:confirm-sync', (event, message) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts = {
      type: 'question',
      buttons: ['Annuler', 'OK'],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
      message: String(message ?? ''),
    };
    const result =
      win && !win.isDestroyed()
        ? dialog.showMessageBoxSync(win, opts)
        : dialog.showMessageBoxSync(opts);
    restoreKeyboardFocus(win);
    event.returnValue = result === 1;
  });

  ipcMain.on('app:alert-sync', (event, message) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts = {
      type: 'info',
      buttons: ['OK'],
      defaultId: 0,
      noLink: true,
      message: String(message ?? ''),
    };
    if (win && !win.isDestroyed()) dialog.showMessageBoxSync(win, opts);
    else dialog.showMessageBoxSync(opts);
    restoreKeyboardFocus(win);
    event.returnValue = true;
  });

  ipcMain.on('app:restore-keyboard-focus', (event) => {
    restoreKeyboardFocus(BrowserWindow.fromWebContents(event.sender));
    event.returnValue = true;
  });
}

module.exports = { restoreKeyboardFocus, registerKeyboardFocusIpc };
