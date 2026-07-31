import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { BrandLogo } from '../components/BrandLogo';
import { UpdateBanner } from '../components/UpdateBanner';
import { BRAND_NAME } from '../config/brand';
import { useAuth } from '../context/AuthContext';
import { useAppUpdater } from '../hooks/useAppUpdater';
import { pendingSalesCount, syncSalesQueue } from '../services/offline-queue';
import { formatRoleLabel } from '../utils/roleLabels';

const nav: Array<{ to: string; label: string; permission: string }> = [
  { to: '/app/pos', label: 'Caisse (POS)', permission: 'pos.use' },
  { to: '/app/livraisons', label: 'Livraisons', permission: 'deliveries.view' },
  { to: '/app/dashboard', label: 'Tableau de bord', permission: 'dashboard.view' },
  { to: '/app/credit', label: 'Crédit', permission: 'credit.view' },
  { to: '/app/stock', label: 'Stocks', permission: 'stock.view' },
  { to: '/app/config', label: 'Configuration', permission: 'config.view' },
];

export function AppLayout() {
  const { user, logout, canPerm } = useAuth();
  const navigate = useNavigate();
  const [pendingSales, setPendingSales] = useState(0);
  const syncRunning = useRef(false);
  const { available: updaterAvailable, status, appVersion, checkForUpdates, quitAndInstall } =
    useAppUpdater();
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [checkHint, setCheckHint] = useState('');

  useEffect(() => {
    // Nouvelle version / nouvel état → réafficher la bannière.
    setUpdateDismissed(false);
    if (
      status.state === 'available' ||
      status.state === 'downloading' ||
      status.state === 'downloaded' ||
      status.state === 'error'
    ) {
      setCheckHint('');
    }
  }, [status.state, status.version]);

  const refreshPending = useCallback(() => {
    void pendingSalesCount().then(setPendingSales);
  }, []);

  useEffect(() => {
    refreshPending();
  }, [refreshPending]);

  useEffect(() => {
    const onPendingChanged = () => refreshPending();
    window.addEventListener('pos-pending-sales-changed', onPendingChanged);
    return () => window.removeEventListener('pos-pending-sales-changed', onPendingChanged);
  }, [refreshPending]);

  const syncPendingSales = useCallback(async () => {
    if (syncRunning.current) return;
    syncRunning.current = true;
    try {
      const result = await syncSalesQueue();
      refreshPending();
      if (result.synced > 0) {
        window.dispatchEvent(new CustomEvent('pos-offline-synced', { detail: result }));
      }
    } catch {
      // La file reste sur disque et sera retentée au prochain passage.
    } finally {
      syncRunning.current = false;
    }
  }, [refreshPending]);

  useEffect(() => {
    const onOnline = () => {
      void syncPendingSales();
    };

    window.addEventListener('online', onOnline);
    void syncPendingSales();
    const timer = window.setInterval(() => void syncPendingSales(), 30_000);
    return () => {
      window.removeEventListener('online', onOnline);
      window.clearInterval(timer);
    };
  }, [syncPendingSales]);

  const visible = nav.filter((item) => canPerm(item.permission));

  const showUpdateBanner =
    updaterAvailable &&
    !updateDismissed &&
    (status.state === 'available' ||
      status.state === 'downloading' ||
      status.state === 'downloaded' ||
      status.state === 'error');

  async function onCheckUpdates() {
    if (!updaterAvailable || updateChecking) return;
    setUpdateChecking(true);
    setUpdateDismissed(false);
    setCheckHint('');
    try {
      const next = await checkForUpdates();
      if (next?.state === 'not-available') {
        setCheckHint('Déjà à jour');
      } else if (next?.state === 'error') {
        setCheckHint(next.message || 'Erreur');
      }
    } finally {
      setUpdateChecking(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-brand">
          <BrandLogo size={42} wide />
          <span className="app-brand-text">{BRAND_NAME}</span>
          {pendingSales > 0 ? (
            <span className="app-offline-badge" title="Ventes en attente de synchronisation">
              {pendingSales} hors ligne
            </span>
          ) : null}
          {status.state === 'downloaded' ? (
            <span className="app-update-badge" title="Mise à jour prête à installer">
              MAJ prête
            </span>
          ) : status.state === 'downloading' || status.state === 'available' ? (
            <span className="app-update-badge app-update-badge--busy" title="Téléchargement…">
              MAJ…
            </span>
          ) : null}
        </div>
        <nav className="app-nav">
          {visible.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? 'app-nav-link active' : 'app-nav-link')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="app-sidebar-footer">
          <div className="app-user">
            <div className="app-user-name">
              {user?.fullName?.trim() || 'Utilisateur'}
            </div>
            <div className="app-user-email">{user?.phone}</div>
            <div className="app-user-role">{formatRoleLabel(user?.role, user?.roleLabel)}</div>
          </div>
          {appVersion ? (
            <div className="app-version-block">
              <div className="app-version-row">
                <span className="app-version-label">v{appVersion}</span>
                {updaterAvailable && status.state !== 'disabled' ? (
                  status.state === 'downloaded' ? (
                    <button
                      type="button"
                      className="btn btn-primary app-update-check-btn"
                      onClick={() => void quitAndInstall()}
                    >
                      Installer
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost app-update-check-btn"
                      onClick={() => void onCheckUpdates()}
                      disabled={updateChecking || status.state === 'downloading'}
                    >
                      {updateChecking || status.state === 'checking'
                        ? 'Vérification…'
                        : 'Mettre à jour'}
                    </button>
                  )
                ) : null}
              </div>
              {checkHint ? <div className="app-version-hint">{checkHint}</div> : null}
            </div>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              logout();
              navigate('/login', { replace: true });
            }}
          >
            Déconnexion
          </button>
        </div>
      </aside>
      <div className="app-main">
        {showUpdateBanner ? (
          <UpdateBanner
            status={status}
            checking={updateChecking}
            onCheck={() => void onCheckUpdates()}
            onInstall={() => void quitAndInstall()}
            onDismiss={() => setUpdateDismissed(true)}
          />
        ) : null}
        <Outlet />
      </div>
    </div>
  );
}
