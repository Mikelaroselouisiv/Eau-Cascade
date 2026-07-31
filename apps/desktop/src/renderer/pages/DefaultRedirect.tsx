import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const LANDING: Array<{ permission: string; to: string }> = [
  { permission: 'dashboard.view', to: '/app/dashboard' },
  { permission: 'pos.use', to: '/app/pos' },
  { permission: 'deliveries.view', to: '/app/livraisons' },
  { permission: 'stock.view', to: '/app/stock' },
  { permission: 'credit.view', to: '/app/credit' },
  { permission: 'config.view', to: '/app/config' },
];

export function DefaultRedirect() {
  const { user, canPerm } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  const hit = LANDING.find((r) => canPerm(r.permission));
  return <Navigate to={hit?.to ?? '/app/pos'} replace />;
}
