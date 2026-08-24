import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  createFinanceEntry,
  deleteFinanceLedgerRow,
  exportFinanceLedgerPdf,
  exportGlobalStockSnapshotPdf,
  getCompanies,
  getCompanyById,
  exportDashboardSalesByProductPdf,
  getDashboardSummaryRange,
  getDashboardSalesByProduct,
  getDepartments,
  getFinanceLedger,
  getGlobalStockSnapshot,
  getInventoryAlerts,
  getInventoryMovements,
  getZeroStockAlerts,
  getPrinterSettings,
  cancelSale,
  deleteSalePermanently,
  getSaleById,
  listSales,
  refundSale,
} from '../services/api';
import type {
  CompanyListItem,
  CompanyProfile,
  DashboardBalanceSnapshot,
  DashboardSalesByProductRow,
  Department,
  DepartmentPrinterSettings,
  FinanceLedgerRow,
  GlobalStockSnapshotItem,
  Product,
  RegisterSessionDetail,
  Sale,
  StockMovementRow,
} from '../types/api';
import { formatQuantity } from '../utils/formatQuantity';
import { saleTxnNumber } from '../utils/saleTxnNumber';
import { useAutoClearMessage } from '../hooks/useAutoClearMessage';
import { useAuth } from '../context/AuthContext';
import { AuditJournalPanel } from '../components/AuditJournalPanel';
import { DashboardBanksTab } from '../components/DashboardBanksTab';
import { DashboardBeneficesTab } from '../components/DashboardBeneficesTab';
import { DashboardSyntheseTab } from '../components/DashboardSyntheseTab';
import { RegisterSessionModal } from '../components/RegisterSessionModal';
import { RegisterSessionsPanel } from '../components/RegisterSessionsPanel';
import { MoneyField } from '../components/MoneyField';
import { SaleDetailModal } from '../components/SaleDetailModal';
import { VentesDepartmentModal } from '../components/VentesDepartmentModal';
import { StockLowAlertsPanel } from '../components/StockLowAlertsPanel';
import { StockZeroAlertsPanel } from '../components/StockZeroAlertsPanel';
import { StockMovementsPanel } from '../components/StockMovementsPanel';
import { InventoryPhysicalSection } from '../components/InventoryPhysicalSection';
import { formatMoney } from '../utils/currency';
import { formatDateTime, formatYmd, defaultMonthStartYmd, addDaysYmd, ymdStartIso, ymdEndIso } from '../utils/datetime';
import {
  EXPENSE_LABEL_OPTIONS,
  EXPENSE_LABEL_OTHER,
} from '../utils/expenseLabels';
import { buildDisbursementOrderPayload } from '../utils/disbursementOrderPayload';

