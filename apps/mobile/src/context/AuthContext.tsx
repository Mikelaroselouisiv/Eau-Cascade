import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  getMe,
  getSessionUser,
  getToken,
  initAuthCache,
  login as apiLogin,
  logout as apiLogout,
} from '../services/api';
import { isLikelyNetworkError } from '../services/api-errors';
import { initDb } from '../services/db';
import type { SessionUser, UserRole } from '../types/api';
import { permissionsInclude, resolveUserPermissions } from '../utils/permissions';

type AuthContextValue = {
  user: SessionUser | null;
  loading: boolean;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  can: (roles: UserRole[]) => boolean;
  canPerm: (permission: string) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      return;
    }
    const u = await getMe();
    setUser(u);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await initAuthCache();
      } catch {
        // ignore cache hydrate errors
      }
      try {
        await initDb();
      } catch {
        // SQLite indisponible : l’app continue (file offline limitée)
      }
      if (!getToken()) {
        if (!cancelled) {
          setUser(null);
          setLoading(false);
        }
        return;
      }
      try {
        const u = await getMe();
        if (!cancelled) setUser(u);
      } catch (error) {
        if (!cancelled) {
          const cached = getSessionUser();
          if (isLikelyNetworkError(error) && cached) {
            setUser(cached);
          } else {
            await apiLogout();
            setUser(null);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (phone: string, password: string) => {
    const res = await apiLogin(phone, password);
    try {
      const u = await getMe();
      setUser(u);
    } catch {
      setUser(res.user);
    }
  }, []);

  const logout = useCallback(() => {
    void apiLogout();
    setUser(null);
  }, []);

  const resolvedPerms = useMemo(
    () => (user ? resolveUserPermissions(user) : []),
    [user],
  );

  const can = useCallback(
    (roles: UserRole[]) => {
      if (!user) return false;
      if (roles.includes(user.role)) return true;
      // Accès complet via * (rôle custom admin, etc.)
      return permissionsInclude(resolvedPerms, '*');
    },
    [user, resolvedPerms],
  );

  const canPerm = useCallback(
    (permission: string) => {
      if (!user) return false;
      return permissionsInclude(resolvedPerms, permission);
    },
    [user, resolvedPerms],
  );

  const value = useMemo(
    () => ({ user, loading, login, logout, refreshUser, can, canPerm }),
    [user, loading, login, logout, refreshUser, can, canPerm],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
