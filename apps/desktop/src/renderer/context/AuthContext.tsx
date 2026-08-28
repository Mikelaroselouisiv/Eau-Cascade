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
  login as apiLogin,
  logout as apiLogout,
  registerFirstAdmin as apiRegisterFirstAdmin,
  writeSessionUser,
} from '../services/api';
import { isLikelyNetworkError } from '../services/api-errors';
import type { SessionUser, UserRole } from '../types/api';

type AuthContextValue = {
  user: SessionUser | null;
  loading: boolean;
  login: (phone: string, password: string) => Promise<void>;
  registerFirstAdmin: (payload: {
    phone: string;
    password: string;
    email?: string;
    fullName?: string;
  }) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  can: (roles: UserRole[]) => boolean;
  canPerm: (permission: string) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(() => getSessionUser());
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
      if (!getToken()) {
        setUser(null);
        setLoading(false);
        return;
      }
      try {
        const u = await getMe();
        if (!cancelled) setUser(u);
      } catch (error) {
        if (!cancelled) {
          const cachedUser = getSessionUser();
          if (isLikelyNetworkError(error) && cachedUser) {
            // Session déjà validée en ligne : garder l'utilisateur pendant la panne.
            setUser(cachedUser);
          } else {
            apiLogout();
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

  useEffect(() => {
    const onFocus = () => {
      if (!getToken()) return;
      void refreshUser().catch(() => undefined);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshUser]);

  const login = useCallback(async (phone: string, password: string) => {
    const res = await apiLogin(phone, password);
    try {
      const u = await getMe();
      setUser(u);
      writeSessionUser(u);
    } catch {
      setUser(res.user);
      writeSessionUser(res.user);
    }
  }, []);

  const registerFirstAdmin = useCallback(
    async (payload: { phone: string; password: string; email?: string; fullName?: string }) => {
      const res = await apiRegisterFirstAdmin(payload);
      try {
        const u = await getMe();
        setUser(u);
        writeSessionUser(u);
      } catch {
        setUser(res.user);
        writeSessionUser(res.user);
      }
    },
    [],
  );

  const logout = useCallback(() => {
    apiLogout();
    setUser(null);
  }, []);

  const can = useCallback(
    (roles: UserRole[]) => {
      if (!user) return false;
      if (roles.includes(user.role)) return true;
      const perms = user.permissions ?? [];
      if (perms.includes('*')) return true;
      return false;
    },
    [user],
  );

  const canPerm = useCallback(
    (permission: string) => {
      if (!user) return false;
      const perms = user.permissions;
      // ADMIN sans permissions hydratées (ancien login / cache) : accès complet.
      if ((!perms || perms.length === 0) && user.role === 'ADMIN') return true;
      if (!perms) return false;
      if (perms.includes('*')) return true;
      if (perms.includes(permission)) return true;
      if (
        (permission === 'deliveries.manage_onsite' || permission === 'deliveries.manage_home') &&
        perms.includes('deliveries.manage')
      ) {
        return true;
      }
      return false;
    },
    [user],
  );

  const value = useMemo(
    () => ({ user, loading, login, registerFirstAdmin, logout, refreshUser, can, canPerm }),
    [user, loading, login, registerFirstAdmin, logout, refreshUser, can, canPerm],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
