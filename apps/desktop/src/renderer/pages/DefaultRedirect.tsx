import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function DefaultRedirect() {
  const { user, canPerm } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (canPerm('pos.use') && user.role === 'CASHIER') {
    return <Navigate to="/app/pos" replace />;
  }
  if (canPerm('deliveries.view') && user.role === 'LIVREUR') {
    return <Navigate to="/app/livraisons" replace />;
  }
  if (canPerm('stock.view') && user.role === 'STOCK_MANAGER') {
    return <Navigate to="/app/stock" replace />;
  }
  if (canPerm('dashboard.view')) {
    return <Navigate to="/app/dashboard" replace />;
  }
  if (canPerm('accounting.view') && user.role === 'ACCOUNTANT') {
    return <Navigate to="/app/comptabilite" replace />;
  }
  if (canPerm('pos.use')) return <Navigate to="/app/pos" replace />;
  if (canPerm('deliveries.view')) return <Navigate to="/app/livraisons" replace />;
  if (canPerm('stock.view')) return <Navigate to="/app/stock" replace />;
  if (canPerm('credit.view')) return <Navigate to="/app/credit" replace />;
  if (canPerm('accounting.view')) return <Navigate to="/app/comptabilite" replace />;
  if (canPerm('config.view')) return <Navigate to="/app/config" replace />;
  return <Navigate to="/app/pos" replace />;
}
