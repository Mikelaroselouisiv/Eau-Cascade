import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/** Garde de route basée sur les autorisations du rôle (Config → Rôles). */
export function RequirePermission({
  permission,
  anyOf,
  children,
}: {
  permission?: string;
  anyOf?: string[];
  children: ReactNode;
}) {
  const { canPerm } = useAuth();
  const ok = anyOf?.length
    ? anyOf.some((p) => canPerm(p))
    : permission
      ? canPerm(permission)
      : false;
  if (!ok) {
    return <Navigate to="/app" replace />;
  }
  return <>{children}</>;
}
