import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { AppUpdateControls } from '../components/AppUpdateControls';
import { BrandLogo } from '../components/BrandLogo';
import { BRAND_NAME } from '../config/brand';
import { useAuth } from '../context/AuthContext';
import { pendingSalesCount, syncSalesQueue } from '../services/offline-queue';
import { formatRoleLabel } from '../utils/roleLabels';

const nav: Array<{ to: string; label: string; permission: string }> = [
  { to: '/app/pos', label: 'Caisse (POS)', permission: 'pos.use' },
  { to: '/app/livraisons', label: 'Livraisons', permission: 'deliveries.view' },
  { to: '/app/dashboard', label: 'Tableau de bord', permission: 'dashboard.view' },
  { to: '/app/credit', label: 'Crédit', permission: 'credit.view' },
  { to: '/app/stock', label: 'Stocks', permission: 'stock.view' },
  { to: '/app/comptabilite', label: 'Comptabilité', permission: 'accounting.view' },
  { to: '/app/config', label: 'Configuration', permission: 'config.view' },
];

export function AppLayout() {
  const { user, logout, canPerm } = useAuth();
  const navigate = useNavigate();
  const [pendingSales, setPendingSales] = useState(0);
  const syncRunning = useRef(false);

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

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-brand">
          <BrandLogo size={36} wide />
          <span className="app-brand-text">{BRAND_NAME}</span>
          {pendingSales > 0 ? (
            <span className="app-offline-badge" title="Ventes en attente de synchronisation">
              {pendingSales} hors ligne
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
          <AppUpdateControls />
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
        <Outlet />
      </div>
    </div>
  );
}
