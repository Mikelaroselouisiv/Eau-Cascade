import axios from 'axios';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  backfillAccounting,
  closeFiscalYear,
  createAccountingAccount,
  createFiscalYear,
  createFixedAsset,
  createManualJournalEntry,
  createSupplierPayment,
  ensureAccountingChart,
  exportAccountingBalanceSheetPdf,
  exportAccountingGeneralLedgerPdf,
  exportAccountingIncomeStatementPdf,
  exportAccountingJournalPdf,
  exportAccountingTrialBalancePdf,
  getAccountingAccounts,
  getAccountingJournal,
  getAccountingOverview,
  getAccountingSuppliers,
  getBalanceSheet,
  getCompanies,
  getCompany,
  getDepartments,
  getFixedAssets,
  getGeneralLedger,
  getIncomeStatement,
  getTrialBalance,
  listBanks,
  removeAccountingAccount,
  runDepreciation,
  updateAccountingAccount,
} from '../services/api';
import type {
  AccountRow,
  AccountingBackfillResult,
  AccountingSuppliersOverview,
  BalanceSheetReport,
  BankAccountRow,
  FiscalYearRow,
  FixedAssetRow,
  GeneralLedgerReport,
  IncomeStatementReport,
  JournalEntryRow,
  TrialBalanceReport,
} from '../types/api';
import { formatMoney } from '../utils/currency';
import { formatYmd } from '../utils/datetime';

type TabId =
  | 'exercices'
  | 'plan'
  | 'journal'
  | 'grand-livre'
  | 'balance'
  | 'bilan'
  | 'resultat'
  | 'saisie'
  | 'reprise'
  | 'fournisseurs'
  | 'immos';

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function formatApiError(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const d = err.response?.data;
    if (typeof d === 'string' && d.trim()) return d;
    if (d && typeof d === 'object') {
      const m = (d as { message?: unknown }).message;
      if (typeof m === 'string') return m;
      if (Array.isArray(m)) return m.join(', ');
    }
    if (err.code === 'ERR_NETWORK') {
      return 'Pas de réponse du serveur (réseau ou API arrêtée).';
    }
  }
  return err instanceof Error ? err.message : fallback;
}

function ymdFromIso(value: string | undefined | null): string {
  if (!value) return '';
  return value.slice(0, 10);
}

const COA_CLASS_LABELS: Record<number, string> = {
  1: 'Financement',
  2: 'Immobilisations',
  3: 'Stocks',
  4: 'Tiers',
  5: 'Trésorerie',
  6: 'Charges',
  7: 'Produits',
};

/**
 * Édition libre du plan (ajouter / modifier / retirer).
 * Désactivée : comptes gérés en dur (`chart-of-accounts.ts` côté backend).
 * Remettre à `true` pour réactiver l’UI (et ACCOUNTING_ALLOW_CHART_EDIT=true côté API).
 */
const ALLOW_CHART_OF_ACCOUNTS_EDIT = false;