export function DashboardPage() {
  type TabId = 'synthese' | 'ventes' | 'achats' | 'stock' | 'banque' | 'benefices';

  const { can, canPerm } = useAuth();
  const isAdmin = can(['ADMIN']);
  const canAccessDashboard = canPerm('dashboard.view');
  const canManageFinance = canPerm('finance.write');
  /** Voir journal / totaux finance (pas seulement saisir une dépense). */
  const canViewFinance = canPerm('finance.view') || canManageFinance;
  /** Formulaire dépense seul — sans accès au reste de la finance. */
  const canRecordExpense = canPerm('finance.expense') || canManageFinance;
  const showExpensesTab = canRecordExpense || canViewFinance;
  const canCancelOrRefund = canPerm('sales.cancel');
  const canDeleteSale = canPerm('sales.delete');
  const canSeePurchases = isAdmin || canPerm('purchasing.manage');
  const canSeeSynthesis = isAdmin || canPerm('dashboard.synthesis') || canPerm('reports.view');
  const canSeeBanks = isAdmin || canPerm('banks.view') || canPerm('banks.manage');
  const canSeeBenefices = isAdmin || canPerm('reports.view');
  const canSeeGlobalStock = isAdmin || canPerm('stock.global') || canPerm('reports.view');
  const canSeeSales = isAdmin || canPerm('sales.view');
  /** Historique ventes libre (rapports). */
  const canSeeUnlimitedSalesRange = isAdmin || canPerm('reports.view');
  /** Totaux ventes : illimité via reports, ou fenêtre 2 jours via sales.recent_totals. */
  const canSeeSalesTotals =
    canSeeUnlimitedSalesRange || canPerm('sales.recent_totals');
  const salesRecentMinYmd = useMemo(() => {
    if (canSeeUnlimitedSalesRange || !canSeeSalesTotals) return null;
    return addDaysYmd(formatYmd(new Date()), -1);
  }, [canSeeUnlimitedSalesRange, canSeeSalesTotals]);

  function defaultVentesFromYmd() {
    if (salesRecentMinYmd) return salesRecentMinYmd;
    return defaultMonthStartYmd();
  }

  function clampSalesRangeYmd(from: string, to: string): { from: string; to: string } {
    const today = formatYmd(new Date());
    let nextFrom = from;
    let nextTo = to;
    if (salesRecentMinYmd) {
      if (nextFrom < salesRecentMinYmd) nextFrom = salesRecentMinYmd;
      if (nextTo > today) nextTo = today;
      if (nextTo < nextFrom) nextTo = nextFrom;
    }
    return { from: nextFrom, to: nextTo };
  }

  const [tab, setTab] = useState<TabId>(() => (canSeeSynthesis ? 'synthese' : 'ventes'));
  const [inventoryHistorySlot, setInventoryHistorySlot] = useState<HTMLDivElement | null>(null);
  const [ledgerPdfLoading, setLedgerPdfLoading] = useState(false);
  const [saleActionBusy, setSaleActionBusy] = useState(false);

  const [companies, setCompanies] = useState<CompanyListItem[]>([]);
  const [companyId, setCompanyId] = useState<number | ''>('');

  const [expenseLabelChoice, setExpenseLabelChoice] = useState<string>('');
  const [expenseDescOther, setExpenseDescOther] = useState('');
  const [expenseDetail, setExpenseDetail] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseEntryDate, setExpenseEntryDate] = useState(() => formatYmd(new Date()));
  const [expensePrintOrder, setExpensePrintOrder] = useState(false);
  const [expenseDeptId, setExpenseDeptId] = useState<number | ''>('');

  const [achatsTotalsDateFrom, setAchatsTotalsDateFrom] = useState(defaultMonthStartYmd);
  const [achatsTotalsDateTo, setAchatsTotalsDateTo] = useState(() => formatYmd(new Date()));
  const [achatsTotalsSnapshot, setAchatsTotalsSnapshot] = useState<DashboardBalanceSnapshot | null>(null);
  const [achatsTotalsLoading, setAchatsTotalsLoading] = useState(false);

  const [ledgerDateFrom, setLedgerDateFrom] = useState(defaultMonthStartYmd);
  const [ledgerDateTo, setLedgerDateTo] = useState(() => formatYmd(new Date()));
  const [ledgerNature, setLedgerNature] = useState<'all' | 'purchase' | 'sale' | 'expense'>(
    isAdmin ? 'all' : 'expense',
  );

  /** Nature journal : les managers ne voient pas les lignes d’achat. */
  const effectiveLedgerNature = useMemo((): 'all' | 'purchase' | 'sale' | 'expense' => {
    if (canSeePurchases) return ledgerNature;
    if (ledgerNature === 'purchase') return 'expense';
    return ledgerNature;
  }, [canSeePurchases, ledgerNature]);

  useEffect(() => {
    if (!canSeePurchases && ledgerNature === 'purchase') {
      setLedgerNature('expense');
    }
  }, [canSeePurchases, ledgerNature]);

  function sanitizeLedgerItems(items: FinanceLedgerRow[]) {
    if (canSeePurchases) return items;
    return items.filter((row) => row.kind !== 'PURCHASE');
  }

  const [ledgerItems, setLedgerItems] = useState<FinanceLedgerRow[]>([]);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [ledgerSkip, setLedgerSkip] = useState(0);
  const ledgerTake = 10;
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerDeletingId, setLedgerDeletingId] = useState<string | null>(null);

  const [alerts, setAlerts] = useState<Product[]>([]);
  const [alertsTotal, setAlertsTotal] = useState(0);
  const [alertsSkip, setAlertsSkip] = useState(0);
  const alertsTake = 10;
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [zeroAlerts, setZeroAlerts] = useState<Product[]>([]);
  const [zeroAlertsTotal, setZeroAlertsTotal] = useState(0);
  const [zeroAlertsSkip, setZeroAlertsSkip] = useState(0);
  const zeroAlertsTake = 8;
  const [zeroAlertsLoading, setZeroAlertsLoading] = useState(false);

  const [movementsLoading, setMovementsLoading] = useState(false);
  const [movements, setMovements] = useState<StockMovementRow[]>([]);
  const [movementsTotal, setMovementsTotal] = useState(0);
  const [movementsSkip, setMovementsSkip] = useState(0);
  /** Taille d’une « page » (chargement initial + pas du « Charger plus »). */
  const [movementsPageSize, setMovementsPageSize] = useState<5 | 10>(5);
  /** Tri serveur par date de mouvement. */
  const [movementDateOrder, setMovementDateOrder] = useState<'asc' | 'desc'>('desc');
  const [stockProductId, setStockProductId] = useState<number | ''>('');
  const [movementsDateFrom, setMovementsDateFrom] = useState('');
  const [movementsDateTo, setMovementsDateTo] = useState('');
  const [registerSessionModal, setRegisterSessionModal] = useState<RegisterSessionDetail | null>(null);
  const [globalCompanyIds, setGlobalCompanyIds] = useState<number[]>([]);
  const [globalDeptIds, setGlobalDeptIds] = useState<number[]>([]);
  const [globalItems, setGlobalItems] = useState<GlobalStockSnapshotItem[]>([]);
  const [globalAsOf, setGlobalAsOf] = useState('');
  const [globalAsOfApplied, setGlobalAsOfApplied] = useState<string | null>(null);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [globalExporting, setGlobalExporting] = useState(false);

  const [sales, setSales] = useState<Sale[]>([]);
  const [salesTotal, setSalesTotal] = useState(0);
  const [salesSkip, setSalesSkip] = useState(0);
  const salesTake = 5;
  const [salesLoading, setSalesLoading] = useState(false);
  const [saleModal, setSaleModal] = useState<Sale | null>(null);
  const [saleReceiptCompany, setSaleReceiptCompany] = useState<CompanyProfile | null>(null);
  const [saleReceiptPrinter, setSaleReceiptPrinter] = useState<DepartmentPrinterSettings | null>(null);
  const [saleDetailLoading, setSaleDetailLoading] = useState(false);
  const [saleDeletingId, setSaleDeletingId] = useState<number | null>(null);

  const [salesByProductRows, setSalesByProductRows] = useState<DashboardSalesByProductRow[]>([]);
  const [salesByProductLoading, setSalesByProductLoading] = useState(false);
  const [ventesDateFrom, setVentesDateFrom] = useState(() => {
    const today = formatYmd(new Date());
    if (!canSeeUnlimitedSalesRange && canSeeSalesTotals) return addDaysYmd(today, -1);
    return defaultMonthStartYmd();
  });
  const [ventesDateTo, setVentesDateTo] = useState(() => formatYmd(new Date()));
  const [ventesPdfLoading, setVentesPdfLoading] = useState(false);
  const [ventesDeptModal, setVentesDeptModal] = useState<{
    label: string;
    departmentId: number | null;
    rows: DashboardSalesByProductRow[];
  } | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [txnDateFrom, setTxnDateFrom] = useState(() => {
    const today = formatYmd(new Date());
    if (!canSeeUnlimitedSalesRange && canSeeSalesTotals) return addDaysYmd(today, -1);
    return defaultMonthStartYmd();
  });
  const [txnDateTo, setTxnDateTo] = useState(() => formatYmd(new Date()));

  const [msg, setMsg] = useAutoClearMessage();

  const allowedTabs = useMemo(() => {
    const tabs: Array<[TabId, string]> = [];
    if (canSeeSynthesis) tabs.push(['synthese', 'Synthèse']);
    if (canSeeSales) tabs.push(['ventes', 'Ventes']);
    if (canSeeGlobalStock) tabs.push(['stock', 'Stock & Mouvements']);
    if (showExpensesTab) {
      tabs.push([
        'achats',
        canViewFinance && (isAdmin || canSeePurchases) ? 'Achats & Dépenses' : 'Dépenses',
      ]);
    }
    if (canSeeBanks) tabs.push(['banque', 'Banque']);
    if (canSeeBenefices) tabs.push(['benefices', 'Analyse des bénéfices']);
    return tabs;
  }, [
    canSeeSynthesis,
    canSeeSales,
    canSeeGlobalStock,
    showExpensesTab,
    canViewFinance,
    canSeePurchases,
    canSeeBanks,
    canSeeBenefices,
    isAdmin,
  ]);

  useEffect(() => {
    if (allowedTabs.length === 0) return;
    if (!allowedTabs.some(([id]) => id === tab)) {
      setTab(allowedTabs[0][0]);
    }
  }, [allowedTabs, tab]);

  const salesByDepartmentGroups = useMemo(() => {
    const groups: {
      key: string;
      label: string;
      departmentId: number | null;
      rows: DashboardSalesByProductRow[];
    }[] = [];
    for (const r of salesByProductRows) {
      const label = r.departmentName?.trim() || 'Sans département';
      const key = String(r.departmentId ?? 'none');
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.rows.push(r);
      else groups.push({ key, label, departmentId: r.departmentId, rows: [r] });
    }
    return groups;
  }, [salesByProductRows]);

  const ventesGrandTotal = useMemo(
    () => salesByProductRows.reduce((s, r) => s + r.totalSubtotal, 0),
    [salesByProductRows],
  );

  const salesTxnFilterParams = useMemo(() => {
    let createdFrom: string | undefined;
    let createdTo: string | undefined;
    if (txnDateFrom.trim()) createdFrom = ymdStartIso(txnDateFrom);
    if (txnDateTo.trim()) createdTo = ymdEndIso(txnDateTo);
    return { createdFrom, createdTo };
  }, [txnDateFrom, txnDateTo]);

  const salesListQuery = useMemo(() => ({ ...salesTxnFilterParams }), [salesTxnFilterParams]);

  const selectedCompanyName = useMemo(
    () => (companyId === '' ? undefined : companies.find((c) => c.id === companyId)?.name),
    [companies, companyId],
  );

  useEffect(() => {
    if (!canAccessDashboard) return;
    void getCompanies()
      .then((list) => {
        setCompanies(list);
        setCompanyId((prev) => (prev !== '' ? prev : list[0]?.id ?? ''));
      })
      .catch(() => setMsg('Impossible de charger les entreprises.', { persist: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccessDashboard]);

  useEffect(() => {
    if (!canAccessDashboard || companyId === '') {
      setDepartments([]);
      setExpenseDeptId('');
      return;
    }
    void getDepartments(Number(companyId))
      .then((d) => {
        setDepartments(d);
        setExpenseDeptId((prev) => {
          if (prev !== '' && d.some((x) => x.id === prev)) return prev;
          return d[0]?.id ?? '';
        });
      })
      .catch(() => {
        setDepartments([]);
        setExpenseDeptId('');
      });
  }, [companyId, canAccessDashboard]);

  useEffect(() => {
    if (!canAccessDashboard || companyId === '') return;

    const cid = Number(companyId);
    setAchatsTotalsDateFrom(defaultMonthStartYmd());
    setAchatsTotalsDateTo(formatYmd(new Date()));
    setAchatsTotalsSnapshot(null);
    setLedgerDateFrom(defaultMonthStartYmd());
    setLedgerDateTo(formatYmd(new Date()));
    setLedgerNature('all');
    setLedgerItems([]);
    setLedgerTotal(0);
    setLedgerSkip(0);
    setExpenseEntryDate(formatYmd(new Date()));
    setAlerts([]);
    setAlertsTotal(0);
    setAlertsSkip(0);
    setMovements([]);
    setMovementsTotal(0);
    setMovementsSkip(0);
    setMovementsPageSize(5);
    setMovementDateOrder('desc');
    setStockProductId('');
    setGlobalItems([]);
    setGlobalCompanyIds([]);
    setGlobalDeptIds([]);
    setSales([]);
    setSalesTotal(0);
    setSalesSkip(0);
    setSaleModal(null);
    setSaleReceiptCompany(null);
    setSaleReceiptPrinter(null);
    setSalesByProductRows([]);
    setVentesDeptModal(null);
    setVentesDateFrom(defaultVentesFromYmd());
    setVentesDateTo(formatYmd(new Date()));
    setTxnDateFrom(defaultVentesFromYmd());
    setTxnDateTo(formatYmd(new Date()));

    if (!canSeeGlobalStock) return;

    void Promise.all([
      getInventoryAlerts({ threshold: 5, companyId: cid, skip: 0, take: alertsTake }),
      getZeroStockAlerts({ companyId: cid, skip: 0, take: zeroAlertsTake }),
      getInventoryMovements({ companyId: cid, skip: 0, take: 5, order: 'desc' }),
    ])
      .then(([a, z, mov]) => {
        setAlerts(a.items);
        setAlertsTotal(a.total);
        setAlertsSkip(0);
        setZeroAlerts(z.items);
        setZeroAlertsTotal(z.total);
        setZeroAlertsSkip(0);
        setMovements(mov.items);
        setMovementsTotal(mov.total);
      })
      .catch(() => setMsg('Impossible de charger le tableau de bord.', { persist: true }));
  }, [companyId, canAccessDashboard, canSeeGlobalStock, setMsg]);

  useEffect(() => {
    if (!canSeeGlobalStock || companyId === '' || tab !== 'stock') return;
    const cid = Number(companyId);
    setGlobalCompanyIds([cid]);
    setGlobalDeptIds([]);
    setGlobalItems([]);
    setGlobalAsOf('');
    setGlobalAsOfApplied(null);
  }, [companyId, tab, canSeeGlobalStock]);

  async function loadGlobalSnapshot() {
    setGlobalLoading(true);
    try {
      const asOf = globalAsOf.trim() || undefined;
      const snap = await getGlobalStockSnapshot({
        companyIds: globalCompanyIds.length ? globalCompanyIds : undefined,
        departmentIds: globalDeptIds.length ? globalDeptIds : undefined,
        asOf,
      });
      setGlobalItems(snap.items);
      setGlobalAsOfApplied(snap.asOf ?? (asOf ? snap.generatedAt : null));
    } catch {
      setMsg('Chargement inventaire impossible.', { persist: true });
    } finally {
      setGlobalLoading(false);
    }
  }

  async function onExportGlobalPdf() {
    setGlobalExporting(true);
    try {
      const asOf = globalAsOf.trim() || undefined;
      const blob = await exportGlobalStockSnapshotPdf({
        companyIds: globalCompanyIds.length ? globalCompanyIds : undefined,
        departmentIds: globalDeptIds.length ? globalDeptIds : undefined,
        asOf,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = asOf
        ? `inventaire_global_au_${asOf}.pdf`
        : `inventaire_global_${formatYmd(new Date())}.pdf`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      setMsg('Export impossible.', { persist: true });
    } finally {
      setGlobalExporting(false);
    }
  }

  function toggleGlobalCompany(id: number) {
    setGlobalCompanyIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function toggleGlobalDept(id: number) {
    setGlobalDeptIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  useEffect(() => {
    if (!canAccessDashboard || companyId === '' || tab !== 'ventes' || !canSeeSalesTotals) {
      if (!canSeeSalesTotals) setSalesByProductRows([]);
      return;
    }
    const { from, to } = clampSalesRangeYmd(ventesDateFrom, ventesDateTo);
    if (from !== ventesDateFrom || to !== ventesDateTo) {
      setVentesDateFrom(from);
      setVentesDateTo(to);
      return;
    }
    if (!from || !to || from > to) return;
    setSalesByProductLoading(true);
    void getDashboardSalesByProduct({
      companyId: Number(companyId),
      dateFrom: from,
      dateTo: to,
    })
      .then(setSalesByProductRows)
      .catch(() =>
        setMsg('Impossible de charger le détail des ventes par produit.', { persist: true }),
      )
      .finally(() => setSalesByProductLoading(false));
  }, [companyId, ventesDateFrom, ventesDateTo, tab, canAccessDashboard, canSeeSalesTotals, setMsg]);

  useEffect(() => {
    if (!canAccessDashboard || companyId === '' || tab !== 'ventes') return;
    if (!salesRecentMinYmd) return;
    const { from, to } = clampSalesRangeYmd(txnDateFrom, txnDateTo);
    if (from !== txnDateFrom || to !== txnDateTo) {
      setTxnDateFrom(from);
      setTxnDateTo(to);
    }
  }, [tab, companyId, canAccessDashboard, salesRecentMinYmd, txnDateFrom, txnDateTo]);

  useEffect(() => {
    if (!canAccessDashboard || companyId === '' || tab !== 'ventes') return;
    setSalesLoading(true);
    void listSales({
      companyId: Number(companyId),
      skip: 0,
      take: salesTake,
      ...salesListQuery,
    })
      .then((sal) => {
        setSales(sal.items);
        setSalesTotal(sal.total);
        setSalesSkip(0);
      })
      .catch(() => setMsg('Impossible de charger les transactions de vente.', { persist: true }))
      .finally(() => setSalesLoading(false));
  }, [companyId, salesListQuery, canAccessDashboard, setMsg, tab]);

  useEffect(() => {
    if (!canViewFinance || companyId === '' || tab !== 'achats') return;
    if (!achatsTotalsDateFrom || !achatsTotalsDateTo || achatsTotalsDateFrom > achatsTotalsDateTo) return;
    setAchatsTotalsLoading(true);
    void getDashboardSummaryRange({
      companyId: Number(companyId),
      dateFrom: achatsTotalsDateFrom,
      dateTo: achatsTotalsDateTo,
    })
      .then(setAchatsTotalsSnapshot)
      .catch(() =>
        setMsg('Impossible de charger les totaux achats / dépenses.', { persist: true }),
      )
      .finally(() => setAchatsTotalsLoading(false));
  }, [tab, companyId, achatsTotalsDateFrom, achatsTotalsDateTo, canViewFinance, setMsg]);

  useEffect(() => {
    if (!canViewFinance || companyId === '' || tab !== 'achats') return;
    if (!ledgerDateFrom || !ledgerDateTo || ledgerDateFrom > ledgerDateTo) return;
    setLedgerLoading(true);
    setLedgerSkip(0);
    void getFinanceLedger({
      companyId: Number(companyId),
      dateFrom: ledgerDateFrom,
      dateTo: ledgerDateTo,
      nature: effectiveLedgerNature,
      skip: 0,
      take: ledgerTake,
    })
      .then((res) => {
        const items = sanitizeLedgerItems(res.items);
        setLedgerItems(items);
        setLedgerTotal(canSeePurchases ? res.total : items.length);
        setLedgerSkip(0);
      })
      .catch(() => setMsg('Impossible de charger le journal unifié.', { persist: true }))
      .finally(() => setLedgerLoading(false));
  }, [tab, companyId, ledgerDateFrom, ledgerDateTo, effectiveLedgerNature, canViewFinance, canSeePurchases, setMsg]);

  async function refreshAchatsLedger() {
    if (companyId === '' || !canViewFinance) return;
    const cid = Number(companyId);
    const [range, ledgerRes] = await Promise.all([
      getDashboardSummaryRange({
        companyId: cid,
        dateFrom: achatsTotalsDateFrom,
        dateTo: achatsTotalsDateTo,
      }),
      getFinanceLedger({
        companyId: cid,
        dateFrom: ledgerDateFrom,
        dateTo: ledgerDateTo,
        nature: effectiveLedgerNature,
        skip: 0,
        take: ledgerTake,
      }),
    ]);
    setAchatsTotalsSnapshot(range);
    const items = sanitizeLedgerItems(ledgerRes.items);
    setLedgerItems(items);
    setLedgerTotal(canSeePurchases ? ledgerRes.total : items.length);
    setLedgerSkip(0);
  }

  async function submitExpense(e: FormEvent) {
    e.preventDefault();
    if (companyId === '' || !canRecordExpense) return;
    setMsg('');
    const amount = Number(expenseAmount);
    const description =
      expenseLabelChoice === EXPENSE_LABEL_OTHER
        ? expenseDescOther.trim()
        : expenseLabelChoice.trim();
    if (!description || !Number.isFinite(amount) || amount <= 0) return;
    if (expensePrintOrder && expenseDeptId === '') {
      setMsg('Choisissez un département pour imprimer l’ordre.', { persist: true });
      return;
    }

    try {
      const entry = await createFinanceEntry({
        type: 'EXPENSE',
        amount,
        description,
        detail: expenseDetail.trim() || undefined,
        companyId: Number(companyId),
        entryDate: expenseEntryDate.trim() || undefined,
      });

      let printNote = '';
      if (expensePrintOrder && expenseDeptId !== '' && window.desktopApp?.printReceipt) {
        try {
          const [company, printer] = await Promise.all([
            getCompanyById(Number(companyId)),
            getPrinterSettings(expenseDeptId),
          ]);
          const payload = buildDisbursementOrderPayload({
            entry,
            company,
            printer,
            entryDateYmd: expenseEntryDate.trim() || undefined,
          });
          const r = await window.desktopApp.printReceipt({
            ...payload,
            cashier: payload.preparedBy ?? 'N/A',
            items: [],
            total: payload.amount,
            paymentMode: 'Dépense',
          });
          printNote = r.ok ? ' Ordre de décaissement imprimé.' : ' Impression de l’ordre échouée.';
        } catch {
          printNote = ' Impression de l’ordre échouée.';
        }
      } else if (expensePrintOrder && !window.desktopApp?.printReceipt) {
        printNote = ' Impression disponible uniquement dans l’application bureau.';
      }

      setExpenseLabelChoice('');
      setExpenseDescOther('');
      setExpenseDetail('');
      setExpenseAmount('');
      setExpenseEntryDate(formatYmd(new Date()));
      setExpensePrintOrder(false);
      setMsg(`Dépense enregistrée.${printNote}`);

      await refreshAchatsLedger();
    } catch {
      setMsg("Erreur lors de l'enregistrement.", { persist: true });
    }
  }

  async function confirmDeleteLedgerRow(row: FinanceLedgerRow) {
    if (companyId === '') return;
    const kindLabel =
      row.kind === 'PURCHASE' ? 'réception d\'achat' : row.kind === 'SALE' ? 'vente' : 'dépense';
    const detail =
      row.kind === 'PURCHASE'
        ? 'Le stock sera annulé pour cette réception et la commande pourra être rouverte.'
        : row.kind === 'SALE'
          ? 'La vente, les paiements et l’écriture de caisse seront effacés. Si la vente était complétée, le stock sera rétabli.'
          : 'Cette dépense manuelle sera retirée du journal et des totaux.';
    const ok = window.confirm(
      `Supprimer définitivement cette ligne (${kindLabel}) ?\n\n${row.description}\n\n${detail}`,
    );
    if (!ok) return;
    setLedgerDeletingId(row.id);
    setMsg('');
    try {
      await deleteFinanceLedgerRow({ ledgerRowId: row.id, companyId: Number(companyId) });
      await refreshAchatsLedger();
      setMsg('Ligne supprimée.');
    } catch {
      setMsg('Impossible de supprimer cette ligne.', { persist: true });
    } finally {
      setLedgerDeletingId(null);
    }
  }

  async function loadMoreLedger() {
    if (ledgerLoading || companyId === '') return;
    if (ledgerSkip + ledgerTake >= ledgerTotal) return;
    setLedgerLoading(true);
    try {
      const cid = Number(companyId);
      const nextSkip = ledgerSkip + ledgerTake;
      const res = await getFinanceLedger({
        companyId: cid,
        dateFrom: ledgerDateFrom,
        dateTo: ledgerDateTo,
        nature: effectiveLedgerNature,
        skip: nextSkip,
        take: ledgerTake,
      });
      const extra = sanitizeLedgerItems(res.items);
      setLedgerItems((prev) => [...prev, ...extra]);
      setLedgerSkip(nextSkip);
      setLedgerTotal(canSeePurchases ? res.total : nextSkip + extra.length);
    } catch {
      setMsg('Impossible de charger plus de lignes du journal.', { persist: true });
    } finally {
      setLedgerLoading(false);
    }
  }

  async function refetchMovementsFromStart(opts: {
    order: 'asc' | 'desc';
    take: 5 | 10;
    dateFrom?: string;
    dateTo?: string;
  }) {
    if (companyId === '') return;
    setMovementsLoading(true);
    try {
      const cid = Number(companyId);
      const dateFrom = (opts.dateFrom ?? movementsDateFrom).trim() || undefined;
      const dateTo = (opts.dateTo ?? movementsDateTo).trim() || undefined;
      const mov = await getInventoryMovements({
        companyId: cid,
        skip: 0,
        take: opts.take,
        order: opts.order,
        dateFrom,
        dateTo,
      });
      setMovements(mov.items);
      setMovementsTotal(mov.total);
      setMovementsSkip(0);
    } catch {
      setMsg('Impossible de recharger les mouvements.', { persist: true });
    } finally {
      setMovementsLoading(false);
    }
  }

  async function resetMovementsToInitial() {
    setMovementDateOrder('desc');
    setMovementsPageSize(5);
    setStockProductId('');
    setMovementsDateFrom('');
    setMovementsDateTo('');
    await refetchMovementsFromStart({ order: 'desc', take: 5, dateFrom: '', dateTo: '' });
  }

  async function loadMoreMovements() {
    if (movementsLoading || companyId === '') return;
    if (movementsSkip + movementsPageSize >= movementsTotal) return;
    setMovementsLoading(true);
    try {
      const cid = Number(companyId);
      const nextSkip = movementsSkip + movementsPageSize;
      const mov = await getInventoryMovements({
        companyId: cid,
        skip: nextSkip,
        take: movementsPageSize,
        order: movementDateOrder,
        dateFrom: movementsDateFrom.trim() || undefined,
        dateTo: movementsDateTo.trim() || undefined,
      });
      setMovements((prev) => [...prev, ...mov.items]);
      setMovementsSkip(nextSkip);
      setMovementsTotal(mov.total);
    } catch {
      setMsg('Impossible de charger plus de mouvements.', { persist: true });
    } finally {
      setMovementsLoading(false);
    }
  }

  async function loadMoreSales() {
    if (salesLoading || companyId === '') return;
    if (salesSkip + salesTake >= salesTotal) return;
    setSalesLoading(true);
    try {
      const cid = Number(companyId);
      const nextSkip = salesSkip + salesTake;
      const sal = await listSales({
        companyId: cid,
        skip: nextSkip,
        take: salesTake,
        ...salesListQuery,
      });
      setSales((prev) => [...prev, ...sal.items]);
      setSalesSkip(nextSkip);
      setSalesTotal(sal.total);
    } catch {
      setMsg('Impossible de charger plus de ventes.', { persist: true });
    } finally {
      setSalesLoading(false);
    }
  }

  async function exportVentesParProduitPdf() {
    if (companyId === '') return;
    if (!ventesDateFrom || !ventesDateTo || ventesDateFrom > ventesDateTo) {
      setMsg('Indiquez une plage de dates valide (du … au …).', { persist: true });
      return;
    }
    setVentesPdfLoading(true);
    setMsg('');
    try {
      const blob = await exportDashboardSalesByProductPdf({
        companyId: Number(companyId),
        dateFrom: ventesDateFrom,
        dateTo: ventesDateTo,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ventes-produits_${ventesDateFrom}_${ventesDateTo}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setMsg("Impossible d'exporter le PDF.", { persist: true });
    } finally {
      setVentesPdfLoading(false);
    }
  }

  async function confirmDeleteSale(sale: Sale) {
    if (companyId === '') return;
    const ok = window.confirm(
      `Supprimer définitivement la vente n°${saleTxnNumber(sale)} ?\n\n` +
        `Cette action est irréversible : la vente, les lignes, les paiements et l’écriture de caisse seront effacés de la base. ` +
        `Si la vente était encore « complétée », le stock livré sera rétabli.`,
    );
    if (!ok) return;
    setSaleDeletingId(sale.id);
    setMsg('');
    try {
      await deleteSalePermanently(sale.id, Number(companyId));
      setSales((prev) => prev.filter((x) => x.id !== sale.id));
      setSalesTotal((t) => Math.max(0, t - 1));
      setSaleModal((m) => (m?.id === sale.id ? null : m));
      if (saleModal?.id === sale.id) {
        setSaleReceiptCompany(null);
        setSaleReceiptPrinter(null);
      }
      setMsg('Vente supprimée définitivement.');
    } catch {
      setMsg('Impossible de supprimer cette vente.', { persist: true });
    } finally {
      setSaleDeletingId(null);
    }
  }

  function removeSaleFromList(saleId: number) {
    setSales((prev) => prev.filter((x) => x.id !== saleId));
    setSalesTotal((t) => Math.max(0, t - 1));
    setSaleModal((m) => (m?.id === saleId ? null : m));
    if (saleModal?.id === saleId) {
      setSaleReceiptCompany(null);
      setSaleReceiptPrinter(null);
    }
  }

  async function confirmCancelSale(sale: Sale) {
    const ok = window.confirm(
      `Annuler la vente n°${saleTxnNumber(sale)} ?\n\n` +
        `L’écriture de caisse sera retirée. Le stock déjà livré sera réintégré.`,
    );
    if (!ok) return;
    setSaleActionBusy(true);
    setMsg('');
    try {
      await cancelSale(sale.id);
      removeSaleFromList(sale.id);
      setMsg(`Vente n°${saleTxnNumber(sale)} annulée.`);
    } catch {
      setMsg('Impossible d’annuler cette vente.', { persist: true });
    } finally {
      setSaleActionBusy(false);
    }
  }

  async function confirmRefundSale(sale: Sale) {
    const ok = window.confirm(
      `Rembourser la vente n°${saleTxnNumber(sale)} (${formatMoney(sale.total)}) ?\n\n` +
        `L’écriture de caisse sera retirée. Le stock déjà livré sera réintégré.`,
    );
    if (!ok) return;
    setSaleActionBusy(true);
    setMsg('');
    try {
      await refundSale(sale.id);
      removeSaleFromList(sale.id);
      setMsg(`Vente n°${saleTxnNumber(sale)} remboursée.`);
    } catch {
      setMsg('Impossible de rembourser cette vente.', { persist: true });
    } finally {
      setSaleActionBusy(false);
    }
  }

  async function openSaleDetail(saleId: number) {
    if (saleDetailLoading) return;
    setSaleDetailLoading(true);
    setSaleModal(null);
    setSaleReceiptCompany(null);
    setSaleReceiptPrinter(null);
    try {
      const detail = await getSaleById(saleId);
      const first = detail.items?.[0]?.product;
      const cid = first?.companyId ?? (companyId !== '' ? Number(companyId) : undefined);
      const deptId = first?.departmentId ?? first?.department?.id ?? undefined;

      let co: CompanyProfile | null = null;
      let pr: DepartmentPrinterSettings | null = null;
      if (typeof cid === 'number') {
        try {
          co = await getCompanyById(cid);
        } catch {
          co = null;
        }
      }
      if (typeof deptId === 'number') {
        try {
          pr = await getPrinterSettings(deptId);
        } catch {
          pr = null;
        }
      }

      setSaleModal(detail);
      setSaleReceiptCompany(co);
      setSaleReceiptPrinter(pr);
    } catch {
      setMsg('Impossible de charger le détail de la vente.', { persist: true });
    } finally {
      setSaleDetailLoading(false);
    }
  }

  async function loadMoreAlerts() {
    if (alertsLoading || companyId === '') return;
    if (alertsSkip + alertsTake >= alertsTotal) return;
    setAlertsLoading(true);
    try {
      const cid = Number(companyId);
      const nextSkip = alertsSkip + alertsTake;
      const a = await getInventoryAlerts({
        threshold: 5,
        companyId: cid,
        skip: nextSkip,
        take: alertsTake,
      });
      setAlerts((prev) => [...prev, ...a.items]);
      setAlertsSkip(nextSkip);
      setAlertsTotal(a.total);
    } catch {
      setMsg("Impossible de charger plus d'alertes.", { persist: true });
    } finally {
      setAlertsLoading(false);
    }
  }

  async function loadMoreZeroAlerts() {
    if (zeroAlertsLoading || companyId === '') return;
    if (zeroAlertsSkip + zeroAlertsTake >= zeroAlertsTotal) return;
    setZeroAlertsLoading(true);
    try {
      const cid = Number(companyId);
      const nextSkip = zeroAlertsSkip + zeroAlertsTake;
      const z = await getZeroStockAlerts({
        companyId: cid,
        skip: nextSkip,
        take: zeroAlertsTake,
      });
      setZeroAlerts((prev) => [...prev, ...z.items]);
      setZeroAlertsSkip(nextSkip);
      setZeroAlertsTotal(z.total);
    } catch {
      setMsg("Impossible de charger plus de ruptures.", { persist: true });
    } finally {
      setZeroAlertsLoading(false);
    }
  }

  const movementProductOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const m of movements) {
      if (m.product?.id != null) {
        map.set(m.product.id, m.product.name ?? `#${m.product.id}`);
      } else if (m.productId != null) {
        map.set(m.productId, m.product?.name ?? `#${m.productId}`);
      }
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }, [movements]);

  const filteredMovements = useMemo(() => {
    if (stockProductId === '') return movements;
    return movements.filter((m) => m.productId === stockProductId || m.product?.id === stockProductId);
  }, [movements, stockProductId]);

  if (!canAccessDashboard) {
    return (
      <div className="page-inner">
        <p className="info-text">Accès au tableau de bord non autorisé pour ce rôle.</p>
      </div>
    );
  }

  const dashboardTabs = allowedTabs;

  return (
    <div className="page-inner">
      <header className="page-header">
        <h1>Tableau de bord</h1>
      </header>

      <div className="config-tabs" style={{ marginBottom: '0.9rem' }}>
        {dashboardTabs.map(([id, label]) => (
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

      <section
        className="grid"
        style={{
          gridTemplateColumns:
            tab === 'synthese'
              ? 'none'
              : tab === 'achats' ||
                  tab === 'stock' ||
                  tab === 'ventes' ||
                  tab === 'banque' ||
                  tab === 'benefices'
                ? 'minmax(240px, 1fr)'
                : 'minmax(240px, 1fr) minmax(240px, 1fr)',
          gap: '0.9rem',
          display: tab === 'synthese' ? 'none' : undefined,
        }}
      >
        <div className="card" style={{ padding: '0.9rem 1.1rem' }}>
          <label style={{ marginBottom: 0 }}>
            Entreprise
            <select
              value={companyId === '' ? '' : String(companyId)}
              onChange={(e) => setCompanyId(e.target.value ? Number(e.target.value) : '')}
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {msg ? <p className="info-text" style={{ marginTop: '0.9rem' }}>{msg}</p> : null}

      {tab === 'synthese' && canSeeSynthesis ? (
        companies.length === 0 ? (
          <p className="info-text" style={{ marginTop: '0.9rem' }}>Chargement…</p>
        ) : (
          <>
            <DashboardSyntheseTab companies={companies} onMessage={setMsg} />
            {companyId !== '' ? (
              <>
                <div className="card" style={{ marginTop: '1rem', padding: '0.9rem 1.1rem' }}>
                  <label style={{ marginBottom: 0 }}>
                    Entreprise (sessions & audit)
                    <select
                      value={String(companyId)}
                      onChange={(e) => setCompanyId(e.target.value ? Number(e.target.value) : '')}
                    >
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <RegisterSessionsPanel
                  companyId={Number(companyId)}
                  onSelect={setRegisterSessionModal}
                />
                <AuditJournalPanel companyId={Number(companyId)} />
              </>
            ) : null}
          </>
        )
      ) : companyId === '' ? (
        <p className="info-text" style={{ marginTop: '0.9rem' }}>Chargement…</p>
      ) : (
        <>
          {tab === 'ventes' && canSeeSales ? (
            <>
              {canSeeSalesTotals ? (
              <section className="card" style={{ marginTop: '1rem' }}>
                <h2>Ventes</h2>
                {salesRecentMinYmd ? (
                  <p className="dept-hint" style={{ marginTop: 0 }}>
                    Totaux limités aux 2 derniers jours (depuis le {salesRecentMinYmd}). L’historique
                    plus ancien n’est pas accessible pour ce rôle.
                  </p>
                ) : null}
                <div
                  className="form-grid inline"
                  style={{
                    marginBottom: '0.85rem',
                    alignItems: 'end',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                  }}
                >
                  <label>
                    Date début
                    <input
                      type="date"
                      value={ventesDateFrom}
                      min={salesRecentMinYmd ?? undefined}
                      max={formatYmd(new Date())}
                      onChange={(e) => {
                        const { from, to } = clampSalesRangeYmd(e.target.value, ventesDateTo);
                        setVentesDateFrom(from);
                        setVentesDateTo(to);
                      }}
                    />
                  </label>
                  <label>
                    Date fin
                    <input
                      type="date"
                      value={ventesDateTo}
                      min={salesRecentMinYmd ?? undefined}
                      max={formatYmd(new Date())}
                      onChange={(e) => {
                        const { from, to } = clampSalesRangeYmd(ventesDateFrom, e.target.value);
                        setVentesDateFrom(from);
                        setVentesDateTo(to);
                      }}
                    />
                  </label>
                  <div style={{ justifySelf: 'start' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={ventesPdfLoading || salesByProductLoading || ventesDateFrom > ventesDateTo}
                      onClick={() => void exportVentesParProduitPdf()}
                    >
                      {ventesPdfLoading ? 'Export PDF…' : 'Exporter PDF'}
                    </button>
                  </div>
                </div>
                {ventesDateFrom > ventesDateTo ? (
                  <p className="info-text">La date de fin doit être au moins égale à la date de début.</p>
                ) : null}
                {salesByProductLoading && salesByProductRows.length === 0 ? (
                  <p className="info-text">Chargement du détail…</p>
                ) : salesByProductRows.length === 0 ? (
                  <p className="info-text">Aucune vente sur cette plage pour cette entreprise.</p>
                ) : (
                  <>
                    <div className="ventes-dept-grid">
                      {salesByDepartmentGroups.map((g) => {
                        const deptTotal = g.rows.reduce((s, r) => s + r.totalSubtotal, 0);
                        const lineCount = g.rows.length;
                        return (
                          <button
                            key={g.key}
                            type="button"
                            className="ventes-dept-card"
                            onClick={() =>
                              setVentesDeptModal({
                                label: g.label,
                                departmentId: g.departmentId,
                                rows: g.rows,
                              })
                            }
                          >
                            <span className="ventes-dept-card-label">{g.label}</span>
                            <span className="ventes-dept-card-meta">
                              {lineCount} article{lineCount > 1 ? 's' : ''}
                            </span>
                            <span className="ventes-dept-card-total">{formatMoney(deptTotal)}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="ventes-dept-grand-total">
                      <span>Total général ({ventesDateFrom} → {ventesDateTo})</span>
                      <strong>{formatMoney(ventesGrandTotal)}</strong>
                    </div>
                  </>
                )}
              </section>
              ) : (
                <p className="info-text" style={{ marginTop: '1rem' }}>
                  Les totaux de ventes ne sont pas autorisés pour ce rôle. Activez « Voir le total des
                  ventes (2 derniers jours max) » ou les rapports complets dans Rôles & autorisations.
                </p>
              )}

              {ventesDeptModal && canSeeSalesTotals ? (
                <VentesDepartmentModal
                  label={ventesDeptModal.label}
                  departmentId={ventesDeptModal.departmentId}
                  rows={ventesDeptModal.rows}
                  dateFrom={ventesDateFrom}
                  dateTo={ventesDateTo}
                  companyId={companyId}
                  onClose={() => setVentesDeptModal(null)}
                  onMessage={setMsg}
                />
              ) : null}

              <section className="card" style={{ marginTop: '1rem' }}>
                <h2>Transactions de vente</h2>
                <div
                  className="form-grid inline"
                  style={{
                    marginBottom: '0.85rem',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                  }}
                >
                  <label>
                    Date début
                    <input
                      type="date"
                      value={txnDateFrom}
                      min={salesRecentMinYmd ?? undefined}
                      max={formatYmd(new Date())}
                      onChange={(e) => {
                        const { from, to } = clampSalesRangeYmd(e.target.value, txnDateTo);
                        setTxnDateFrom(from);
                        setTxnDateTo(to);
                      }}
                    />
                  </label>
                  <label>
                    Date fin
                    <input
                      type="date"
                      value={txnDateTo}
                      min={salesRecentMinYmd ?? undefined}
                      max={formatYmd(new Date())}
                      onChange={(e) => {
                        const { from, to } = clampSalesRangeYmd(txnDateFrom, e.target.value);
                        setTxnDateFrom(from);
                        setTxnDateTo(to);
                      }}
                    />
                  </label>
                </div>

                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Date</th>
                        <th>Client</th>
                        <th>Total</th>
                        <th>Caissier</th>
                        <th>Statut</th>
                        {canCancelOrRefund || canDeleteSale ? <th>Actions</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {salesLoading && sales.length === 0 ? (
                        <tr>
                          <td colSpan={canCancelOrRefund || canDeleteSale ? 7 : 6}>Chargement…</td>
                        </tr>
                      ) : sales.length === 0 ? (
                        <tr>
                          <td colSpan={canCancelOrRefund || canDeleteSale ? 7 : 6}>
                            Aucune vente pour cette entreprise.
                          </td>
                        </tr>
                      ) : (
                        sales.map((s) => (
                          <tr
                            key={s.id}
                            className="dashboard-sale-row"
                            onClick={() => void openSaleDetail(s.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                void openSaleDetail(s.id);
                              }
                            }}
                            role="button"
                            tabIndex={0}
                            style={{ cursor: 'pointer' }}
                          >
                            <td>{saleTxnNumber(s)}</td>
                            <td>{formatDateTime(s.createdAt)}</td>
                            <td>{(s.clientName && s.clientName.trim()) || '—'}</td>
                            <td className="journal-amt">{formatMoney(s.total)}</td>
                            <td>
                              <small>{s.user?.fullName?.trim() || s.cashier || s.user?.phone || '—'}</small>
                            </td>
                            <td>
                              {s.status === 'COMPLETED'
                                ? s.creditCustomerId != null
                                  ? 'Crédit'
                                  : 'Complétée'
                                : s.status === 'CANCELLED'
                                  ? 'Annulée'
                                  : s.status === 'REFUNDED'
                                    ? 'Remboursée'
                                    : s.status}
                            </td>
                            {canCancelOrRefund || canDeleteSale ? (
                              <td
                                onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => e.stopPropagation()}
                              >
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                                  {canCancelOrRefund && s.status === 'COMPLETED' ? (
                                    <button
                                      type="button"
                                      className="btn btn-secondary btn-sm"
                                      disabled={saleActionBusy}
                                      aria-label={`Rembourser la vente n°${saleTxnNumber(s)}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void confirmRefundSale(s);
                                      }}
                                    >
                                      Rembourser
                                    </button>
                                  ) : null}
                                  {canDeleteSale ? (
                                    <button
                                      type="button"
                                      className="btn btn-danger btn-sm"
                                      disabled={saleDeletingId === s.id}
                                      aria-label={`Supprimer définitivement la vente n°${saleTxnNumber(s)}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void confirmDeleteSale(s);
                                      }}
                                    >
                                      {saleDeletingId === s.id ? '…' : 'Supprimer'}
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                            ) : null}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {sales.length > 0 ? (
                  <p className="dept-hint" style={{ marginBottom: 0 }}>
                    Affichage {sales.length} / {salesTotal} vente{salesTotal > 1 ? 's' : ''}.
                  </p>
                ) : null}

                {salesSkip + salesTake < salesTotal ? (
                  <div className="table-actions" style={{ marginTop: '0.75rem' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void loadMoreSales()}
                      disabled={salesLoading}
                    >
                      {salesLoading ? 'Chargement…' : 'Charger plus'}
                    </button>
                  </div>
                ) : null}
              </section>
            </>
          ) : null}

          {tab === 'achats' && showExpensesTab ? (
            <>
              <section
                className={canViewFinance ? 'grid two-col' : 'grid'}
                style={{ marginTop: '1rem' }}
              >
                {canRecordExpense ? (
                  <div className="card">
                    <h2>Nouvelle dépense manuelle</h2>
                    {!canViewFinance ? (
                      <p className="dept-hint">
                        Vous pouvez enregistrer une dépense. Le journal et les totaux finance restent
                        réservés à d’autres rôles.
                      </p>
                    ) : null}
                    <form className="form-grid" onSubmit={(e) => void submitExpense(e)}>
                      <label>
                        Libellé
                        <select
                          value={expenseLabelChoice}
                          onChange={(e) => {
                            setExpenseLabelChoice(e.target.value);
                            if (e.target.value !== EXPENSE_LABEL_OTHER) setExpenseDescOther('');
                          }}
                          required
                        >
                          <option value="">— Choisir —</option>
                          {EXPENSE_LABEL_OPTIONS.map((label) => (
                            <option key={label} value={label}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {expenseLabelChoice === EXPENSE_LABEL_OTHER ? (
                        <label>
                          Préciser
                          <input
                            value={expenseDescOther}
                            onChange={(e) => setExpenseDescOther(e.target.value)}
                            required
                            placeholder="Libellé libre…"
                          />
                        </label>
                      ) : null}
                      <label>
                        Détail
                        <textarea
                          value={expenseDetail}
                          onChange={(e) => setExpenseDetail(e.target.value)}
                          placeholder="Précisions optionnelles…"
                          rows={2}
                          maxLength={1000}
                        />
                      </label>
                      <MoneyField
                        label="Montant"
                        min={0.01}
                        step={0.01}
                        value={expenseAmount}
                        onChange={(e) => setExpenseAmount(e.target.value)}
                        required
                      />
                      <label>
                        Date de la dépense
                        <input
                          type="date"
                          value={expenseEntryDate}
                          onChange={(e) => setExpenseEntryDate(e.target.value)}
                          required
                        />
                      </label>
                      <label>
                        Département (impression)
                        <select
                          value={expenseDeptId === '' ? '' : String(expenseDeptId)}
                          onChange={(e) =>
                            setExpenseDeptId(e.target.value ? Number(e.target.value) : '')
                          }
                          disabled={departments.length === 0}
                        >
                          <option value="">— Choisir —</option>
                          {departments.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={expensePrintOrder}
                          onChange={(e) => setExpensePrintOrder(e.target.checked)}
                        />
                        Imprimer l’ordre de décaissement
                      </label>
                      <button type="submit" className="btn btn-primary">
                        Enregistrer
                      </button>
                    </form>
                  </div>
                ) : null}

                {canViewFinance ? (
                <div className="card">
                  <h2>{canSeePurchases ? 'Totaux (achats & dépenses manuelles)' : 'Totaux (dépenses manuelles)'}</h2>
                  <div
                    className="form-grid inline"
                    style={{
                      marginBottom: '0.85rem',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                    }}
                  >
                    <label>
                      Date début
                      <input
                        type="date"
                        value={achatsTotalsDateFrom}
                        onChange={(e) => setAchatsTotalsDateFrom(e.target.value)}
                      />
                    </label>
                    <label>
                      Date fin
                      <input
                        type="date"
                        value={achatsTotalsDateTo}
                        onChange={(e) => setAchatsTotalsDateTo(e.target.value)}
                      />
                    </label>
                  </div>
                  {achatsTotalsLoading || !achatsTotalsSnapshot ? (
                    <p className="dept-hint" style={{ marginBottom: 0 }}>
                      Chargement des totaux…
                    </p>
                  ) : achatsTotalsDateFrom > achatsTotalsDateTo ? (
                    <p className="dept-hint" style={{ marginBottom: 0 }}>
                      La date de début doit précéder la date de fin.
                    </p>
                  ) : (
                    <section className="grid kpis" style={{ marginBottom: 0 }}>
                      {canSeePurchases ? (
                        <div className="card kpi">
                          <div className="kpi-label">Achats reçus</div>
                          <div className="kpi-value">{formatMoney(achatsTotalsSnapshot.purchases)}</div>
                        </div>
                      ) : null}
                      <div className="card kpi">
                        <div className="kpi-label">Dépenses manuelles</div>
                        <div className="kpi-value">{formatMoney(achatsTotalsSnapshot.manualExpenses)}</div>
                      </div>
                    </section>
                  )}
                </div>
                ) : null}
              </section>

              {canViewFinance ? (
              <section className="card" style={{ marginTop: '1rem' }}>
                <h2>{canSeePurchases ? 'Journal (achats, ventes caisse, dépenses)' : 'Journal (ventes caisse, dépenses)'}</h2>
                <div
                  className="form-grid inline"
                  style={{
                    marginBottom: '0.85rem',
                    alignItems: 'end',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                  }}
                >
                  <label>
                    Nature
                    <select
                      value={ledgerNature}
                      onChange={(e) =>
                        setLedgerNature(e.target.value as 'all' | 'purchase' | 'sale' | 'expense')
                      }
                    >
                      <option value="all">Toutes</option>
                      {canSeePurchases ? <option value="purchase">Achats</option> : null}
                      <option value="sale">Ventes (caisse)</option>
                      <option value="expense">Dépenses</option>
                    </select>
                  </label>
                  <label>
                    Date début
                    <input
                      type="date"
                      value={ledgerDateFrom}
                      onChange={(e) => setLedgerDateFrom(e.target.value)}
                    />
                  </label>
                  <label>
                    Date fin
                    <input
                      type="date"
                      value={ledgerDateTo}
                      onChange={(e) => setLedgerDateTo(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={ledgerPdfLoading || !ledgerDateFrom || !ledgerDateTo}
                    onClick={() => {
                      setLedgerPdfLoading(true);
                      void exportFinanceLedgerPdf({
                        companyId: Number(companyId),
                        dateFrom: ledgerDateFrom,
                        dateTo: ledgerDateTo,
                        nature: effectiveLedgerNature === 'all' && !canSeePurchases ? 'expense' : effectiveLedgerNature,
                      })
                        .then((blob) => {
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `journal_finance_${ledgerDateFrom}_${ledgerDateTo}.pdf`;
                          a.click();
                          URL.revokeObjectURL(url);
                          setMsg('Journal exporté en PDF.');
                        })
                        .catch(() => setMsg('Export PDF du journal impossible.', { persist: true }))
                        .finally(() => setLedgerPdfLoading(false));
                    }}
                  >
                    {ledgerPdfLoading ? '…' : 'Exporter PDF'}
                  </button>
                </div>
                <p className="dept-hint" style={{ marginTop: 0 }}>
                  {ledgerTotal === 0
                    ? 'Aucune ligne sur cette plage.'
                    : `Affichage ${ledgerItems.length} / ${ledgerTotal} ligne${ledgerTotal > 1 ? 's' : ''}.`}
                </p>
                <ul className="journal-list journal-list--actions">
                  {ledgerLoading && ledgerItems.length === 0 ? (
                    <li className="journal-row journal-row--actions">
                      <span>Chargement…</span>
                      <span />
                      <span />
                      <span />
                    </li>
                  ) : ledgerItems.length === 0 ? (
                    <li className="journal-row journal-row--actions">
                      <span>Aucune entrée</span>
                      <span />
                      <span />
                      <span />
                    </li>
                  ) : (
                    ledgerItems.map((row) => (
                      <li key={row.id} className="journal-row journal-row--actions">
                        <span className={`journal-type ${row.kind.toLowerCase()}`}>
                          {row.kind === 'PURCHASE'
                            ? 'Achat'
                            : row.kind === 'SALE'
                              ? 'Vente'
                              : 'Dépense'}
                        </span>
                        <span>
                          <span>{row.description}</span>
                          {row.detail?.trim() ? (
                            <span className="dept-hint" style={{ display: 'block', marginTop: '0.15rem' }}>
                              {row.detail.trim()}
                            </span>
                          ) : null}
                          <span className="dept-hint" style={{ display: 'block', marginTop: '0.2rem' }}>
                            {formatDateTime(row.occurredAt)} ·{' '}
                            {row.user?.fullName?.trim() || row.user?.phone || '—'}
                          </span>
                        </span>
                        <span className="journal-amt">{formatMoney(row.amount)}</span>
                        {isAdmin ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm journal-delete-btn"
                            disabled={ledgerDeletingId === row.id}
                            onClick={() => void confirmDeleteLedgerRow(row)}
                          >
                            {ledgerDeletingId === row.id ? '…' : 'Supprimer'}
                          </button>
                        ) : (
                          <span />
                        )}
                      </li>
                    ))
                  )}
                </ul>
                {ledgerItems.length > 0 && ledgerSkip + ledgerTake < ledgerTotal ? (
                  <div className="table-actions" style={{ marginTop: '0.75rem' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void loadMoreLedger()}
                      disabled={ledgerLoading}
                    >
                      {ledgerLoading ? 'Chargement…' : 'Charger plus'}
                    </button>
                  </div>
                ) : null}
              </section>
              ) : null}
            </>
          ) : null}

          {tab === 'stock' && canSeeGlobalStock ? (
            <>
              <StockLowAlertsPanel
                alerts={alerts}
                total={alertsTotal}
                loading={alertsLoading}
                canLoadMore={alertsSkip + alertsTake < alertsTotal}
                onLoadMore={() => void loadMoreAlerts()}
              />

              <StockZeroAlertsPanel
                alerts={zeroAlerts}
                total={zeroAlertsTotal}
                loading={zeroAlertsLoading}
                canLoadMore={zeroAlertsSkip + zeroAlertsTake < zeroAlertsTotal}
                onLoadMore={() => void loadMoreZeroAlerts()}
              />

              <InventoryPhysicalSection
                companies={companies}
                visible={tab === 'stock'}
                historyPortalTarget={inventoryHistorySlot}
                onStockChanged={() => {
                  void loadGlobalSnapshot();
                  void refetchMovementsFromStart({
                    order: movementDateOrder,
                    take: movementsPageSize,
                  });
                  const cid = Number(companyId);
                  void getInventoryAlerts({
                    threshold: 5,
                    companyId: cid,
                    skip: 0,
                    take: alertsTake,
                  }).then((a) => {
                    setAlerts(a.items);
                    setAlertsTotal(a.total);
                    setAlertsSkip(0);
                  });
                  void getZeroStockAlerts({
                    companyId: cid,
                    skip: 0,
                    take: zeroAlertsTake,
                  }).then((z) => {
                    setZeroAlerts(z.items);
                    setZeroAlertsTotal(z.total);
                    setZeroAlertsSkip(0);
                  });
                }}
              />

              <section className="card" style={{ marginTop: '1rem' }}>
                <h2>Inventaire global</h2>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '0.75rem' }}>
                  <div>
                    <strong>Entreprises</strong>
                    <ul style={{ listStyle: 'none', padding: 0, margin: '0.35rem 0 0' }}>
                      {companies.map((c) => (
                        <li key={c.id}>
                          <label className="checkbox-row">
                            <input
                              type="checkbox"
                              checked={globalCompanyIds.includes(c.id)}
                              onChange={() => toggleGlobalCompany(c.id)}
                            />
                            {c.name}
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <strong>Départements</strong>
                    <ul style={{ listStyle: 'none', padding: 0, margin: '0.35rem 0 0' }}>
                      {departments.map((d) => (
                        <li key={d.id}>
                          <label className="checkbox-row">
                            <input
                              type="checkbox"
                              checked={globalDeptIds.includes(d.id)}
                              onChange={() => toggleGlobalDept(d.id)}
                            />
                            {d.name}
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <label>
                    Stock au
                    <input
                      type="date"
                      value={globalAsOf}
                      max={formatYmd(new Date())}
                      onChange={(e) => setGlobalAsOf(e.target.value)}
                    />
                  </label>
                  {globalAsOf || globalAsOfApplied ? (
                    <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setGlobalAsOf('');
                          setGlobalAsOfApplied(null);
                          setGlobalItems([]);
                        }}
                      >
                        Stock actuel
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="table-actions" style={{ marginBottom: '0.75rem' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={globalLoading}
                    onClick={() => void loadGlobalSnapshot()}
                  >
                    {globalLoading ? '…' : 'Charger'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={globalExporting}
                    onClick={() => void onExportGlobalPdf()}
                  >
                    {globalExporting ? '…' : 'Export PDF'}
                  </button>
                </div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Entreprise</th>
                        <th>Département</th>
                        <th>Produit</th>
                        <th>Stock</th>
                        <th>Min</th>
                        <th>Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {globalItems.length === 0 ? (
                        <tr>
                          <td colSpan={6}>—</td>
                        </tr>
                      ) : (
                        globalItems.map((item) => (
                          <tr key={item.id}>
                            <td>{item.company?.name ?? '—'}</td>
                            <td>{item.department?.name ?? '—'}</td>
                            <td>{item.name}</td>
                            <td className="journal-amt">{formatQuantity(item.stock)}</td>
                            <td className="journal-amt">{formatQuantity(item.stockMin)}</td>
                            <td>{item.lowStock ? 'Bas' : 'OK'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <StockMovementsPanel
                movements={movements}
                filteredMovements={filteredMovements}
                movementsTotal={movementsTotal}
                movementsSkip={movementsSkip}
                movementsPageSize={movementsPageSize}
                movementDateOrder={movementDateOrder}
                dateFrom={movementsDateFrom}
                dateTo={movementsDateTo}
                productOptions={movementProductOptions}
                selectedProductId={stockProductId}
                loading={movementsLoading}
                onProductChange={setStockProductId}
                onDateFromChange={setMovementsDateFrom}
                onDateToChange={setMovementsDateTo}
                onApplyDateFilter={() =>
                  void refetchMovementsFromStart({
                    order: movementDateOrder,
                    take: movementsPageSize,
                  })
                }
                onOrderChange={(order) => {
                  setMovementDateOrder(order);
                  void refetchMovementsFromStart({ order, take: movementsPageSize });
                }}
                onPageSizeChange={(size) => {
                  setMovementsPageSize(size);
                  void refetchMovementsFromStart({ order: movementDateOrder, take: size });
                }}
                onReset={() => void resetMovementsToInitial()}
                onLoadMore={() => void loadMoreMovements()}
              />

              <div
                ref={setInventoryHistorySlot}
                style={{ marginTop: '0.25rem' }}
                aria-label="Historique des comptages"
              />
            </>
          ) : null}
        </>
      )}

      {tab === 'banque' && canSeeBanks ? (
        typeof companyId === 'number' ? (
          <DashboardBanksTab companyId={companyId} />
        ) : (
          <p className="info-text" style={{ marginTop: '0.9rem' }}>
            Choisissez une entreprise pour voir les comptes bancaires.
          </p>
        )
      ) : null}

      {tab === 'benefices' && canSeeBenefices ? (
        typeof companyId === 'number' ? (
          <DashboardBeneficesTab companyId={companyId} />
        ) : (
          <p className="info-text" style={{ marginTop: '0.9rem' }}>
            Choisissez une entreprise pour analyser les bénéfices.
          </p>
        )
      ) : null}

      <RegisterSessionModal
        session={registerSessionModal}
        onClose={() => setRegisterSessionModal(null)}
      />

      <SaleDetailModal
        sale={saleModal}
        companyName={selectedCompanyName}
        company={saleReceiptCompany}
        printer={saleReceiptPrinter}
        canCancelOrRefund={canCancelOrRefund}
        actionBusy={saleActionBusy}
        onCancelSale={canCancelOrRefund ? confirmCancelSale : undefined}
        onRefundSale={canCancelOrRefund ? confirmRefundSale : undefined}
        onClose={() => {
          setSaleModal(null);
          setSaleReceiptCompany(null);
          setSaleReceiptPrinter(null);
        }}
      />
    </div>
  );
}
