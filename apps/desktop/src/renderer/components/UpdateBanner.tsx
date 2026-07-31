import type { UpdaterStatus } from '../desktop-app';

type Props = {
  status: UpdaterStatus;
  checking: boolean;
  onCheck: () => void;
  onInstall: () => void;
  onDismiss: () => void;
};

export function UpdateBanner({ status, checking, onCheck, onInstall, onDismiss }: Props) {
  const state = status.state;
  if (
    state !== 'available' &&
    state !== 'downloading' &&
    state !== 'downloaded' &&
    state !== 'error'
  ) {
    return null;
  }

  const title =
    state === 'downloaded'
      ? 'Mise à jour prête'
      : state === 'downloading' || state === 'available'
        ? 'Mise à jour en cours'
        : 'Mise à jour';

  const detail =
    status.message ||
    (status.version ? `Version ${status.version}` : 'Une nouvelle version est disponible.');

  return (
    <div
      className={`app-update-banner app-update-banner--${state}`}
      role="status"
      aria-live="polite"
    >
      <div className="app-update-banner-copy">
        <strong>{title}</strong>
        <span>{detail}</span>
        {state === 'downloading' && typeof status.percent === 'number' ? (
          <div className="app-update-progress" aria-hidden>
            <div
              className="app-update-progress-fill"
              style={{ width: `${Math.max(2, Math.min(100, status.percent))}%` }}
            />
          </div>
        ) : null}
      </div>
      <div className="app-update-banner-actions">
        {state === 'downloaded' ? (
          <button type="button" className="btn btn-primary" onClick={onInstall}>
            Redémarrer et mettre à jour
          </button>
        ) : null}
        {state === 'error' ? (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCheck}
            disabled={checking}
          >
            {checking ? 'Vérification…' : 'Réessayer'}
          </button>
        ) : null}
        {state !== 'downloading' ? (
          <button type="button" className="btn btn-ghost" onClick={onDismiss}>
            Plus tard
          </button>
        ) : null}
      </div>
    </div>
  );
}
