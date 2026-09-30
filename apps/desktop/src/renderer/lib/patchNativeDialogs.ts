/**
 * Remplace window.confirm / alert (TaskDialog Win32) par IPC Electron
 * + restauration du focus clavier. Sans ça, les champs texte se figent
 * après une confirmation native jusqu’au redémarrage de l’app.
 */
export function patchNativeDialogs(): void {
  const api = window.desktopApp;
  if (!api?.confirmSync || !api.alertSync) return;

  window.confirm = (message?: string) => api.confirmSync(String(message ?? ''));
  window.alert = (message?: unknown) => {
    api.alertSync(String(message ?? ''));
  };

  const restore = () => api.restoreKeyboardFocus?.();
  window.addEventListener('afterprint', restore);
  document.addEventListener(
    'change',
    (e) => {
      const t = e.target;
      if (t instanceof HTMLInputElement && t.type === 'file') restore();
    },
    true,
  );
}
