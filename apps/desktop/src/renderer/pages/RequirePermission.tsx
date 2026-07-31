import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/** Garde de route basée sur les autorisations AppRole (pas le code MANAGER/ADMIN). */
export function RequirePermission({
  permission,
  children,
}: {
  permission: string | string[];
  children: ReactNode;
}) {
  const { user, canPerm } = useAuth();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  const needed = Array.isArray(permission) ? permission : [permission];
  const ok = needed.some((p) => canPerm(p));
  if (!ok) {
    return <Navigate to="/app" replace />;
  }
  return <>{children}</>;
}
