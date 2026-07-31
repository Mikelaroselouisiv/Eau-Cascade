import type { UpdaterStatus } from '../desktop-app';

type Props = {
  status: UpdaterStatus;
  appVersion?: string;
  checking: boolean;
  hint?: string;
  onCheck: () => void;
  onInstall: () => void;
  /** Compact = sidebar ; full = login / bannière légère */
  variant?: 'sidebar' | 'login';
};

export function UpdateControls({
  status,
  appVersion,
  checking,
  hint,
  onCheck,
  onInstall,
  variant = 'sidebar',
}: Props) {
  if (status.state === 'disabled') {
    return appVersion ? (
      <div className={`app-version-block app-version-block--${variant}`}>
        <span className="app-version-label">v{appVersion}</span>
        <div className="app-version-hint">MAJ auto indisponible sur cette install</div>
      </div>
    ) : null;
  }

  const busy = checking || status.state === 'checking' || status.state === 'downloading';
  const percent =
    typeof status.percent === 'number' ? Math.max(0, Math.min(100, status.percent)) : null;

  let actionLabel = 'Mettre à jour';
  if (status.state === 'downloaded') actionLabel = 'Installer';
  else if (status.state === 'downloading' && percent != null) actionLabel = `${percent.toFixed(0)} %`;
  else if (status.state === 'downloading' || status.state === 'available') actionLabel = 'Téléchargement…';
  else if (busy) actionLabel = 'Vérification…';

  const showHint =
    hint ||
    (status.state === 'error' ? status.message : '') ||
    (status.state === 'downloading' && status.version
      ? `Téléchargement v${status.version}…`
      : '');

  return (
    <div className={`app-version-block app-version-block--${variant}`}>
      <div className="app-version-row">
        {appVersion ? <span className="app-version-label">v{appVersion}</span> : null}
        {status.state === 'downloaded' ? (
          <button type="button" className="btn btn-primary app-update-check-btn" onClick={onInstall}>
            Installer
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-ghost app-update-check-btn"
            onClick={onCheck}
            disabled={busy && status.state !== 'error'}
          >
            {actionLabel}
          </button>
        )}
      </div>
      {status.state === 'downloading' && percent != null ? (
        <div className="app-update-progress app-update-progress--inline" aria-hidden>
          <div
            className="app-update-progress-fill"
            style={{ width: `${Math.max(2, percent)}%` }}
          />
        </div>
      ) : null}
      {showHint ? <div className="app-version-hint">{showHint}</div> : null}
    </div>
  );
}
