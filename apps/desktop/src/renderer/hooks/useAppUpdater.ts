import { useCallback, useEffect, useState } from 'react';
import type { UpdaterStatus } from '../desktop-app';

const IDLE: UpdaterStatus = { state: 'idle' };

export function useAppUpdater() {
  const [status, setStatus] = useState<UpdaterStatus>(IDLE);
  const [appVersion, setAppVersion] = useState<string>('');
  const available = Boolean(window.desktopApp?.updater);

  useEffect(() => {
    const desktop = window.desktopApp;
    if (!desktop) return;

    void desktop.getVersion?.().then((v) => {
      if (v) setAppVersion(v);
    });

    const updater = desktop.updater;
    if (!updater) return;

    void updater.getStatus().then((s) => {
      setStatus(s);
      if (s.currentVersion) setAppVersion(s.currentVersion);
    });

    return updater.onStatus((next) => {
      setStatus(next);
      if (next.currentVersion) setAppVersion(next.currentVersion);
    });
  }, []);

  const checkForUpdates = useCallback(async () => {
    const updater = window.desktopApp?.updater;
    if (!updater) return null;
    const next = await updater.check();
    setStatus(next);
    if (next.currentVersion) setAppVersion(next.currentVersion);
    return next;
  }, []);

  const quitAndInstall = useCallback(async () => {
    const updater = window.desktopApp?.updater;
    if (!updater) return;
    await updater.quitAndInstall();
  }, []);

  return {
    available,
    status,
    appVersion,
    checkForUpdates,
    quitAndInstall,
  };
}
