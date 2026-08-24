import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { AppLayout } from './layout/AppLayout';
import { AccountingPage } from './pages/AccountingPage';
import { ConfigPage } from './pages/ConfigPage';
import { CreditPage } from './pages/CreditPage';
import { DashboardPage } from './pages/DashboardPage';
import { DefaultRedirect } from './pages/DefaultRedirect';
import { DeliveryPage } from './pages/DeliveryPage';
import { LoginPage } from './pages/LoginPage';
import { PosPage } from './pages/PosPage';
import { ProtectedRoute } from './pages/ProtectedRoute';
import { RequirePermission } from './pages/RequirePermission';
import { StockPage } from './pages/StockPage';

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/app"
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DefaultRedirect />} />
            <Route
              path="dashboard"
              element={
                <RequirePermission permission="dashboard.view">
                  <DashboardPage />
                </RequirePermission>
              }
            />
            <Route
              path="credit"
              element={
                <RequirePermission permission="credit.view">
                  <CreditPage />
                </RequirePermission>
              }
            />
            <Route
              path="stock"
              element={
                <RequirePermission anyOf={['stock.view', 'stock.manage', 'inventory.physical']}>
                  <StockPage />
                </RequirePermission>
              }
            />
            <Route
              path="pos"
              element={
                <RequirePermission permission="pos.use">
                  <PosPage />
                </RequirePermission>
              }
            />
            <Route
              path="livraisons"
              element={
                <RequirePermission permission="deliveries.view">
                  <DeliveryPage />
                </RequirePermission>
              }
            />
            <Route
              path="comptabilite"
              element={
                <RequirePermission permission="accounting.view">
                  <AccountingPage />
                </RequirePermission>
              }
            />
            <Route
              path="config"
              element={
                <RequirePermission permission="config.view">
                  <ConfigPage />
                </RequirePermission>
              }
            />
          </Route>
          <Route path="/" element={<Navigate to="/app" replace />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </AuthProvider>
    </HashRouter>
  );
}