export function AccountingPage() {
  const { user, canPerm } = useAuth();
  const canManage = canPerm('accounting.manage');
  const canWrite = canPerm('accounting.write');
  const canEditChart = canManage && ALLOW_CHART_OF_ACCOUNTS_EDIT;

  const [tab, setTab] = useState<TabId>('exercices');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [companyName, setCompanyName] = useState('');
  /** Résolu comme Crédit/Achats : user.companyId OU entreprise du département OU 1ʳᵉ entreprise. */
  const [companyId, setCompanyId] = useState<number | null>(
    typeof user?.companyId === 'number' ? user.companyId : null,
  );
  const [companyResolving, setCompanyResolving] = useState(
    () => typeof user?.companyId !== 'number',
  );

  const [overviewYears, setOverviewYears] = useState<FiscalYearRow[]>([]);
  const [openYear, setOpenYear] = useState<FiscalYearRow | null>(null);
  const [selectedYearId, setSelectedYearId] = useState<number | undefined>();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [journal, setJournal] = useState<JournalEntryRow[]>([]);
  const [journalTotal, setJournalTotal] = useState(0);
  const [trial, setTrial] = useState<TrialBalanceReport | null>(null);
  const [bilan, setBilan] = useState<BalanceSheetReport | null>(null);
  const [resultat, setResultat] = useState<IncomeStatementReport | null>(null);
  const [ledger, setLedger] = useState<GeneralLedgerReport | null>(null);
  const [ledgerModalOpen, setLedgerModalOpen] = useState(false);
  const [ledgerModalBusy, setLedgerModalBusy] = useState(false);

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [fyLabel, setFyLabel] = useState(() => String(new Date().getFullYear()));
  const [fyStart, setFyStart] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [fyEnd, setFyEnd] = useState(() => `${new Date().getFullYear()}-12-31`);

  const [manualDate, setManualDate] = useState(() => formatYmd(new Date()));
  const [manualDesc, setManualDesc] = useState('');
  const [manualLines, setManualLines] = useState([
    { accountCode: '', debit: '', credit: '' },
    { accountCode: '', debit: '', credit: '' },
  ]);

  const [backfillResult, setBackfillResult] = useState<AccountingBackfillResult | null>(null);
  const [suppliers, setSuppliers] = useState<AccountingSuppliersOverview | null>(null);
  const [bankAccounts, setBankAccounts] = useState<BankAccountRow[]>([]);
  const [paySupplier, setPaySupplier] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'CASH' | 'BANK'>('CASH');
  const [payBankId, setPayBankId] = useState<number | ''>('');
  const [payDate, setPayDate] = useState(() => formatYmd(new Date()));
  const [assets, setAssets] = useState<FixedAssetRow[]>([]);
  const [assetName, setAssetName] = useState('');
  const [assetDate, setAssetDate] = useState(() => formatYmd(new Date()));
  const [assetCost, setAssetCost] = useState('');
  const [assetMonths, setAssetMonths] = useState('60');
  const [assetResidual, setAssetResidual] = useState('0');
  const [assetPaidFrom, setAssetPaidFrom] = useState<'CASH' | 'BANK' | 'SUPPLIER'>('CASH');
  const [assetBankId, setAssetBankId] = useState<number | ''>('');
  const [deprPeriod, setDeprPeriod] = useState(() => formatYmd(new Date()).slice(0, 7));

  const [accFormCode, setAccFormCode] = useState('');
  const [accFormName, setAccFormName] = useState('');
  const [accFormClass, setAccFormClass] = useState('6');
  const [editingAccountId, setEditingAccountId] = useState<number | null>(null);
  const [planFilter, setPlanFilter] = useState('');
  const [planClassFilter, setPlanClassFilter] = useState<number | 'all'>('all');
  const [planShowInactive, setPlanShowInactive] = useState(false);
  const [planMessage, setPlanMessage] = useState<string | null>(null);

  const selectedYear = useMemo(
    () => overviewYears.find((y) => y.id === selectedYearId) ?? openYear,
    [overviewYears, selectedYearId, openYear],
  );

  const periodParams = useMemo(
    () => ({
      companyId: companyId!,
      fiscalYearId: selectedYear?.id,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    }),
    [companyId, selectedYear?.id, dateFrom, dateTo],
  );

  const activeAccounts = useMemo(
    () => accounts.filter((a) => a.isActive),
    [accounts],
  );

  const planStats = useMemo(() => {
    const active = accounts.filter((a) => a.isActive).length;
    return {
      total: accounts.length,
      active,
      inactive: accounts.length - active,
      byClass: [1, 2, 3, 4, 5, 6, 7].map((n) => ({
        classNumber: n,
        count: accounts.filter((a) => a.classNumber === n && (planShowInactive || a.isActive)).length,
      })),
    };
  }, [accounts, planShowInactive]);

  const planAccounts = useMemo(() => {
    const q = planFilter.trim().toLowerCase();
    return accounts.filter((a) => {
      if (!planShowInactive && !a.isActive) return false;
      if (planClassFilter !== 'all' && a.classNumber !== planClassFilter) return false;
      if (!q) return true;
      return (
        a.code.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        (a.systemKey ?? '').toLowerCase().includes(q)
      );
    });
  }, [accounts, planFilter, planShowInactive, planClassFilter]);

  const refreshOverview = useCallback(async () => {
    if (companyId == null) return;
    const ov = await getAccountingOverview(companyId);
    setOverviewYears(ov.fiscalYears ?? []);
    setOpenYear(ov.openFiscalYear ?? null);
    setSelectedYearId((prev) => {
      if (prev != null && (ov.fiscalYears ?? []).some((y) => y.id === prev)) return prev;
      return ov.openFiscalYear?.id ?? ov.fiscalYears?.[0]?.id;
    });
    if (ov.openFiscalYear) {
      setDateFrom((d) => d || ymdFromIso(String(ov.openFiscalYear!.startDate)));
      setDateTo((d) => d || ymdFromIso(String(ov.openFiscalYear!.endDate)));
    }
  }, [companyId]);

  const loadTabData = useCallback(async () => {
    if (companyId == null) return;
    setError(null);
    setBusy(true);
    try {
      if (tab === 'plan') {
        setAccounts(await getAccountingAccounts(companyId));
      } else if (tab === 'journal' || tab === 'exercices') {
        await refreshOverview();
        if (tab === 'journal' && selectedYear?.id) {
          const j = await getAccountingJournal({
            companyId,
            fiscalYearId: selectedYear.id,
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
            take: 100,
          });
          setJournal(j.items);
          setJournalTotal(j.total);
        }
      } else if (tab === 'balance' || tab === 'grand-livre') {
        setTrial(await getTrialBalance(periodParams));
      } else if (tab === 'bilan') {
        setBilan(
          await getBalanceSheet({
            companyId,
            fiscalYearId: selectedYear?.id,
            dateTo: dateTo || undefined,
          }),
        );
      } else if (tab === 'resultat') {
        setResultat(await getIncomeStatement(periodParams));
      } else if (tab === 'saisie') {
        setAccounts(await getAccountingAccounts(companyId));
        await refreshOverview();
      } else if (tab === 'reprise') {
        await refreshOverview();
      } else if (tab === 'fournisseurs') {
        setSuppliers(await getAccountingSuppliers(companyId));
        const banks = await listBanks({ companyId });
        setBankAccounts(
          banks.flatMap((b) =>
            b.accounts.filter((a) => a.isActive).map((a) => ({ ...a, bankName: b.name })),
          ),
        );
      } else if (tab === 'immos') {
        setAssets(await getFixedAssets(companyId));
        const banks = await listBanks({ companyId });
        setBankAccounts(
          banks.flatMap((b) =>
            b.accounts.filter((a) => a.isActive).map((a) => ({ ...a, bankName: b.name })),
          ),
        );
      }
    } catch (e) {
      setError(formatApiError(e, 'Erreur de chargement'));
    } finally {
      setBusy(false);
    }
  }, [
    companyId,
    tab,
    refreshOverview,
    selectedYear?.id,
    dateFrom,
    dateTo,
    periodParams,
  ]);

  const ledgerDebitRows = useMemo(
    () => (trial?.rows ?? []).filter((r) => r.balanceSide === 'debit'),
    [trial],
  );
  const ledgerCreditRows = useMemo(
    () => (trial?.rows ?? []).filter((r) => r.balanceSide === 'credit'),
    [trial],
  );

  async function openLedgerAccount(accountId: number) {
    if (companyId == null) return;
    setLedgerModalOpen(true);
    setLedger(null);
    setLedgerModalBusy(true);
    setError(null);
    try {
      setLedger(
        await getGeneralLedger({
          ...periodParams,
          accountId,
        }),
      );
    } catch (err) {
      setError(formatApiError(err, 'Impossible de charger le compte'));
      setLedgerModalOpen(false);
    } finally {
      setLedgerModalBusy(false);
    }
  }

  function closeLedgerModal() {
    setLedgerModalOpen(false);
    setLedger(null);
    setLedgerModalBusy(false);
  }

  useEffect(() => {
    let cancelled = false;
    async function resolveCompany() {
      if (typeof user?.companyId === 'number') {
        if (!cancelled) {
          setCompanyId(user.companyId);
          setCompanyResolving(false);
        }
        return;
      }
      setCompanyResolving(true);
      try {
        // Beaucoup d’utilisateurs prod n’ont que departmentId (companyId null en base).
        if (typeof user?.departmentId === 'number') {
          const depts = await getDepartments();
          const dept = depts.find((d) => d.id === user.departmentId);
          if (dept?.companyId && !cancelled) {
            setCompanyId(dept.companyId);
            setCompanyResolving(false);
            return;
          }
        }
        const list = await getCompanies();
        if (!cancelled) {
          setCompanyId(list[0]?.id ?? null);
        }
      } catch {
        if (!cancelled) setCompanyId(null);
      } finally {
        if (!cancelled) setCompanyResolving(false);
      }
    }
    void resolveCompany();
    return () => {
      cancelled = true;
    };
  }, [user?.companyId, user?.departmentId]);

  useEffect(() => {
    if (companyId == null) {
      setCompanyName('');
      return;
    }
    void getCompany()
      .then((c) => setCompanyName(c?.legalName || c?.name || ''))
      .catch(() => {
        void getCompanies()
          .then((list) => {
            const c = list.find((x) => x.id === companyId);
            setCompanyName(c?.legalName || c?.name || '');
          })
          .catch(() => undefined);
      });
  }, [companyId]);

  useEffect(() => {
    if (companyId == null) return;
    void refreshOverview().catch((e) =>
      setError(formatApiError(e, 'Impossible de charger les exercices comptables')),
    );
  }, [refreshOverview, companyId]);

  useEffect(() => {
    if (companyId == null) return;
    void loadTabData();
  }, [loadTabData, companyId]);

  async function onOpenYear(e: FormEvent) {
    e.preventDefault();
    if (companyId == null) return;
    setBusy(true);
    setError(null);
    try {
      await ensureAccountingChart(companyId);
      await createFiscalYear({
        companyId,
        label: fyLabel.trim(),
        startDate: fyStart,
        endDate: fyEnd,
      });
      await refreshOverview();
    } catch (err) {
      setError(formatApiError(err, 'Impossible d’ouvrir l’exercice'));
    } finally {
      setBusy(false);
    }
  }

  async function onCloseYear() {
    if (!openYear) return;
    if (
      !window.confirm(
        `Clôturer l’exercice « ${openYear.label} » ? Les comptes de charges et produits seront soldés vers le résultat. Cette action est définitive.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await closeFiscalYear(openYear.id);
      alert(
        `Exercice clôturé. Résultat : ${formatMoney(res.resultat)} (${res.resultat >= 0 ? 'bénéfice' : 'perte'})`,
      );
      await refreshOverview();
    } catch (err) {
      setError(formatApiError(err, 'Clôture impossible'));
    } finally {
      setBusy(false);
    }
  }

  async function onEnsureChart() {
    if (companyId == null) return;
    setBusy(true);
    setPlanMessage(null);
    try {
      const list = await ensureAccountingChart(companyId);
      setAccounts(list);
      setPlanMessage(`${list.length} comptes synchronisés`);
    } catch (err) {
      setError(formatApiError(err, 'Erreur plan comptable'));
    } finally {
      setBusy(false);
    }
  }

  function resetAccountForm() {
    setEditingAccountId(null);
    setAccFormCode('');
    setAccFormName('');
    setAccFormClass('6');
  }

  function startEditAccount(a: AccountRow) {
    setEditingAccountId(a.id);
    setAccFormCode(a.code);
    setAccFormName(a.name);
    setAccFormClass(String(a.classNumber));
    setPlanMessage(null);
  }

  async function onSaveAccount(e: FormEvent) {
    e.preventDefault();
    if (companyId == null || !canEditChart) return;
    const code = accFormCode.trim();
    const name = accFormName.trim();
    const classNumber = Number.parseInt(accFormClass, 10);
    if (!code || !name || !Number.isFinite(classNumber)) {
      setError('Code, intitulé et classe sont requis');
      return;
    }
    setBusy(true);
    setError(null);
    setPlanMessage(null);
    try {
      if (editingAccountId != null) {
        await updateAccountingAccount(editingAccountId, { code, name, classNumber });
        setPlanMessage(`Compte ${code} mis à jour`);
      } else {
        await createAccountingAccount({ companyId, code, name, classNumber });
        setPlanMessage(`Compte ${code} ajouté`);
      }
      resetAccountForm();
      setAccounts(await getAccountingAccounts(companyId));
    } catch (err) {
      setError(formatApiError(err, 'Enregistrement du compte impossible'));
    } finally {
      setBusy(false);
    }
  }

  async function onToggleAccountActive(a: AccountRow) {
    if (!canEditChart) return;
    setBusy(true);
    setError(null);
    setPlanMessage(null);
    try {
      await updateAccountingAccount(a.id, { isActive: !a.isActive });
      setPlanMessage(a.isActive ? `Compte ${a.code} désactivé.` : `Compte ${a.code} réactivé.`);
      if (companyId != null) setAccounts(await getAccountingAccounts(companyId));
    } catch (err) {
      setError(formatApiError(err, 'Changement de statut impossible'));
    } finally {
      setBusy(false);
    }
  }

  async function onRemoveAccount(a: AccountRow) {
    if (!canEditChart) return;
    const ok = window.confirm(
      a.isSystem || a.systemKey
        ? `Désactiver le compte système ${a.code} « ${a.name} » ?\nLes écritures auto (ventes, caisse…) qui l’utilisent échoueront tant qu’il reste inactif.`
        : `Retirer le compte ${a.code} « ${a.name} » ?\nSans mouvements : suppression. Avec mouvements : désactivation (historique conservé).`,
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    setPlanMessage(null);
    try {
      const res = await removeAccountingAccount(a.id);
      setPlanMessage(res.message);
      if (editingAccountId === a.id) resetAccountForm();
      if (companyId != null) setAccounts(await getAccountingAccounts(companyId));
    } catch (err) {
      setError(formatApiError(err, 'Suppression impossible'));
    } finally {
      setBusy(false);
    }
  }

  async function onSaveManual(e: FormEvent) {
    e.preventDefault();
    if (companyId == null) return;
    setBusy(true);
    setError(null);
    try {
      await createManualJournalEntry({
        companyId,
        entryDate: manualDate,
        description: manualDesc.trim(),
        lines: manualLines
          .filter((l) => l.accountCode.trim())
          .map((l) => ({
            accountCode: l.accountCode.trim(),
            debit: l.debit ? Number(l.debit) : 0,
            credit: l.credit ? Number(l.credit) : 0,
          })),
      });
      setManualDesc('');
      setManualLines([
        { accountCode: '', debit: '', credit: '' },
        { accountCode: '', debit: '', credit: '' },
      ]);
      setTab('journal');
    } catch (err) {
      setError(formatApiError(err, 'Écriture refusée'));
    } finally {
      setBusy(false);
    }
  }

  async function onBackfill() {
    if (companyId == null) return;
    if (
      !window.confirm(
        'Reprendre toutes les opérations de l’exercice ouvert (ventes, crédits, dépenses, achats, banques) en écritures comptables ? Les écritures déjà présentes seront ignorées.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await backfillAccounting(companyId);
      setBackfillResult(res);
    } catch (err) {
      setError(formatApiError(err, 'Reprise impossible'));
    } finally {
      setBusy(false);
    }
  }

  async function onPaySupplier(e: FormEvent) {
    e.preventDefault();
    if (companyId == null) return;
    setBusy(true);
    setError(null);
    try {
      await createSupplierPayment({
        companyId,
        supplierName: paySupplier.trim(),
        amount: Number(payAmount),
        method: payMethod,
        bankAccountId: payMethod === 'BANK' ? Number(payBankId) : undefined,
        paidOn: payDate,
      });
      setPayAmount('');
      setSuppliers(await getAccountingSuppliers(companyId));
    } catch (err) {
      setError(formatApiError(err, 'Paiement refusé'));
    } finally {
      setBusy(false);
    }
  }

  async function onCreateAsset(e: FormEvent) {
    e.preventDefault();
    if (companyId == null) return;
    setBusy(true);
    setError(null);
    try {
      await createFixedAsset({
        companyId,
        name: assetName.trim(),
        acquisitionDate: assetDate,
        acquisitionCost: Number(assetCost),
        residualValue: Number(assetResidual) || 0,
        usefulLifeMonths: Number(assetMonths),
        paidFrom: assetPaidFrom,
        bankAccountId: assetPaidFrom === 'BANK' ? Number(assetBankId) : undefined,
      });
      setAssetName('');
      setAssetCost('');
      setAssets(await getFixedAssets(companyId));
    } catch (err) {
      setError(formatApiError(err, 'Immobilisation refusée'));
    } finally {
      setBusy(false);
    }
  }

  async function onRunDepreciation() {
    if (companyId == null) return;
    if (!window.confirm(`Passer les amortissements pour ${deprPeriod} ?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await runDepreciation({ companyId, period: deprPeriod });
      const posted = res.results.filter((r) => r.status === 'posted').length;
      alert(`${posted} dotation(s) passée(s) pour ${res.period}.`);
      setAssets(await getFixedAssets(companyId));
    } catch (err) {
      setError(formatApiError(err, 'Amortissement impossible'));
    } finally {
      setBusy(false);
    }
  }

  const tabs: Array<[TabId, string]> = [
    ['exercices', 'Exercices'],
    ['reprise', 'Reprise'],
    ['plan', 'Plan comptable'],
    ['journal', 'Journal'],
    ['grand-livre', 'Grand livre'],
    ['balance', 'Balance'],
    ['bilan', 'Bilan'],
    ['resultat', 'Compte de résultat'],
    ['fournisseurs', 'Fournisseurs'],
    ['immos', 'Immobilisations'],
    ['saisie', 'Saisie OD'],
  ];

  if (companyResolving) {
    return (
      <div className="page-inner">
        <header className="page-header">
          <h1>Comptabilité</h1>
        </header>
        <p className="acc-empty">Chargement…</p>
      </div>
    );
  }

  if (companyId == null) {
    return (
      <div className="page-inner">
        <header className="page-header">
          <h1>Comptabilité</h1>
        </header>
        <p className="acc-empty">Aucune entreprise accessible pour ce compte.</p>
      </div>
    );
  }

  return (
    <div className="page-inner">
      <header className="page-header acc-page-header">
        <div>
          <h1>Comptabilité</h1>
          <p className="acc-subtitle">{companyName || 'Entreprise'}</p>
        </div>
      </header>

      <div className="config-tabs acc-tabs">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? 'tab active' : 'tab'}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="banner error" style={{ marginBottom: '0.75rem' }}>
          {error}
        </div>
      ) : null}

      {tab !== 'exercices' &&
      tab !== 'plan' &&
      tab !== 'saisie' &&
      tab !== 'reprise' &&
      tab !== 'fournisseurs' &&
      tab !== 'immos' ? (
        <div className="card acc-period-bar">
          <label>
            Exercice
            <select
              value={selectedYear?.id ?? ''}
              onChange={(e) =>
                setSelectedYearId(e.target.value ? Number(e.target.value) : undefined)
              }
            >
              {overviewYears.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.label} ({y.status === 'OPEN' ? 'ouvert' : 'clôturé'})
                </option>
              ))}
            </select>
          </label>
          <label>
            Du
            <input
              type="date"
              value={dateFrom}
              min={ymdFromIso(selectedYear?.startDate)}
              max={ymdFromIso(selectedYear?.endDate)}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label>
            Au
            <input
              type="date"
              value={dateTo}
              min={ymdFromIso(selectedYear?.startDate)}
              max={ymdFromIso(selectedYear?.endDate)}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
          <button type="button" className="btn secondary btn-sm" disabled={busy} onClick={() => void loadTabData()}>
            Actualiser
          </button>
        </div>
      ) : null}

      {tab === 'exercices' ? (
        <div className="acc-grid-2">
          <section className="card acc-card">
            <div className="acc-card-head">
              <h2>Exercice en cours</h2>
              {openYear ? <span className="acc-pill acc-pill--on">Ouvert</span> : null}
            </div>
            {openYear ? (
              <div className="acc-fy-current">
                <div className="acc-fy-label">{openYear.label}</div>
                <div className="acc-fy-range">
                  {ymdFromIso(openYear.startDate)} → {ymdFromIso(openYear.endDate)}
                </div>
                <div className="acc-fy-meta">{openYear._count?.entries ?? 0} écriture(s)</div>
                {canManage ? (
                  <button type="button" className="btn danger btn-sm" disabled={busy} onClick={() => void onCloseYear()}>
                    Clôturer
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="acc-empty">Aucun exercice ouvert</p>
            )}
          </section>

          {canManage ? (
            <section className="card acc-card">
              <div className="acc-card-head">
                <h2>Nouvel exercice</h2>
              </div>
              {openYear ? (
                <p className="acc-empty">Clôturez « {openYear.label} » avant d’en ouvrir un autre.</p>
              ) : (
                <form onSubmit={(e) => void onOpenYear(e)} className="form-stack">
                  <label>
                    Libellé
                    <input value={fyLabel} onChange={(e) => setFyLabel(e.target.value)} required />
                  </label>
                  <label>
                    Début
                    <input
                      type="date"
                      value={fyStart}
                      onChange={(e) => setFyStart(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Fin
                    <input
                      type="date"
                      value={fyEnd}
                      onChange={(e) => setFyEnd(e.target.value)}
                      required
                    />
                  </label>
                  <button type="submit" className="btn primary" disabled={busy}>
                    Ouvrir
                  </button>
                </form>
              )}
            </section>
          ) : (
            <section className="card acc-card">
              <div className="acc-card-head">
                <h2>Nouvel exercice</h2>
              </div>
              <p className="acc-empty">Accès réservé (Admin / Comptable)</p>
            </section>
          )}

          <section className="card acc-card" style={{ gridColumn: '1 / -1' }}>
            <div className="acc-card-head">
              <h2>Historique</h2>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Libellé</th>
                    <th>Période</th>
                    <th>Statut</th>
                    <th>Écritures</th>
                  </tr>
                </thead>
                <tbody>
                  {overviewYears.map((y) => (
                    <tr key={y.id}>
                      <td>{y.label}</td>
                      <td>
                        {ymdFromIso(y.startDate)} → {ymdFromIso(y.endDate)}
                      </td>
                      <td>{y.status === 'OPEN' ? 'Ouvert' : 'Clôturé'}</td>
                      <td>{y._count?.entries ?? '—'}</td>
                    </tr>
                  ))}
                  {overviewYears.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="muted">
                        Aucun exercice
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}

      {tab === 'plan' ? (
        <section className="card coa-panel">
          <div className="coa-header">
            <div>
              <h2>Plan comptable</h2>
              <p className="coa-meta">
                {planStats.active} actifs
                {planStats.inactive > 0 ? ` · ${planStats.inactive} inactifs` : ''}
                {' · '}
                {planAccounts.length} affiché{planAccounts.length > 1 ? 's' : ''}
              </p>
            </div>
            {canManage ? (
              <button
                type="button"
                className="btn secondary btn-sm"
                disabled={busy}
                onClick={() => void onEnsureChart()}
              >
                Synchroniser
              </button>
            ) : null}
          </div>

          {planMessage ? <div className="coa-toast">{planMessage}</div> : null}

          {canEditChart ? (
            <form
              onSubmit={(e) => void onSaveAccount(e)}
              className={`coa-editor${editingAccountId != null ? ' coa-editor--editing' : ''}`}
            >
              <div className="coa-editor-title">
                {editingAccountId != null ? 'Modifier le compte' : 'Nouveau compte'}
              </div>
              <div className="coa-editor-fields">
                <label>
                  N°
                  <input
                    value={accFormCode}
                    onChange={(e) => setAccFormCode(e.target.value)}
                    placeholder="ex. 625"
                    required
                    autoComplete="off"
                  />
                </label>
                <label className="coa-editor-name">
                  Intitulé
                  <input
                    value={accFormName}
                    onChange={(e) => setAccFormName(e.target.value)}
                    placeholder="Libellé du compte"
                    required
                    autoComplete="off"
                  />
                </label>
                <label>
                  Classe
                  <select value={accFormClass} onChange={(e) => setAccFormClass(e.target.value)}>
                    {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                      <option key={n} value={String(n)}>
                        {n} — {COA_CLASS_LABELS[n]}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="coa-editor-actions">
                  <button type="submit" className="btn primary btn-sm" disabled={busy}>
                    {editingAccountId != null ? 'Enregistrer' : 'Ajouter'}
                  </button>
                  {editingAccountId != null ? (
                    <button
                      type="button"
                      className="btn secondary btn-sm"
                      disabled={busy}
                      onClick={resetAccountForm}
                    >
                      Annuler
                    </button>
                  ) : null}
                </div>
              </div>
            </form>
          ) : null}

          <div className="coa-toolbar">
            <label className="coa-search">
              <span className="sr-only">Rechercher</span>
              <input
                value={planFilter}
                onChange={(e) => setPlanFilter(e.target.value)}
                placeholder="Rechercher un compte…"
              />
            </label>
            <label className="coa-toggle">
              <input
                type="checkbox"
                checked={planShowInactive}
                onChange={(e) => setPlanShowInactive(e.target.checked)}
              />
              Inactifs
            </label>
          </div>

          <div className="coa-class-filters" role="tablist" aria-label="Filtrer par classe">
            <button
              type="button"
              className={planClassFilter === 'all' ? 'coa-chip active' : 'coa-chip'}
              onClick={() => setPlanClassFilter('all')}
            >
              Toutes
              <span>{planShowInactive ? planStats.total : planStats.active}</span>
            </button>
            {planStats.byClass.map(({ classNumber, count }) => (
              <button
                key={classNumber}
                type="button"
                className={planClassFilter === classNumber ? 'coa-chip active' : 'coa-chip'}
                onClick={() => setPlanClassFilter(classNumber)}
                title={COA_CLASS_LABELS[classNumber]}
              >
                Cl. {classNumber}
                <span>{count}</span>
              </button>
            ))}
          </div>

          <div className="table-wrap coa-table-wrap">
            <table className="data-table coa-table">
              <thead>
                <tr>
                  <th>N°</th>
                  <th>Intitulé</th>
                  <th>Classe</th>
                  <th>Nature</th>
                  <th>Statut</th>
                  {canEditChart ? <th className="coa-actions-col">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {planAccounts.length === 0 ? (
                  <tr>
                    <td colSpan={canEditChart ? 6 : 5} className="coa-empty">
                      Aucun compte ne correspond aux filtres.
                    </td>
                  </tr>
                ) : (
                  planAccounts.map((a) => (
                    <tr
                      key={a.id}
                      className={[
                        a.isActive ? '' : 'coa-row--inactive',
                        editingAccountId === a.id ? 'coa-row--editing' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <td>
                        <span className="coa-code">{a.code}</span>
                        {a.systemKey ? (
                          <span className="coa-sys-dot" title={`Système · ${a.systemKey}`} />
                        ) : null}
                      </td>
                      <td>
                        <div className="coa-name">{a.name}</div>
                        {a.systemKey ? <div className="coa-sys-key">{a.systemKey}</div> : null}
                      </td>
                      <td>
                        <span className="coa-class">
                          {a.classNumber}
                          <span className="coa-class-label">{COA_CLASS_LABELS[a.classNumber] ?? ''}</span>
                        </span>
                      </td>
                      <td>{a.nature === 'BALANCE_SHEET' ? 'Bilan' : 'Résultat'}</td>
                      <td>
                        <span
                          className={
                            a.isActive ? 'coa-status coa-status--on' : 'coa-status coa-status--off'
                          }
                        >
                          {a.isActive ? 'Actif' : 'Inactif'}
                        </span>
                      </td>
                      {canEditChart ? (
                        <td>
                          <div className="coa-row-actions">
                            <button
                              type="button"
                              className="btn secondary btn-sm"
                              disabled={busy}
                              onClick={() => startEditAccount(a)}
                            >
                              Modifier
                            </button>
                            <button
                              type="button"
                              className="btn secondary btn-sm"
                              disabled={busy}
                              onClick={() => void onToggleAccountActive(a)}
                            >
                              {a.isActive ? 'Désactiver' : 'Réactiver'}
                            </button>
                            <button
                              type="button"
                              className="btn secondary btn-sm coa-btn-danger"
                              disabled={busy}
                              onClick={() => void onRemoveAccount(a)}
                            >
                              Retirer
                            </button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === 'journal' ? (
        <section className="card acc-card">
          <div className="acc-card-head">
            <div>
              <h2>Journal</h2>
              <p className="acc-meta">{journalTotal} écriture(s)</p>
            </div>
            <button
              type="button"
              className="btn secondary btn-sm"
              disabled={busy || !selectedYear}
              onClick={() =>
                void exportAccountingJournalPdf(periodParams).then((b) =>
                  downloadBlob(b, `journal_${dateFrom}_${dateTo}.pdf`),
                )
              }
            >
              Export PDF
            </button>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>N°</th>
                  <th>Compte</th>
                  <th>Libellé</th>
                  <th>Débit</th>
                  <th>Crédit</th>
                </tr>
              </thead>
              <tbody>
                {journal.flatMap((e) =>
                  e.lines.map((l, idx) => (
                    <tr key={`${e.id}-${l.id}`}>
                      <td>{idx === 0 ? ymdFromIso(e.entryDate) : ''}</td>
                      <td>
                        {idx === 0
                          ? `${e.journalCode}-${String(e.entryNumber).padStart(5, '0')}`
                          : ''}
                      </td>
                      <td>
                        {l.account.code}
                      </td>
                      <td>{l.label || (idx === 0 ? e.description : '')}</td>
                      <td style={{ textAlign: 'right' }}>
                        {Number(l.debit) > 0 ? formatMoney(l.debit) : ''}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {Number(l.credit) > 0 ? formatMoney(l.credit) : ''}
                      </td>
                    </tr>
                  )),
                )}
                {journal.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      Aucune écriture sur la période (exercice ouvert requis).
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === 'grand-livre' ? (
        <section className="card acc-card">
          <div className="acc-card-head">
            <div>
              <h2>Grand livre</h2>
              {trial ? (
                <p className="acc-meta">
                  {trial.fiscalYear.label} · {trial.dateFrom} → {trial.dateTo}
                </p>
              ) : null}
            </div>
            <div className="acc-head-actions">
              {trial ? (
                <span
                  className={
                    trial.balanced ? 'acc-pill acc-pill--on' : 'acc-pill acc-pill--warn'
                  }
                >
                  {trial.balanced ? 'Équilibré' : 'À contrôler'}
                </span>
              ) : null}
              <button
                type="button"
                className="btn secondary btn-sm"
                disabled={busy || !trial}
                onClick={() =>
                  void exportAccountingGeneralLedgerPdf(periodParams).then((b) =>
                    downloadBlob(b, `grand_livre_${dateFrom}_${dateTo}.pdf`),
                  )
                }
              >
                Export PDF
              </button>
            </div>
          </div>

          {!trial ? (
            <p className="acc-empty">Chargement…</p>
          ) : (
            <>
              <div className="acc-ledger-columns">
                <div className="acc-ledger-col">
                  <div className="acc-ledger-col-head acc-ledger-col-head--debit">
                    <span>Soldes débiteurs</span>
                    <strong>{formatMoney(trial.balanceTotals?.debit ?? 0)}</strong>
                  </div>
                  <div className="table-wrap">
                    <table className="data-table acc-ledger-table">
                      <thead>
                        <tr>
                          <th>N°</th>
                          <th>Intitulé</th>
                          <th>Solde</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ledgerDebitRows.map((r) => (
                          <tr
                            key={`d-${r.accountId}`}
                            className="acc-ledger-row"
                            onClick={() => void openLedgerAccount(r.accountId)}
                          >
                            <td className="coa-code">{r.code}</td>
                            <td>{r.name}</td>
                            <td style={{ textAlign: 'right' }}>{formatMoney(r.balance)}</td>
                          </tr>
                        ))}
                        {ledgerDebitRows.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="acc-empty">
                              —
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="acc-ledger-col">
                  <div className="acc-ledger-col-head acc-ledger-col-head--credit">
                    <span>Soldes créditeurs</span>
                    <strong>{formatMoney(trial.balanceTotals?.credit ?? 0)}</strong>
                  </div>
                  <div className="table-wrap">
                    <table className="data-table acc-ledger-table">
                      <thead>
                        <tr>
                          <th>N°</th>
                          <th>Intitulé</th>
                          <th>Solde</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ledgerCreditRows.map((r) => (
                          <tr
                            key={`c-${r.accountId}`}
                            className="acc-ledger-row"
                            onClick={() => void openLedgerAccount(r.accountId)}
                          >
                            <td className="coa-code">{r.code}</td>
                            <td>{r.name}</td>
                            <td style={{ textAlign: 'right' }}>{formatMoney(r.balance)}</td>
                          </tr>
                        ))}
                        {ledgerCreditRows.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="acc-empty">
                              —
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div
                className={`acc-ledger-totals${trial.balanced ? '' : ' acc-ledger-totals--warn'}`}
              >
                <div>
                  <span>Total débit</span>
                  <strong>{formatMoney(trial.balanceTotals?.debit ?? 0)}</strong>
                </div>
                <div>
                  <span>Total crédit</span>
                  <strong>{formatMoney(trial.balanceTotals?.credit ?? 0)}</strong>
                </div>
                <div>
                  <span>Écart</span>
                  <strong>
                    {formatMoney(
                      Math.abs(
                        (trial.balanceTotals?.debit ?? 0) - (trial.balanceTotals?.credit ?? 0),
                      ),
                    )}
                  </strong>
                </div>
              </div>
            </>
          )}
        </section>
      ) : null}

      {ledgerModalOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal card modal-ledger"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ledger-modal-title"
          >
            <div className="modal-ledger-head">
              <div>
                <h2 id="ledger-modal-title">
                  {ledger
                    ? `${ledger.account.code} — ${ledger.account.name}`
                    : 'Compte'}
                </h2>
                {ledger ? (
                  <p className="acc-meta">
                    {ledger.dateFrom} → {ledger.dateTo}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                className="modal-close-btn"
                aria-label="Fermer"
                onClick={closeLedgerModal}
              >
                ×
              </button>
            </div>

            {ledgerModalBusy || !ledger ? (
              <p className="acc-empty">Chargement des opérations…</p>
            ) : (
              <>
                <div className="table-wrap modal-ledger-table">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>N°</th>
                        <th>Libellé</th>
                        <th>Débit</th>
                        <th>Crédit</th>
                        <th>Solde</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.movements.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="acc-empty">
                            Aucune opération
                          </td>
                        </tr>
                      ) : (
                        ledger.movements.map((m, idx) => (
                          <tr key={`${m.entryId}-${idx}`}>
                            <td>{m.entryDate}</td>
                            <td>
                              {m.journalCode}-{String(m.entryNumber).padStart(5, '0')}
                            </td>
                            <td>{m.label || m.description}</td>
                            <td style={{ textAlign: 'right' }}>
                              {m.debit > 0 ? formatMoney(m.debit) : ''}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              {m.credit > 0 ? formatMoney(m.credit) : ''}
                            </td>
                            <td style={{ textAlign: 'right' }}>{formatMoney(m.balance)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="modal-ledger-footer">
                  <span>Solde</span>
                  <strong>{formatMoney(ledger.closingBalance)}</strong>
                  <button
                    type="button"
                    className="btn secondary btn-sm"
                    onClick={() =>
                      void exportAccountingGeneralLedgerPdf({
                        ...periodParams,
                        accountId: ledger.account.id,
                      }).then((b) =>
                        downloadBlob(b, `grand_livre_${ledger.account.code}.pdf`),
                      )
                    }
                  >
                    PDF compte
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {tab === 'balance' && trial ? (
        <section className="card acc-card">
          <div className="acc-card-head">
            <div>
              <h2>Balance générale</h2>
              <p className="acc-meta">{trial.fiscalYear.label}</p>
            </div>
            <div className="acc-head-actions">
              <span
                className={trial.balanced ? 'acc-pill acc-pill--on' : 'acc-pill acc-pill--warn'}
              >
                {trial.balanced ? 'Équilibrée' : 'À contrôler'}
              </span>
              <button
                type="button"
                className="btn secondary btn-sm"
                disabled={busy}
                onClick={() =>
                  void exportAccountingTrialBalancePdf(periodParams).then((b) =>
                    downloadBlob(b, `balance_${trial.dateFrom}_${trial.dateTo}.pdf`),
                  )
                }
              >
                Export PDF
              </button>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>N°</th>
                  <th>Intitulé</th>
                  <th>Débit</th>
                  <th>Crédit</th>
                  <th>Solde D</th>
                  <th>Solde C</th>
                </tr>
              </thead>
              <tbody>
                {trial.rows.map((r) => (
                  <tr key={r.accountId}>
                    <td className="coa-code">{r.code}</td>
                    <td>{r.name}</td>
                    <td style={{ textAlign: 'right' }}>{formatMoney(r.debit)}</td>
                    <td style={{ textAlign: 'right' }}>{formatMoney(r.credit)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {r.balanceSide === 'debit' ? formatMoney(r.balance) : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {r.balanceSide === 'credit' ? formatMoney(r.balance) : '—'}
                    </td>
                  </tr>
                ))}
                <tr className="acc-total-row">
                  <td colSpan={2}>
                    <strong>Totaux</strong>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <strong>{formatMoney(trial.totals.debit)}</strong>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <strong>{formatMoney(trial.totals.credit)}</strong>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <strong>{formatMoney(trial.balanceTotals?.debit ?? 0)}</strong>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <strong>{formatMoney(trial.balanceTotals?.credit ?? 0)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === 'bilan' && bilan ? (
        <section className="card acc-card">
          <div className="acc-card-head">
            <div>
              <h2>Bilan</h2>
              <p className="acc-meta">{bilan.fiscalYear.label} · au {bilan.dateTo}</p>
            </div>
            <div className="acc-head-actions">
              <span
                className={bilan.balanced ? 'acc-pill acc-pill--on' : 'acc-pill acc-pill--warn'}
              >
                {bilan.balanced ? 'Équilibré' : 'À contrôler'}
              </span>
              <button
                type="button"
                className="btn secondary btn-sm"
                disabled={busy}
                onClick={() =>
                  void exportAccountingBalanceSheetPdf({
                    companyId,
                    fiscalYearId: selectedYear?.id,
                    dateTo: dateTo || undefined,
                  }).then((b) => downloadBlob(b, `bilan_${bilan.dateTo}.pdf`))
                }
              >
                Export PDF
              </button>
            </div>
          </div>
          <div className="acc-split-2">
            <div className="acc-ledger-col">
              <div className="acc-ledger-col-head">Actif</div>
              <div className="table-wrap">
                <table className="data-table">
                  <tbody>
                    {bilan.actif.map((r) => (
                      <tr key={`a-${r.code}`}>
                        <td className="coa-code">{r.code}</td>
                        <td>{r.name}</td>
                        <td style={{ textAlign: 'right' }}>{formatMoney(r.balance)}</td>
                      </tr>
                    ))}
                    <tr className="acc-total-row">
                      <td colSpan={2}>
                        <strong>Total actif</strong>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong>{formatMoney(bilan.totalActif)}</strong>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div className="acc-ledger-col">
              <div className="acc-ledger-col-head">Passif</div>
              <div className="table-wrap">
                <table className="data-table">
                  <tbody>
                    {bilan.passif.map((r) => (
                      <tr key={`p-${r.code}`}>
                        <td className="coa-code">{r.code}</td>
                        <td>{r.name}</td>
                        <td style={{ textAlign: 'right' }}>{formatMoney(r.balance)}</td>
                      </tr>
                    ))}
                    <tr className="acc-total-row">
                      <td colSpan={2}>
                        <strong>Total passif</strong>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong>{formatMoney(bilan.totalPassif)}</strong>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {tab === 'resultat' && resultat ? (
        <section className="card acc-card">
          <div className="acc-card-head">
            <div>
              <h2>Compte de résultat</h2>
              <p className="acc-meta">{resultat.fiscalYear.label}</p>
            </div>
            <button
              type="button"
              className="btn secondary btn-sm"
              disabled={busy}
              onClick={() =>
                void exportAccountingIncomeStatementPdf(periodParams).then((b) =>
                  downloadBlob(b, `resultat_${resultat.dateFrom}_${resultat.dateTo}.pdf`),
                )
              }
            >
              Export PDF
            </button>
          </div>
          <div className="acc-split-2">
            <div className="acc-ledger-col">
              <div className="acc-ledger-col-head">Produits</div>
              <div className="table-wrap">
                <table className="data-table">
                  <tbody>
                    {resultat.produits.map((r) => (
                      <tr key={`pr-${r.code}`}>
                        <td className="coa-code">{r.code}</td>
                        <td>{r.name}</td>
                        <td style={{ textAlign: 'right' }}>
                          {formatMoney(r.balanceSide === 'credit' ? r.balance : -r.balance)}
                        </td>
                      </tr>
                    ))}
                    <tr className="acc-total-row">
                      <td colSpan={2}>
                        <strong>Total</strong>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong>{formatMoney(resultat.totalProduits)}</strong>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div className="acc-ledger-col">
              <div className="acc-ledger-col-head">Charges</div>
              <div className="table-wrap">
                <table className="data-table">
                  <tbody>
                    {resultat.charges.map((r) => (
                      <tr key={`ch-${r.code}`}>
                        <td className="coa-code">{r.code}</td>
                        <td>{r.name}</td>
                        <td style={{ textAlign: 'right' }}>
                          {formatMoney(r.balanceSide === 'debit' ? r.balance : -r.balance)}
                        </td>
                      </tr>
                    ))}
                    <tr className="acc-total-row">
                      <td colSpan={2}>
                        <strong>Total</strong>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <strong>{formatMoney(resultat.totalCharges)}</strong>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="acc-result-banner">
            <span>{resultat.resultatLabel}</span>
            <strong>{formatMoney(Math.abs(resultat.resultat))}</strong>
          </div>
        </section>
      ) : null}

      {tab === 'reprise' ? (
        <section className="card acc-card">
          <div className="acc-card-head">
            <h2>Reprise historique</h2>
          </div>
          {!openYear ? (
            <p className="acc-empty">Ouvrez un exercice pour lancer la reprise.</p>
          ) : (
            <div className="acc-reprise">
              <div className="acc-fy-current">
                <div className="acc-fy-label">{openYear.label}</div>
                <div className="acc-fy-range">
                  {ymdFromIso(openYear.startDate)} → {ymdFromIso(openYear.endDate)}
                </div>
              </div>
              {canManage ? (
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy}
                  onClick={() => void onBackfill()}
                >
                  Lancer la reprise
                </button>
              ) : (
                <p className="acc-empty">Accès réservé</p>
              )}
            </div>
          )}
          {backfillResult ? (
            <div className="acc-kpi-grid">
              <div className="acc-kpi">
                <span>Ventes</span>
                <strong>{backfillResult.posted.sales}</strong>
              </div>
              <div className="acc-kpi">
                <span>Crédit</span>
                <strong>{backfillResult.posted.creditSales}</strong>
              </div>
              <div className="acc-kpi">
                <span>Encaissements</span>
                <strong>{backfillResult.posted.creditPayments}</strong>
              </div>
              <div className="acc-kpi">
                <span>Dépenses</span>
                <strong>{backfillResult.posted.expenses}</strong>
              </div>
              <div className="acc-kpi">
                <span>Achats</span>
                <strong>{backfillResult.posted.purchases}</strong>
              </div>
              <div className="acc-kpi">
                <span>Banques</span>
                <strong>{backfillResult.posted.bankManual}</strong>
              </div>
              <div className="acc-kpi">
                <span>Fournisseurs</span>
                <strong>{backfillResult.posted.supplierPayments}</strong>
              </div>
              <div className="acc-kpi">
                <span>Immos</span>
                <strong>{backfillResult.posted.fixedAssets}</strong>
              </div>
              <div className="acc-kpi">
                <span>Ignorées</span>
                <strong>
                  {backfillResult.skipped.alreadyPosted +
                    backfillResult.skipped.outsidePeriod +
                    backfillResult.skipped.other}
                </strong>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === 'fournisseurs' ? (
        <div className="acc-grid-2">
          <section className="card acc-card">
            <div className="acc-card-head">
              <h2>Dettes fournisseurs</h2>
            </div>
            <p className="acc-big-amount">
              {formatMoney(suppliers?.suppliersPayable ?? 0)}
            </p>
            {canWrite && openYear ? (
              <form onSubmit={(e) => void onPaySupplier(e)} className="form-stack">
                <h3>Paiement</h3>
                <label>
                  Fournisseur
                  <input
                    list="supplier-names"
                    value={paySupplier}
                    onChange={(e) => setPaySupplier(e.target.value)}
                    required
                  />
                  <datalist id="supplier-names">
                    {(suppliers?.supplierNames ?? []).map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
                </label>
                <label>
                  Montant
                  <input
                    type="number"
                    min={0.01}
                    step="0.01"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    required
                  />
                </label>
                <label>
                  Mode
                  <select
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as 'CASH' | 'BANK')}
                  >
                    <option value="CASH">Caisse</option>
                    <option value="BANK">Banque</option>
                  </select>
                </label>
                {payMethod === 'BANK' ? (
                  <label>
                    Compte bancaire
                    <select
                      value={payBankId}
                      onChange={(e) =>
                        setPayBankId(e.target.value ? Number(e.target.value) : '')
                      }
                      required
                    >
                      <option value="">—</option>
                      {bankAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.bankName ? `${a.bankName} · ` : ''}
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label>
                  Date
                  <input
                    type="date"
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    required
                  />
                </label>
                <button type="submit" className="btn primary" disabled={busy}>
                  Enregistrer le paiement
                </button>
              </form>
            ) : (
              <p className="acc-empty">
                {!openYear ? 'Ouvrez un exercice' : 'Accès réservé'}
              </p>
            )}
          </section>
          <section className="card acc-card">
            <div className="acc-card-head">
              <h2>Historique</h2>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Fournisseur</th>
                    <th>Mode</th>
                    <th>Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {(suppliers?.payments ?? []).map((p) => (
                    <tr key={p.id}>
                      <td>{ymdFromIso(p.paidAt)}</td>
                      <td>{p.supplierName}</td>
                      <td>
                        {p.method === 'BANK'
                          ? `Banque${p.bankAccount ? ` · ${p.bankAccount.bank.name}` : ''}`
                          : 'Caisse'}
                      </td>
                      <td style={{ textAlign: 'right' }}>{formatMoney(p.amount)}</td>
                    </tr>
                  ))}
                  {(suppliers?.payments ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={4} className="muted">
                        Aucun paiement
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}

      {tab === 'immos' ? (
        <div className="acc-grid-2">
          <section className="card acc-card">
            <div className="acc-card-head">
              <h2>Nouvelle immobilisation</h2>
            </div>
            {!canWrite || !openYear ? (
              <p className="acc-empty">
                {!openYear ? 'Ouvrez un exercice' : 'Accès réservé'}
              </p>
            ) : (
              <form onSubmit={(e) => void onCreateAsset(e)} className="form-stack">
                <label>
                  Désignation
                  <input
                    value={assetName}
                    onChange={(e) => setAssetName(e.target.value)}
                    required
                    minLength={2}
                  />
                </label>
                <label>
                  Date d’acquisition
                  <input
                    type="date"
                    value={assetDate}
                    onChange={(e) => setAssetDate(e.target.value)}
                    required
                  />
                </label>
                <label>
                  Coût d’acquisition
                  <input
                    type="number"
                    min={0.01}
                    step="0.01"
                    value={assetCost}
                    onChange={(e) => setAssetCost(e.target.value)}
                    required
                  />
                </label>
                <label>
                  Valeur résiduelle
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={assetResidual}
                    onChange={(e) => setAssetResidual(e.target.value)}
                  />
                </label>
                <label>
                  Durée (mois)
                  <input
                    type="number"
                    min={1}
                    value={assetMonths}
                    onChange={(e) => setAssetMonths(e.target.value)}
                    required
                  />
                </label>
                <label>
                  Financé par
                  <select
                    value={assetPaidFrom}
                    onChange={(e) =>
                      setAssetPaidFrom(e.target.value as 'CASH' | 'BANK' | 'SUPPLIER')
                    }
                  >
                    <option value="CASH">Caisse</option>
                    <option value="BANK">Banque</option>
                    <option value="SUPPLIER">Fournisseur (crédit)</option>
                  </select>
                </label>
                {assetPaidFrom === 'BANK' ? (
                  <label>
                    Compte bancaire
                    <select
                      value={assetBankId}
                      onChange={(e) =>
                        setAssetBankId(e.target.value ? Number(e.target.value) : '')
                      }
                      required
                    >
                      <option value="">—</option>
                      {bankAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.bankName ? `${a.bankName} · ` : ''}
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <button type="submit" className="btn primary" disabled={busy}>
                  Enregistrer
                </button>
              </form>
            )}
          </section>
          <section className="card acc-card">
            <div className="acc-card-head">
              <h2>Amortissements</h2>
            </div>
            <label>
              Période
              <input
                type="month"
                value={deprPeriod}
                onChange={(e) => setDeprPeriod(e.target.value)}
              />
            </label>
            {canManage ? (
              <button
                type="button"
                className="btn secondary"
                style={{ marginTop: '0.75rem' }}
                disabled={busy || !openYear}
                onClick={() => void onRunDepreciation()}
              >
                Passer le mois
              </button>
            ) : (
              <p className="acc-empty">Accès réservé</p>
            )}
          </section>
          <section className="card acc-card" style={{ gridColumn: '1 / -1' }}>
            <div className="acc-card-head">
              <h2>Registre</h2>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Désignation</th>
                    <th>Acquisition</th>
                    <th>Coût</th>
                    <th>Mensuel</th>
                    <th>Cumul amort.</th>
                    <th>VNC</th>
                    <th>Dernière dot.</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map((a) => (
                    <tr key={a.id}>
                      <td>{a.name}</td>
                      <td>{ymdFromIso(a.acquisitionDate)}</td>
                      <td style={{ textAlign: 'right' }}>{formatMoney(a.acquisitionCost)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {formatMoney(a.monthlyDepreciation)}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {formatMoney(a.accumulatedDepreciation)}
                      </td>
                      <td style={{ textAlign: 'right' }}>{formatMoney(a.netBookValue)}</td>
                      <td>{a.lastDepreciationPeriod ?? '—'}</td>
                    </tr>
                  ))}
                  {assets.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="muted">
                        Aucune immobilisation
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}

      {tab === 'saisie' ? (
        <section className="card acc-card">
          <div className="acc-card-head">
            <h2>Saisie OD</h2>
          </div>
          {!canWrite ? (
            <p className="acc-empty">Accès réservé</p>
          ) : !openYear ? (
            <p className="acc-empty">Ouvrez un exercice</p>
          ) : (
            <form onSubmit={(e) => void onSaveManual(e)} className="form-stack">
              <label>
                Date
                <input
                  type="date"
                  value={manualDate}
                  min={ymdFromIso(openYear.startDate)}
                  max={ymdFromIso(openYear.endDate)}
                  onChange={(e) => setManualDate(e.target.value)}
                  required
                />
              </label>
              <label>
                Libellé
                <input
                  value={manualDesc}
                  onChange={(e) => setManualDesc(e.target.value)}
                  required
                  minLength={2}
                />
              </label>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Compte</th>
                      <th>Débit</th>
                      <th>Crédit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {manualLines.map((line, i) => (
                      <tr key={i}>
                        <td>
                          <select
                            value={line.accountCode}
                            onChange={(e) => {
                              const next = [...manualLines];
                              next[i] = { ...next[i], accountCode: e.target.value };
                              setManualLines(next);
                            }}
                          >
                            <option value="">—</option>
                            {activeAccounts.map((a) => (
                              <option key={a.id} value={a.code}>
                                {a.code} — {a.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={line.debit}
                            onChange={(e) => {
                              const next = [...manualLines];
                              next[i] = { ...next[i], debit: e.target.value, credit: '' };
                              setManualLines(next);
                            }}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={line.credit}
                            onChange={(e) => {
                              const next = [...manualLines];
                              next[i] = { ...next[i], credit: e.target.value, debit: '' };
                              setManualLines(next);
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() =>
                    setManualLines((lines) => [
                      ...lines,
                      { accountCode: '', debit: '', credit: '' },
                    ])
                  }
                >
                  + Ligne
                </button>
                <button type="submit" className="btn primary" disabled={busy}>
                  Enregistrer l’écriture
                </button>
              </div>
            </form>
          )}
        </section>
      ) : null}
    </div>
  );
}
