import { useEffect, useState } from 'react';

import { useAuth } from '@/context/AuthContext';
import { getCompanies } from '@/services/api';
import type { CompanyListItem } from '@/types/api';

/**
 * Résout l’entreprise active pour les écrans métier.
 * - Compte rattaché → `user.companyId`
 * - ADMIN sans companyId → 1ʳᵉ entreprise de GET /companies (comme le desktop)
 */
export function useCompanyScope() {
  const { user } = useAuth();
  const sessionCompanyId = typeof user?.companyId === 'number' ? user.companyId : null;

  const [companies, setCompanies] = useState<CompanyListItem[]>([]);
  const [companyId, setCompanyId] = useState<number | null>(sessionCompanyId);
  const [ready, setReady] = useState(sessionCompanyId != null);

  useEffect(() => {
    if (sessionCompanyId != null) {
      setCompanyId(sessionCompanyId);
      setReady(true);
      return;
    }

    let cancelled = false;
    setReady(false);
    void getCompanies()
      .then((list) => {
        if (cancelled) return;
        setCompanies(list);
        setCompanyId((prev) => {
          if (prev != null && list.some((c) => c.id === prev)) return prev;
          return list[0]?.id ?? null;
        });
      })
      .catch(() => {
        if (!cancelled) {
          setCompanies([]);
          setCompanyId(null);
        }
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionCompanyId]);

  return {
    companyId,
    setCompanyId,
    companies,
    ready,
    /** Compte déjà lié à une entreprise (pas de sélecteur multi). */
    lockedToSession: sessionCompanyId != null,
  };
}
