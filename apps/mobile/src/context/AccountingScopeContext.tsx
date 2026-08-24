import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useAuth } from '@/context/AuthContext';
import { useCompanyScope } from '@/hooks/useCompanyScope';
import { getAccountingOverview } from '@/services/api';
import { formatApiError } from '@/services/api-errors';
import type { FiscalYearRow } from '@/types/api';
import { ymdFromIso } from '@/utils/datetime';

type AccountingScopeValue = {
  companyId: number | null;
  ready: boolean;
  canView: boolean;
  canWrite: boolean;
  canManage: boolean;
  years: FiscalYearRow[];
  openYear: FiscalYearRow | null;
  selectedYear: FiscalYearRow | null;
  selectedYearId: number | undefined;
  setSelectedYearId: (id: number | undefined) => void;
  dateFrom: string;
  dateTo: string;
  setDateFrom: (value: string) => void;
  setDateTo: (value: string) => void;
  appliedDateFrom: string;
  appliedDateTo: string;
  applyDates: () => void;
  accountCount: number;
  entryCount: number;
  overviewError: string | null;
  loadingOverview: boolean;
  refreshOverview: () => Promise<void>;
};

const AccountingScopeContext = createContext<AccountingScopeValue | null>(null);

export function AccountingScopeProvider({ children }: { children: ReactNode }) {
  const { can, canPerm } = useAuth();
  const { companyId, ready } = useCompanyScope();
  const canView = can(['ADMIN', 'ACCOUNTANT']) || canPerm('accounting.view');
  const canWrite = canPerm('accounting.write') || can(['ADMIN']);
  const canManage = canPerm('accounting.manage') || can(['ADMIN']);

  const [years, setYears] = useState<FiscalYearRow[]>([]);
  const [openYear, setOpenYear] = useState<FiscalYearRow | null>(null);
  const [selectedYearId, setSelectedYearId] = useState<number | undefined>();
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [appliedDateFrom, setAppliedDateFrom] = useState('');
  const [appliedDateTo, setAppliedDateTo] = useState('');
  const [accountCount, setAccountCount] = useState(0);
  const [entryCount, setEntryCount] = useState(0);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);

  const selectedYear = useMemo(
    () => years.find((y) => y.id === selectedYearId) ?? openYear ?? years[0] ?? null,
    [years, selectedYearId, openYear],
  );

  const refreshOverview = useCallback(async () => {
    if (!canView || companyId == null) return;
    setLoadingOverview(true);
    try {
      const ov = await getAccountingOverview(companyId);
      const list = ov.fiscalYears ?? [];
      setYears(list);
      setOpenYear(ov.openFiscalYear ?? null);
      setAccountCount(ov.accountCount);
      setEntryCount(ov.entryCount);
      setOverviewError(null);
      setSelectedYearId((prev) => {
        if (prev != null && list.some((y) => y.id === prev)) return prev;
        return ov.openFiscalYear?.id ?? list[0]?.id;
      });
    } catch (err) {
      setYears([]);
      setOpenYear(null);
      setAccountCount(0);
      setEntryCount(0);
      setOverviewError(formatApiError(err, 'Impossible de charger les exercices comptables'));
    } finally {
      setLoadingOverview(false);
    }
  }, [canView, companyId]);

  useEffect(() => {
    if (!ready || !canView || companyId == null) return;
    void refreshOverview();
  }, [ready, canView, companyId, refreshOverview]);

  const yearId = selectedYear?.id;
  const yearStart = selectedYear?.startDate;
  const yearEnd = selectedYear?.endDate;

  useEffect(() => {
    if (yearId == null || !yearStart || !yearEnd) {
      setDateFrom('');
      setDateTo('');
      setAppliedDateFrom('');
      setAppliedDateTo('');
      return;
    }
    const from = ymdFromIso(yearStart);
    const to = ymdFromIso(yearEnd);
    setDateFrom(from);
    setDateTo(to);
    setAppliedDateFrom(from);
    setAppliedDateTo(to);
  }, [yearId, yearStart, yearEnd]);

  const applyDates = useCallback(() => {
    setAppliedDateFrom(dateFrom);
    setAppliedDateTo(dateTo);
  }, [dateFrom, dateTo]);

  const value = useMemo(
    () => ({
      companyId,
      ready,
      canView,
      canWrite,
      canManage,
      years,
      openYear,
      selectedYear,
      selectedYearId: selectedYear?.id,
      setSelectedYearId,
      dateFrom,
      dateTo,
      setDateFrom,
      setDateTo,
      appliedDateFrom,
      appliedDateTo,
      applyDates,
      accountCount,
      entryCount,
      overviewError,
      loadingOverview,
      refreshOverview,
    }),
    [
      companyId,
      ready,
      canView,
      canWrite,
      canManage,
      years,
      openYear,
      selectedYear,
      dateFrom,
      dateTo,
      appliedDateFrom,
      appliedDateTo,
      applyDates,
      accountCount,
      entryCount,
      overviewError,
      loadingOverview,
      refreshOverview,
    ],
  );

  return (
    <AccountingScopeContext.Provider value={value}>{children}</AccountingScopeContext.Provider>
  );
}

export function useAccountingScope(): AccountingScopeValue {
  const ctx = useContext(AccountingScopeContext);
  if (!ctx) {
    throw new Error('useAccountingScope must be used within AccountingScopeProvider');
  }
  return ctx;
}
