import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { AppLayout } from './layout/AppLayout';
import { ConfigPage } from './pages/ConfigPage';
import { CreditPage } from './pages/CreditPage';
import { DashboardPage } from './pages/DashboardPage';
import { DefaultRedirect } from './pages/DefaultRedirect';
import { DeliveryPage } from './pages/DeliveryPage';
import { LoginPage } from './pages/LoginPage';
import { PosPage } from './pages/PosPage';
import { ProtectedRoute } from './pages/ProtectedRoute';
import { RequireRole } from './pages/RequireRole';
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
                <RequireRole roles={['ADMIN', 'MANAGER']}>
                  <DashboardPage />
                </RequireRole>
              }
            />
            <Route
              path="credit"
              element={
                <RequireRole roles={['ADMIN', 'MANAGER']}>
                  <CreditPage />
                </RequireRole>
              }
            />
            <Route
              path="stock"
              element={
                <RequireRole roles={['ADMIN', 'MANAGER', 'STOCK_MANAGER']}>
                  <StockPage />
                </RequireRole>
              }
            />
            <Route
              path="pos"
              element={
                <RequireRole roles={['ADMIN', 'MANAGER', 'CASHIER']}>
                  <PosPage />
                </RequireRole>
              }
            />
            <Route
              path="livraisons"
              element={
                <RequireRole roles={['ADMIN', 'MANAGER', 'CASHIER', 'LIVREUR', 'ACCOUNTANT']}>
                  <DeliveryPage />
                </RequireRole>
              }
            />
            <Route
              path="config"
              element={
                <RequireRole roles={['ADMIN', 'MANAGER']}>
                  <ConfigPage />
                </RequireRole>
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
