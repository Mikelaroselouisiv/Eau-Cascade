import { useCallback, useEffect, useState } from 'react';
import type {
  DesktopUpdaterPromptPayload,
  DesktopUpdaterSnoozeOption,
  DesktopUpdaterState,
} from '../types/updater';

const IDLE_STATE: DesktopUpdaterState = {
  status: 'disabled',
  currentVersion: '—',
  availableVersion: null,
  progress: null,
  lastCheckedAt: null,
  error: null,
  snoozeUntil: null,
  enabled: false,
  edition: 'remote',
};

function statusLabel(state: DesktopUpdaterState): string {
  switch (state.status) {
    case 'checking':
      return 'Vérification…';
    case 'available':
      return state.availableVersion
        ? `Mise à jour ${state.availableVersion}`
        : 'Mise à jour disponible';
    case 'downloading':
      return state.progress != null
        ? `Téléchargement ${Math.round(state.progress)} %`
        : 'Téléchargement…';
    case 'downloaded':
      return 'Prête à installer';
    case 'up-to-date':
      return 'À jour';
    case 'error':
      return 'Erreur de mise à jour';
    case 'disabled':
      return 'Mises à jour (installateur)';
    default:
      return 'Mises à jour';
  }
}

export function AppUpdateControls({
  variant = 'sidebar',
}: {
  /** sidebar = pied de nav ; login = écran connexion (Remote + Server). */
  variant?: 'sidebar' | 'login';
}) {
  const updater = typeof window !== 'undefined' ? window.desktopApp?.updater : undefined;
  const [state, setState] = useState<DesktopUpdaterState>(IDLE_STATE);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [snoozeOptions, setSnoozeOptions] = useState<DesktopUpdaterSnoozeOption[]>([]);
  const [promptReason, setPromptReason] = useState<DesktopUpdaterPromptPayload['reason']>();

  useEffect(() => {
    if (!updater) return;

    void updater.getState().then(setState).catch(() => undefined);
    void updater
      .getSnoozeOptions()
      .then(setSnoozeOptions)
      .catch(() => undefined);

    const offState = updater.onState(setState);
    const offPrompt = updater.onOpenPrompt((payload) => {
      setPromptReason(payload?.reason);
      setOpen(true);
    });
    return () => {
      offState();
      offPrompt();
    };
  }, [updater]);

  const run = useCallback(
    async (action: () => Promise<DesktopUpdaterState | { ok: boolean; error?: string }>) => {
      if (!updater) return;
      setBusy(true);
      try {
        const next = await action();
        if (next && 'status' in next) setState(next);
      } finally {
        setBusy(false);
      }
    },
    [updater],
  );

  if (!updater) return null;

  const hasUpdate =
    state.status === 'available' || state.status === 'downloading' || state.status === 'downloaded';
  const buttonClass = [
    'btn',
    variant === 'login' ? 'btn-secondary' : 'btn-ghost',
    'app-update-btn',
    hasUpdate ? 'app-update-btn--hot' : '',
    variant === 'login' ? 'app-update-btn--login' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const buttonLabel = hasUpdate
    ? 'Mettre à jour'
    : variant === 'login'
      ? `v${state.currentVersion} · Mise à jour`
      : `v${state.currentVersion}`;

  return (
    <>
      <button
        type="button"
        className={buttonClass}
        onClick={() => {
          setPromptReason(undefined);
          setOpen(true);
          if (state.enabled && (state.status === 'idle' || state.status === 'up-to-date')) {
            void run(() => updater.check());
          }
        }}
        title={statusLabel(state)}
      >
        {hasUpdate ? (
          <span className="app-update-dot" aria-hidden />
        ) : null}
        {buttonLabel}
      </button>

      {open ? (
        <div
          className="modal-backdrop app-update-backdrop"
          role="presentation"
          onClick={() => setOpen(false)}
        >
          <div
            className="modal card app-update-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-update-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="modal-heading">
              <h2 id="app-update-title">Mises à jour logicielles</h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
                Fermer
              </button>
            </header>

            <div className="app-update-body">
              <p className="app-update-meta">
                Version installée : <strong>{state.currentVersion}</strong>
                {state.edition ? (
                  <>
                    {' '}
                    · Édition{' '}
                    <strong>{state.edition === 'server' ? 'Server' : 'Remote'}</strong>
                  </>
                ) : null}
              </p>

              {!state.enabled ? (
                <p className="muted">
                  Les mises à jour en ligne (Remote et Server) fonctionnent dans l’application
                  installée, pas en mode développement.
                </p>
              ) : (
                <p className="muted">
                  Télécharge la dernière version publiée en ligne pour cette édition, puis
                  redémarre pour l’installer.
                </p>
              )}

              {promptReason === 'reminder' ? (
                <p className="app-update-banner">Rappel : une mise à jour est toujours disponible.</p>
              ) : null}

              {state.status === 'available' && state.availableVersion ? (
                <p>
                  La version <strong>{state.availableVersion}</strong> est disponible. Vous pouvez
                  l’installer maintenant ou programmer un rappel.
                </p>
              ) : null}

              {state.status === 'downloading' ? (
                <div className="app-update-progress-wrap">
                  <div className="app-update-progress-label">
                    Téléchargement
                    {state.progress != null ? ` — ${Math.round(state.progress)} %` : '…'}
                  </div>
                  <div className="app-update-progress-track" aria-hidden>
                    <div
                      className="app-update-progress-fill"
                      style={{ width: `${Math.max(2, state.progress ?? 5)}%` }}
                    />
                  </div>
                </div>
              ) : null}

              {state.status === 'downloaded' && state.availableVersion ? (
                <p>
                  La version <strong>{state.availableVersion}</strong> est téléchargée. Redémarrez
                  l’application pour l’installer.
                </p>
              ) : null}

              {state.status === 'up-to-date' ? (
                <p>Vous êtes à jour. Aucune nouvelle version pour le moment.</p>
              ) : null}

              {state.status === 'checking' ? <p>Vérification en cours…</p> : null}

              {state.status === 'error' && state.error ? (
                <p className="app-update-error">{state.error}</p>
              ) : null}

              {state.snoozeUntil && state.status === 'available' ? (
                <p className="muted">
                  Prochain rappel prévu :{' '}
                  {new Date(state.snoozeUntil).toLocaleString('fr-HT', {
                    timeZone: 'America/Port-au-Prince',
                  })}
                </p>
              ) : null}
            </div>

            <div className="modal-actions app-update-actions">
              {state.enabled ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy || state.status === 'checking' || state.status === 'downloading'}
                  onClick={() => void run(() => updater.check())}
                >
                  Vérifier les mises à jour
                </button>
              ) : null}

              {state.status === 'available' ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void run(() => updater.download())}
                >
                  Télécharger et préparer
                </button>
              ) : null}

              {state.status === 'downloaded' ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void run(() => updater.install())}
                >
                  Redémarrer et installer
                </button>
              ) : null}

              {state.status === 'available' || state.status === 'downloaded' ? (
                <div className="app-update-snooze">
                  <span className="app-update-snooze-label">Rappeler…</span>
                  <div className="app-update-snooze-btns">
                    {(snoozeOptions.length
                      ? snoozeOptions
                      : [
                          { id: '1h', label: 'Dans 1 heure' },
                          { id: '4h', label: 'Dans 4 heures' },
                          { id: '1d', label: 'Demain' },
                          { id: '7d', label: 'Dans 1 semaine' },
                        ]
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => {
                          void run(() => updater.snooze(opt.id));
                          setOpen(false);
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {state.status === 'available' ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() => {
                    void run(() => updater.dismiss());
                    setOpen(false);
                  }}
                >
                  Plus tard (4 h)
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
