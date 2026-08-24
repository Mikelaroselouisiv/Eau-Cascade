import { useEffect, useMemo, useState } from 'react';
import {
  closeRegisterSession,
  collectSaleBalance,
  createSale,
  ensureDefaultRegister,
  getActiveRegisterSession,
  getCompany,
  getCompanyById,
  getCompanies,
  getDepartments,
  getInventoryCountSheet,
  getPrinterSettings,
  getRegisterClosingCashPreview,
  listBanks,
  listRegisters,
  listSaleCashGaps,
  openRegisterSession,
  settleSaleChange,
} from '../services/api';
import { isLikelyNetworkError } from '../services/api-errors';
import { enqueueSale, syncSalesQueue } from '../services/offline-queue';
import { loadProductsWithCache } from '../services/product-cache';
import type {
  CompanyListItem,
  CompanyProfile,
  Department,
  DepartmentPrinterSettings,
  InventoryCountSheetRow,
  Product,
  ProductSaleUnit,
  BankRow,
  RegisterListItem,
  RegisterSessionDetail,
  SaleCashGapRow,
} from '../types/api';
import { RegisterStockCountForm } from '../components/RegisterStockCountForm';
import { formatRegisterCode } from '../utils/registerDisplay';
import { MoneyField } from '../components/MoneyField';
import { useAuth } from '../context/AuthContext';
import { useAutoClearMessage } from '../hooks/useAutoClearMessage';
import { resolveFamilyUnitPrice, resolveVolumeUnitPrice } from '../utils/volumeUnitPrice';
import { formatMoney, resolveCurrencyCode } from '../utils/currency';
import { formatQuantity } from '../utils/formatQuantity';

/** Quantité décimale dans l’unité choisie (caisse, bouteille…) ; le stock est dans la même unité. */
const QTY_DECIMALS = 4;
const MIN_SALE_QTY = 0.0001;
const DEFAULT_PRODUCT_TILE_COLOR = '#f8fafc';

function textColorForBackground(hex: string): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return '#0f172a';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? '#0f172a' : '#ffffff';
}

type CartLine = {
  productSaleUnitId: number;
  productId: number;
  label: string;
  quantity: number;
  /** Facteur stock (1 = 1 unité vendue = 1 unité de stock) */
  unitsPerPackage: number;
  /** Prix unitaire saisi (vente spéciale) — null = non renseigné */
  manualUnitPrice?: number | null;
};

function defaultSaleUnit(p: Product): ProductSaleUnit | undefined {
  const units = p.saleUnits ?? [];
  return units.find((u) => u.isDefault) ?? units[0];
}

function roundQty(q: number): number {
  return Math.round(q * 10 ** QTY_DECIMALS) / 10 ** QTY_DECIMALS;
}

/** Quantité max vendable dans l’unité choisie (décimal), ou undefined si pas de limite stock (service). */
function maxQtyInSaleUnit(p: Product, unitsPerPackage: number): number | undefined {
  if (!p.trackStock || p.isService) return undefined;
  const base = Number(p.stock);
  const up = Number(unitsPerPackage);
  if (!Number.isFinite(base) || !Number.isFinite(up) || up <= 0) return 0;
  return roundQty(base / up);
}

function clampQty(q: number, maxQ: number | undefined): number {
  let x = Math.max(MIN_SALE_QTY, q);
  if (maxQ !== undefined && Number.isFinite(maxQ)) {
    x = Math.min(x, Math.max(MIN_SALE_QTY, maxQ));
  }
  return roundQty(x);
}

function familyQtyByProduct(
  cart: CartLine[],
  productsById: Map<number, Product>,
): Map<number, number> {
  const qty = new Map<number, number>();
  for (const line of cart) {
    const p = productsById.get(line.productId);
    const fid = p?.productFamilyId ?? p?.productFamily?.id;
    if (fid == null) continue;
    qty.set(fid, (qty.get(fid) ?? 0) + Number(line.quantity));
  }
  return qty;
}

function effectiveUnitPrice(
  product: Product | undefined,
  line: CartLine,
  familyQty?: Map<number, number>,
): number {
  if (!product) return 0;
  const su = product.saleUnits?.find((s) => s.id === line.productSaleUnitId);
  if (!su) return 0;
  const fid = product.productFamilyId ?? product.productFamily?.id;
  if (fid != null && familyQty) {
    const familyTiers = (product.productFamily?.tiers ?? []).map((t) => ({
      minQuantity: Number(t.minQuantity),
      unitPrice: Number(t.unitPrice),
    }));
    const familyPrice = resolveFamilyUnitPrice(familyTiers, familyQty.get(fid) ?? 0);
    if (familyPrice != null) return familyPrice;
  }
  const tiers = (su.volumePrices ?? []).map((v) => ({
    minQuantity: Number(v.minQuantity),
    unitPrice: Number(v.unitPrice),
  }));
  return resolveVolumeUnitPrice(Number(su.salePrice), tiers, line.quantity);
}

export function PosPage() {
  const { user, canPerm } = useAuth();
  const cashierLabel = user?.fullName?.trim() || user?.phone || 'Caissier';
  const isCashier = user?.role === 'CASHIER';
  const canSpecialSale = canPerm('sales.special_price');
  const [saleMode, setSaleMode] = useState<'classic' | 'special'>('classic');
  const [products, setProducts] = useState<Product[]>([]);
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [printer, setPrinter] = useState<DepartmentPrinterSettings | null>(null);
  const [companies, setCompanies] = useState<CompanyListItem[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | ''>('');
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<number | ''>('');
  type PaymentMethod = 'CASH' | 'CARD' | 'MOBILE_MONEY' | 'SPLIT' | 'BANK';
  type SaleDraft = {
    id: string;
    cart: CartLine[];
    paymentMethod: PaymentMethod;
    name: string;
    bankId: number | '';
    bankAccountId: number | '';
  };

  const emptyDraft = (id: string): SaleDraft => ({
    id,
    cart: [],
    paymentMethod: 'CASH',
    name: 'Client',
    bankId: '',
    bankAccountId: '',
  });

  const [drafts, setDrafts] = useState<SaleDraft[]>(() => [emptyDraft('d1')]);
  const [activeDraftId, setActiveDraftId] = useState<string>('d1');
  const [status, setStatus] = useAutoClearMessage();
  const [printTicket, setPrintTicket] = useState(false);
  const [amountReceived, setAmountReceived] = useState('');
  const [banks, setBanks] = useState<BankRow[]>([]);
  const [cashGaps, setCashGaps] = useState<{
    changeOwed: SaleCashGapRow[];
    balanceOwed: SaleCashGapRow[];
  }>({ changeOwed: [], balanceOwed: [] });
  const [cashGapBusyId, setCashGapBusyId] = useState<number | null>(null);
  const [cashGapQuery, setCashGapQuery] = useState('');

  const [registerSession, setRegisterSession] = useState<RegisterSessionDetail | null>(null);
  const [registers, setRegisters] = useState<RegisterListItem[]>([]);
  const [selectedRegisterId, setSelectedRegisterId] = useState<number | ''>('');
  const [countProducts, setCountProducts] = useState<InventoryCountSheetRow[]>([]);
  const [registerBusy, setRegisterBusy] = useState(false);
  const [registerError, setRegisterError] = useState('');
  const [registerPanel, setRegisterPanel] = useState<'open' | 'close' | null>(null);
  const [showClosedCaisseAlert, setShowClosedCaisseAlert] = useState(false);
  const [openingCash, setOpeningCash] = useState('');
  const [closingCashExpected, setClosingCashExpected] = useState('');
  const [closingCashCounted, setClosingCashCounted] = useState('');
  const [closingCashPreview, setClosingCashPreview] = useState<{
    openingCash: number;
    salesTotal?: number;
    salesCash: number;
    expenses: number;
    unsettledChange: number;
    expected: number;
  } | null>(null);

  const salesEnabled = registerSession != null;

  const currencyCode = resolveCurrencyCode(company?.currency);

  useEffect(() => {
    if (!canSpecialSale && saleMode === 'special') {
      setSaleMode('classic');
    }
  }, [canSpecialSale, saleMode]);

  const effectiveDepartmentId = useMemo(() => {
    if (isCashier) {
      return typeof user?.departmentId === 'number' ? user.departmentId : undefined;
    }
    return selectedDepartmentId === '' ? undefined : selectedDepartmentId;
  }, [isCashier, user?.departmentId, selectedDepartmentId]);

  const effectiveCompanyId = useMemo(() => {
    if (isCashier) {
      return typeof user?.companyId === 'number' ? user.companyId : company?.id;
    }
    return selectedCompanyId === '' ? undefined : selectedCompanyId;
  }, [isCashier, user?.companyId, company?.id, selectedCompanyId]);

  async function loadRegisterContext(deptId?: number, compId?: number) {
    const session = await getActiveRegisterSession();
    setRegisterSession(session);
    let resolvedCompanyId = compId;
    if (deptId != null) {
      const sheet = await getInventoryCountSheet(deptId);
      setCountProducts(sheet.products);
      resolvedCompanyId = resolvedCompanyId ?? sheet.department.company.id;
    } else {
      setCountProducts([]);
    }
    if (resolvedCompanyId != null) {
      let regs = await listRegisters({
        companyId: resolvedCompanyId,
        departmentId: deptId,
      });
      if (regs.length === 0) {
        regs = [await ensureDefaultRegister(resolvedCompanyId)];
      }
      setRegisters(regs);
      setSelectedRegisterId((prev) => {
        if (typeof prev === 'number' && regs.some((r) => r.id === prev)) return prev;
        return regs[0]?.id ?? '';
      });
    }
  }

  useEffect(() => {
    if (!user) return;
    const deptId = effectiveDepartmentId;
    const compId = effectiveCompanyId;
    void loadRegisterContext(deptId, compId).catch(() => undefined);
  }, [user?.id, effectiveDepartmentId, effectiveCompanyId]);

  useEffect(() => {
    if (!user) return;

    const deptId = typeof user.departmentId === 'number' ? user.departmentId : undefined;
    const userCompanyId = typeof user.companyId === 'number' ? user.companyId : undefined;

    if (isCashier) {
      void (async () => {
        try {
          const [prods, pr] = await Promise.all([
            loadProductsWithCache(deptId),
            getPrinterSettings(deptId).catch(() => null),
          ]);
          setProducts(prods);
          setPrinter(pr);

          if (userCompanyId != null) {
            try {
              setCompany(await getCompanyById(userCompanyId));
            } catch {
              setCompany(null);
            }
          } else {
            try {
              setCompany(await getCompany());
            } catch {
              setCompany(null);
            }
          }
        } catch {
          setStatus('Erreur chargement caisse', { persist: true });
        }
      })();
      return;
    }

    void (async () => {
      try {
        const [allProds, companyList] = await Promise.all([loadProductsWithCache(undefined), getCompanies()]);
        setProducts(allProds);
        setCompanies(companyList);

        const nextCompanyId: number | '' = userCompanyId ?? companyList[0]?.id ?? '';
        setSelectedCompanyId(nextCompanyId);

        const nextCompanyIdNumber = typeof nextCompanyId === 'number' ? nextCompanyId : undefined;
        const nextDepartments = await getDepartments(nextCompanyIdNumber);
        setDepartments(nextDepartments);

        const nextDeptId: number | '' =
          typeof user.departmentId === 'number'
            ? user.departmentId
            : nextDepartments[0]?.id ?? '';
        setSelectedDepartmentId(nextDeptId);

        const nextDeptIdNumber = typeof nextDeptId === 'number' ? nextDeptId : undefined;
        if (nextCompanyIdNumber !== undefined) {
          const co = await getCompanyById(nextCompanyIdNumber);
          setCompany(co);
        }
        if (nextDeptIdNumber !== undefined) {
          const pr = await getPrinterSettings(nextDeptIdNumber);
          setPrinter(pr);
        }
      } catch {
        setStatus('Erreur chargement caisse', { persist: true });
      }
    })();
  }, [user?.id, user?.role, user?.departmentId, user?.companyId]);

  // Pour les managers/admin : recharger les listes de départements si l'entreprise change.
  useEffect(() => {
    if (!user || isCashier) return;
    if (selectedCompanyId === '') return;

    void getDepartments(Number(selectedCompanyId))
      .then((depts) => {
        setDepartments(depts);
        setSelectedDepartmentId((prev) => {
          if (typeof prev === 'number' && depts.some((d) => d.id === prev)) return prev;
          return depts[0]?.id ?? '';
        });
      })
      .catch(() => undefined);
  }, [user, isCashier, selectedCompanyId]);

  // Pour les managers/admin : recharger les réglages d'entreprise et d'imprimante si besoin.
  useEffect(() => {
    if (!user || isCashier) return;
    if (selectedCompanyId === '') {
      setCompany(null);
      return;
    }

    void getCompanyById(Number(selectedCompanyId))
      .then(setCompany)
      .catch(() => undefined);
  }, [user, isCashier, selectedCompanyId]);

  useEffect(() => {
    if (!user || isCashier) return;
    if (selectedDepartmentId === '') {
      setPrinter(null);
      return;
    }

    void getPrinterSettings(Number(selectedDepartmentId))
      .then(setPrinter)
      .catch(() => undefined);
  }, [user, isCashier, selectedDepartmentId]);

  const displayedProducts = useMemo(() => {
    if (isCashier) return products;
    if (selectedCompanyId === '' && selectedDepartmentId === '') return products;

    return products.filter((p) => {
      const companyId = p.companyId ?? p.company?.id;
      const deptId = p.department?.id;
      if (selectedCompanyId !== '' && companyId !== selectedCompanyId) return false;
      if (selectedDepartmentId !== '' && deptId !== selectedDepartmentId) return false;
      return true;
    });
  }, [products, isCashier, selectedCompanyId, selectedDepartmentId]);

  useEffect(() => {
    void syncSalesQueue()
      .then((r) => {
        if (r.synced > 0) {
          setStatus(`Synchronisé : ${r.synced} vente(s) hors ligne`);
          window.dispatchEvent(new Event('pos-pending-sales-changed'));
        }
      })
      .catch(() => undefined);
  }, []);

  const activeDraft = useMemo(
    () => drafts.find((d) => d.id === activeDraftId) ?? drafts[0],
    [drafts, activeDraftId],
  );
  const activeCart = activeDraft?.cart ?? [];

  const productsById = useMemo(() => {
    const m = new Map<number, Product>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  const familyQtyMap = useMemo(
    () => familyQtyByProduct(activeCart, productsById),
    [activeCart, productsById],
  );

  const cartTotal = useMemo(
    () =>
      activeCart.reduce((sum, l) => {
        if (saleMode === 'special') {
          const price = l.manualUnitPrice;
          if (price == null || !Number.isFinite(price)) return sum;
          return sum + price * l.quantity;
        }
        const p = productsById.get(l.productId);
        return sum + effectiveUnitPrice(p, l, familyQtyMap) * l.quantity;
      }, 0),
    [activeCart, productsById, familyQtyMap, saleMode],
  );

  const specialPricesReady = useMemo(() => {
    if (saleMode !== 'special') return true;
    return activeCart.every(
      (l) => l.manualUnitPrice != null && Number.isFinite(l.manualUnitPrice) && l.manualUnitPrice >= 0,
    );
  }, [activeCart, saleMode]);

  const showTenderField =
    activeDraft?.paymentMethod === 'CASH' || activeDraft?.paymentMethod === 'SPLIT';

  const tenderPreview = useMemo(() => {
    if (!showTenderField) return null;
    const raw = amountReceived.trim().replace(',', '.');
    if (raw === '') return null;
    const received = Number(raw);
    if (!Number.isFinite(received) || received < 0) return null;
    const changeDue = Math.max(0, Math.round((received - cartTotal) * 100) / 100);
    const balanceDue = Math.max(0, Math.round((cartTotal - received) * 100) / 100);
    return { received, changeDue, balanceDue };
  }, [amountReceived, cartTotal, showTenderField]);

  const filteredCashGaps = useMemo(() => {
    const q = cashGapQuery.trim().toLowerCase().replace(/^#/, '');
    if (!q) return cashGaps;
    const match = (row: SaleCashGapRow) => {
      const txn = String(row.txnNumber ?? row.id);
      const name = (row.clientName ?? '').trim().toLowerCase();
      const cashier = (row.cashier ?? '').trim().toLowerCase();
      const amounts = [
        row.changeDue,
        row.balanceDue,
        row.total,
        row.amountReceived,
        row.amountPaid,
      ]
        .map((n) => String(n))
        .join(' ');
      return (
        txn.includes(q) ||
        name.includes(q) ||
        cashier.includes(q) ||
        amounts.includes(q.replace(',', '.'))
      );
    };
    return {
      changeOwed: cashGaps.changeOwed.filter(match),
      balanceOwed: cashGaps.balanceOwed.filter(match),
    };
  }, [cashGaps, cashGapQuery]);

  async function refreshCashGaps() {
    const cid = effectiveCompanyId;
    if (cid == null) {
      setCashGaps({ changeOwed: [], balanceOwed: [] });
      return;
    }
    try {
      const gaps = await listSaleCashGaps({
        companyId: cid,
        departmentId: effectiveDepartmentId,
        take: 40,
      });
      setCashGaps(gaps);
    } catch {
      setCashGaps({ changeOwed: [], balanceOwed: [] });
      // Visible sur Remote : avant, une erreur API (cloud) laissait « Aucune » sans explication.
      setStatus('Impossible de charger monnaie / restes à encaisser', { persist: true });
    }
  }

  useEffect(() => {
    void refreshCashGaps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveCompanyId, effectiveDepartmentId, salesEnabled]);

  useEffect(() => {
    const cid = effectiveCompanyId;
    if (cid == null) {
      setBanks([]);
      return;
    }
    void listBanks({ companyId: cid })
      .then((rows) => setBanks(rows.filter((b) => b.isActive)))
      .catch(() => setBanks([]));
  }, [effectiveCompanyId]);

  const activeBankAccounts = useMemo(() => {
    if (!activeDraft || activeDraft.bankId === '') return [];
    const bank = banks.find((b) => b.id === activeDraft.bankId);
    return (bank?.accounts ?? []).filter((a) => a.isActive);
  }, [activeDraft, banks]);

  function switchSaleMode(mode: 'classic' | 'special') {
    if (mode === saleMode) return;
    if (mode === 'special' && !canSpecialSale) return;
    setSaleMode(mode);
    setDrafts([emptyDraft('d1')]);
    setActiveDraftId('d1');
    setAmountReceived('');
  }

  function updateActiveDraft(next: (d: SaleDraft) => SaleDraft) {
    setDrafts((prev) => prev.map((d) => (d.id === activeDraftId ? next(d) : d)));
  }

  function removeActiveDraftFromUI() {
    // On veut que la fiche encaissée disparaisse de l'interface.
    // Si c'est la dernière fiche, on la réinitialise pour continuer à encaisser.
    if (drafts.length <= 1) {
      setDrafts((prev) =>
        prev.map((d) =>
          d.id === activeDraftId
            ? { ...d, cart: [], name: 'Client', bankId: '', bankAccountId: '' }
            : d,
        ),
      );
      return;
    }

    const remaining = drafts.filter((d) => d.id !== activeDraftId);
    if (remaining.length === 0) return;
    setDrafts(remaining);
    setActiveDraftId(remaining[0].id);
  }

  function createDraft() {
    const nextId = `d${Date.now()}`;
    setDrafts((prev) => [...prev, emptyDraft(nextId)]);
    setActiveDraftId(nextId);
  }

  function setActivePaymentMethod(m: PaymentMethod) {
    updateActiveDraft((d) => ({
      ...d,
      paymentMethod: m,
      ...(m !== 'BANK' ? { bankId: '' as const, bankAccountId: '' as const } : {}),
    }));
    if (m !== 'CASH' && m !== 'SPLIT') setAmountReceived('');
  }

  function setActiveDraftName(name: string) {
    updateActiveDraft((d) => ({ ...d, name }));
  }

  function deleteDraft(id: string) {
    setDrafts((prev) => {
      if (prev.length <= 1) return prev;
      const remaining = prev.filter((d) => d.id !== id);
      if (remaining.length === 0) return prev;
      if (activeDraftId === id) setActiveDraftId(remaining[0].id);
      return remaining;
    });
  }

  function formatQty(q: number) {
    return formatQuantity(q);
  }

  function refuseClosedCaisse() {
    setShowClosedCaisseAlert(true);
  }

  function addLine(p: Product) {
    if (!salesEnabled) {
      refuseClosedCaisse();
      return;
    }
    const su = defaultSaleUnit(p);
    if (!su) {
      setStatus('Produit sans unité de vente — configurez-le dans Stock.', { persist: true });
      return;
    }
    const up = Number(su.unitsPerPackage);
    const maxQ = maxQtyInSaleUnit(p, up);
    if (maxQ !== undefined && maxQ < MIN_SALE_QTY) {
      setStatus('Stock insuffisant pour ce produit.', { persist: true });
      return;
    }
    const firstQty =
      maxQ === undefined ? 1 : roundQty(Math.min(1, Math.max(MIN_SALE_QTY, maxQ)));
    updateActiveDraft((d) => {
      const prev = d.cart;
      const i = prev.findIndex((l) => l.productSaleUnitId === su.id);
      if (i >= 0) {
        const next = [...prev];
        const merged = roundQty(next[i].quantity + 1);
        next[i] = {
          ...next[i],
          quantity: clampQty(merged, maxQtyInSaleUnit(p, next[i].unitsPerPackage)),
        };
        return { ...d, cart: next };
      }
      const label = su.labelOverride
        ? `${p.name} (${su.labelOverride})`
        : `${p.name} (${su.packagingUnit.label})`;
      return {
        ...d,
        cart: [
          ...prev,
          {
            productSaleUnitId: su.id,
            productId: p.id,
            label,
            quantity: firstQty,
            unitsPerPackage: up,
            ...(saleMode === 'special' ? { manualUnitPrice: null } : {}),
          },
        ],
      };
    });
  }

  function bumpQty(productSaleUnitId: number, delta: number) {
    updateActiveDraft((d) => ({
      ...d,
      cart: d.cart
        .map((l) => {
          if (l.productSaleUnitId !== productSaleUnitId) return l;
          const p = products.find((x) => x.id === l.productId);
          const maxQ = p ? maxQtyInSaleUnit(p, l.unitsPerPackage) : undefined;
          const q = clampQty(l.quantity + delta, maxQ);
          return { ...l, quantity: q };
        })
        .filter((l) => l.quantity >= MIN_SALE_QTY),
    }));
  }

  function setLineQty(productSaleUnitId: number, raw: string) {
    const trimmed = raw.trim().replace(',', '.');
    if (trimmed === '') return;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return;
    if (parsed < MIN_SALE_QTY) {
      updateActiveDraft((d) => ({
        ...d,
        cart: d.cart.filter((l) => l.productSaleUnitId !== productSaleUnitId),
      }));
      return;
    }
    updateActiveDraft((d) => ({
      ...d,
      cart: d.cart
        .map((l) => {
          if (l.productSaleUnitId !== productSaleUnitId) return l;
          const p = products.find((x) => x.id === l.productId);
          const maxQ = p ? maxQtyInSaleUnit(p, l.unitsPerPackage) : undefined;
          const q = clampQty(parsed, maxQ);
          return { ...l, quantity: q };
        })
        .filter((l) => l.quantity >= MIN_SALE_QTY),
    }));
  }

  function setLineManualPrice(productSaleUnitId: number, raw: string) {
    const trimmed = raw.trim().replace(',', '.');
    if (trimmed === '') {
      updateActiveDraft((d) => ({
        ...d,
        cart: d.cart.map((l) =>
          l.productSaleUnitId === productSaleUnitId ? { ...l, manualUnitPrice: null } : l,
        ),
      }));
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    updateActiveDraft((d) => ({
      ...d,
      cart: d.cart.map((l) =>
        l.productSaleUnitId === productSaleUnitId ? { ...l, manualUnitPrice: parsed } : l,
      ),
    }));
  }

  async function checkout() {
    if (activeCart.length === 0) return;
    if (saleMode === 'special' && !canSpecialSale) {
      setStatus('Vente spéciale réservée aux managers et administrateurs', { persist: true });
      return;
    }
    if (saleMode === 'special' && !specialPricesReady) {
      setStatus('Renseignez le prix de chaque ligne', { persist: true });
      return;
    }
    if (!registerSession) {
      refuseClosedCaisse();
      return;
    }

    let tendered: number | undefined;
    if (showTenderField) {
      const raw = amountReceived.trim().replace(',', '.');
      if (raw === '') {
        setStatus('Indiquez le montant reçu', { persist: true });
        return;
      }
      tendered = Number(raw);
      if (!Number.isFinite(tendered) || tendered < 0) {
        setStatus('Montant reçu invalide', { persist: true });
        return;
      }
    }

    const total = cartTotal;
    const applied = tendered != null ? Math.min(tendered, total) : total;
    const changeDue =
      tendered != null ? Math.max(0, Math.round((tendered - total) * 100) / 100) : 0;
    const balanceDue =
      tendered != null ? Math.max(0, Math.round((total - tendered) * 100) / 100) : 0;

    if (applied < 0.01 && total > 0.009) {
      setStatus('Montant reçu insuffisant', { persist: true });
      return;
    }

    if (activeDraft.paymentMethod === 'BANK') {
      if (activeDraft.bankId === '' || activeDraft.bankAccountId === '') {
        setStatus('Choisissez la banque et le compte', { persist: true });
        return;
      }
      if (!navigator.onLine) {
        setStatus('Paiement banque indisponible hors ligne', { persist: true });
        return;
      }
    }

    const clientName = activeDraft.name || null;
    const clientUuid =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `sale-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload = {
      items: activeCart.map((l) => ({
        productSaleUnitId: l.productSaleUnitId,
        quantity: l.quantity,
        ...(saleMode === 'special' && l.manualUnitPrice != null
          ? { unitPrice: l.manualUnitPrice }
          : {}),
      })),
      payments: [
        {
          method: activeDraft.paymentMethod,
          amount: applied > 0.009 ? applied : total > 0.009 ? applied : 0.01,
          ...(activeDraft.paymentMethod === 'BANK' && typeof activeDraft.bankAccountId === 'number'
            ? { bankAccountId: activeDraft.bankAccountId }
            : {}),
        },
      ],
      clientName,
      clientUuid,
      registerId: registerSession.registerId,
      ...(saleMode === 'special' ? { specialSale: true } : {}),
      ...(tendered != null ? { amountReceived: tendered } : {}),
    };
    try {
      if (!navigator.onLine) {
        await enqueueSale(payload);
        window.dispatchEvent(new Event('pos-pending-sales-changed'));
        setStatus('Hors ligne : vente mise en file d’attente');
        removeActiveDraftFromUI();
        setAmountReceived('');
        return;
      }
      const sale = (await createSale(payload)) as {
        id: number;
        txnNumber?: number | null;
        changeDue?: number;
        balanceDue?: number;
        amountReceived?: number;
      };
      const txnRef = sale.txnNumber ?? sale.id;
      const msgParts = [`Vente #${txnRef} enregistrée`];
      if ((sale.changeDue ?? changeDue) > 0.009) {
        msgParts.push(`monnaie due ${formatMoney(sale.changeDue ?? changeDue)}`);
      }
      if ((sale.balanceDue ?? balanceDue) > 0.009) {
        msgParts.push(`reste ${formatMoney(sale.balanceDue ?? balanceDue)}`);
      }
      setStatus(msgParts.join(' — '));
      if (printTicket && window.desktopApp?.printReceipt) {
        await window.desktopApp.printReceipt({
          saleId: txnRef,
          companyName: company?.name ?? 'Entreprise',
          companyPhone: company?.phone ?? null,
          address: [company?.address, company?.city].filter(Boolean).join(', ') || '',
          cashier: cashierLabel,
          receiptClientName: activeDraft.name || null,
          items: activeCart.map((x) => {
            const pr = productsById.get(x.productId);
            const price =
              saleMode === 'special'
                ? (x.manualUnitPrice ?? 0)
                : effectiveUnitPrice(pr, x, familyQtyMap);
            return {
              name: x.label,
              qty: x.quantity,
              price,
            };
          }),
          total,
          amountReceived: sale.amountReceived ?? tendered,
          changeDue: sale.changeDue ?? changeDue,
          balanceDue: sale.balanceDue ?? balanceDue,
          paymentMode:
            activeDraft.paymentMethod === 'CASH'
              ? 'Espèces'
              : activeDraft.paymentMethod === 'CARD'
                ? 'Carte'
                : activeDraft.paymentMethod === 'MOBILE_MONEY'
                  ? 'Mobile money'
                  : activeDraft.paymentMethod === 'SPLIT'
                    ? 'Mixte'
                    : activeDraft.paymentMethod === 'BANK'
                      ? 'Banque'
                      : activeDraft.paymentMethod,
          paperWidth: printer?.paperWidth === 80 ? 80 : 58,
          printerName: printer?.deviceName ?? '',
          receiptHeaderText: printer?.receiptHeaderText ?? null,
          receiptFooterText: printer?.receiptFooterText ?? null,
          receiptLogoUrl: printer?.receiptLogoUrl ?? null,
          showLogoOnReceipt: printer?.showLogoOnReceipt ?? true,
          autoCut: printer?.autoCut ?? true,
        });
      }
      removeActiveDraftFromUI();
      setAmountReceived('');
      await refreshCashGaps();
      const deptId = typeof user?.departmentId === 'number' ? user.departmentId : undefined;
      if (isCashier) {
        setProducts(await loadProductsWithCache(deptId));
      } else {
        setProducts(await loadProductsWithCache(undefined));
      }
    } catch (e) {
      if (isLikelyNetworkError(e) || !navigator.onLine) {
        await enqueueSale(payload);
        window.dispatchEvent(new Event('pos-pending-sales-changed'));
        setStatus('Réseau indisponible : vente mise en file d’attente');
        removeActiveDraftFromUI();
        setAmountReceived('');
        return;
      }
      setStatus('Échec vente (stock ou données)', { persist: true });
    }
  }

  async function onSettleChange(saleId: number) {
    setCashGapBusyId(saleId);
    try {
      const r = await settleSaleChange(saleId);
      setStatus(`Monnaie remise — fiche #${saleId} (${formatMoney(r.changeSettled)})`);
      await refreshCashGaps();
    } catch {
      setStatus('Impossible de remettre la monnaie', { persist: true });
    } finally {
      setCashGapBusyId(null);
    }
  }

  async function onCollectBalance(saleId: number, balanceDue: number) {
    setCashGapBusyId(saleId);
    try {
      await collectSaleBalance(saleId, balanceDue);
      setStatus(`Reste encaissé — fiche #${saleId} (${formatMoney(balanceDue)})`);
      await refreshCashGaps();
    } catch {
      setStatus('Impossible d’encaisser le reste', { persist: true });
    } finally {
      setCashGapBusyId(null);
    }
  }

  async function onOpenRegister(lines: Array<{ productId: number; countedQty: number }>) {
    if (effectiveDepartmentId == null || selectedRegisterId === '') {
      setRegisterError('Configuration manquante.');
      return;
    }
    setRegisterBusy(true);
    setRegisterError('');
    try {
      const cashRaw = openingCash.trim().replace(',', '.');
      const openingCashAmount =
        cashRaw === '' ? undefined : Number.isFinite(Number(cashRaw)) ? Number(cashRaw) : undefined;
      const session = await openRegisterSession({
        registerId: selectedRegisterId,
        departmentId: effectiveDepartmentId,
        openingCashAmount,
        lines,
      });
      setRegisterSession(session);
      setOpeningCash('');
      setRegisterPanel(null);
      setStatus('Caisse ouverte');
    } catch {
      setRegisterError('Ouverture impossible.');
    } finally {
      setRegisterBusy(false);
    }
  }

  async function onCloseRegister(lines: Array<{ productId: number; countedQty: number }>) {
    if (!registerSession) return;
    const expected = Number(closingCashExpected.replace(',', '.'));
    const counted = Number(closingCashCounted.replace(',', '.'));
    if (!Number.isFinite(expected) || expected < 0 || !Number.isFinite(counted) || counted < 0) {
      setRegisterError('Montants invalides.');
      return;
    }
    setRegisterBusy(true);
    setRegisterError('');
    try {
      await closeRegisterSession(registerSession.id, {
        closingCashExpected: expected,
        closingCashCounted: counted,
        lines,
      });
      setRegisterSession(null);
      setRegisterPanel(null);
      setClosingCashExpected('');
      setClosingCashCounted('');
      setClosingCashPreview(null);
      await loadRegisterContext(effectiveDepartmentId, effectiveCompanyId);
      setStatus('Caisse fermée');
    } catch {
      setRegisterError('Fermeture impossible.');
    } finally {
      setRegisterBusy(false);
    }
  }

  async function refreshCountProducts() {
    if (effectiveDepartmentId == null) return;
    const sheet = await getInventoryCountSheet(effectiveDepartmentId);
    setCountProducts(sheet.products);
  }

  async function openRegisterPanel(mode: 'open' | 'close') {
    setRegisterError('');
    setClosingCashCounted('');
    if (mode === 'open') {
      setOpeningCash('');
      setClosingCashExpected('');
    }
    await refreshCountProducts();
    if (mode === 'close' && registerSession) {
      try {
        const preview = await getRegisterClosingCashPreview(registerSession.id);
        setClosingCashPreview(preview);
        setClosingCashExpected(String(preview.expected));
      } catch {
        setClosingCashPreview(null);
        const opening = Number(registerSession.openingCashAmount ?? 0);
        setClosingCashExpected(Number.isFinite(opening) ? String(opening) : '0');
        setRegisterError('Impossible de calculer les espèces attendues.');
      }
    } else {
      setClosingCashPreview(null);
    }
    setRegisterPanel(mode);
  }

  return (
    <div className="page-inner pos-page">
      <header className="page-header" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>Caisse</h1>
        <div className="pos-sale-mode" role="tablist" aria-label="Type de vente">
          <button
            type="button"
            role="tab"
            className={`pos-sale-mode-btn${saleMode === 'classic' ? ' active' : ''}`}
            aria-selected={saleMode === 'classic'}
            onClick={() => switchSaleMode('classic')}
          >
            Vente classique
          </button>
          {canSpecialSale ? (
            <button
              type="button"
              role="tab"
              className={`pos-sale-mode-btn${saleMode === 'special' ? ' active' : ''}`}
              aria-selected={saleMode === 'special'}
              onClick={() => switchSaleMode('special')}
            >
              Vente spéciale
            </button>
          ) : null}
        </div>
        {registerSession ? (
          <span className="info-text" style={{ margin: 0 }}>
            Caisse {formatRegisterCode(registerSession.register.code)} ·{' '}
            {registerSession.department.name}
          </span>
        ) : null}
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={effectiveDepartmentId == null}
          onClick={() =>
            void openRegisterPanel(registerSession ? 'close' : 'open')
          }
        >
          {registerSession ? 'Fermer caisse' : 'Ouvrir caisse'}
        </button>
      </header>

      {status ? <p className="info-text">{status}</p> : null}

      {registerPanel && effectiveDepartmentId != null ? (
        <section className="card" style={{ marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
            <h2 style={{ margin: 0 }}>{registerPanel === 'open' ? 'Ouverture caisse' : 'Fermeture caisse'}</h2>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={registerBusy}
              onClick={() => setRegisterPanel(null)}
            >
              ×
            </button>
          </div>
          {registerPanel === 'open' ? (
            <>
              <label style={{ display: 'block', marginTop: '0.75rem' }}>
                Numéro de caisse
                <select
                  value={selectedRegisterId}
                  onChange={(e) =>
                    setSelectedRegisterId(e.target.value === '' ? '' : Number(e.target.value))
                  }
                  required
                >
                  {registers.length === 0 ? (
                    <option value="">Aucune caisse — créez-en dans Configuration</option>
                  ) : null}
                  {registers.map((r) => (
                    <option key={r.id} value={r.id}>
                      {formatRegisterCode(r.code)}
                      {r.department?.name ? ` · ${r.department.name}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <RegisterStockCountForm
                key={`open-${countProducts.map((p) => p.id).join('-')}`}
                products={countProducts}
                submitLabel="Ouvrir"
                busy={registerBusy}
                error={registerError}
                cashFields={
                  <MoneyField
                    label="Fond disponible"
                    currencyCode={currencyCode}
                    type="text"
                    inputMode="decimal"
                    value={openingCash}
                    disabled={registerBusy}
                    onChange={(e) => setOpeningCash(e.target.value)}
                  />
                }
                onSubmit={(lines) => void onOpenRegister(lines)}
              />
            </>
          ) : registerSession ? (
            <RegisterStockCountForm
              key={`close-${countProducts.map((p) => p.id).join('-')}`}
              products={countProducts}
              submitLabel="Fermer"
              busy={registerBusy}
              error={registerError}
              cashFields={
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {closingCashPreview ? (
                    <div className="pos-closing-cash-breakdown" aria-label="Détail caisse">
                      <div className="pos-closing-cash-row">
                        <span>Fond d’ouverture</span>
                        <strong>{formatMoney(closingCashPreview.openingCash)}</strong>
                      </div>
                      <div className="pos-closing-cash-row">
                        <span>Total ventes (session)</span>
                        <strong>
                          {formatMoney(
                            closingCashPreview.salesTotal ?? closingCashPreview.salesCash,
                          )}
                        </strong>
                      </div>
                      <div className="pos-closing-cash-row">
                        <span>Dont encaissements espèces</span>
                        <strong>{formatMoney(closingCashPreview.salesCash)}</strong>
                      </div>
                      {closingCashPreview.unsettledChange > 0.009 ? (
                        <div className="pos-closing-cash-row">
                          <span>Monnaie non rendue</span>
                          <strong>{formatMoney(closingCashPreview.unsettledChange)}</strong>
                        </div>
                      ) : null}
                      {closingCashPreview.expenses > 0.009 ? (
                        <div className="pos-closing-cash-row">
                          <span>Dépenses</span>
                          <strong>−{formatMoney(closingCashPreview.expenses)}</strong>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                    <MoneyField
                      label="Espèces attendues"
                      currencyCode={currencyCode}
                      type="text"
                      inputMode="decimal"
                      value={closingCashExpected}
                      disabled
                      readOnly
                    />
                    <MoneyField
                      label="Espèces comptées"
                      currencyCode={currencyCode}
                      type="text"
                      inputMode="decimal"
                      value={closingCashCounted}
                      disabled={registerBusy}
                      onChange={(e) => setClosingCashCounted(e.target.value)}
                    />
                  </div>
                </div>
              }
              onSubmit={(lines) => void onCloseRegister(lines)}
            />
          ) : null}
        </section>
      ) : null}

      <div className="pos-grid">
        <section className="card pos-products">
          <div
            className="pos-toolbar"
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'end' }}
          >
            {!isCashier ? (
              <>
                <label>
                  Entreprise
                  <select
                    value={selectedCompanyId}
                    onChange={(e) => setSelectedCompanyId(e.target.value === '' ? '' : Number(e.target.value))}
                  >
                    {companies.length ? (
                      companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))
                    ) : (
                      <option value="" disabled>
                        Chargement...
                      </option>
                    )}
                  </select>
                </label>
                <label>
                  Département
                  <select
                    value={selectedDepartmentId}
                    onChange={(e) =>
                      setSelectedDepartmentId(
                        e.target.value === '' ? '' : Number(e.target.value),
                      )
                    }
                  >
                    {departments.length ? (
                      departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))
                    ) : (
                      <option value="" disabled>
                        Chargement...
                      </option>
                    )}
                  </select>
                </label>
              </>
            ) : null}
            <label>
              Paiement
              <select
                value={activeDraft.paymentMethod}
                disabled={!salesEnabled}
                onChange={(e) => setActivePaymentMethod(e.target.value as PaymentMethod)}
              >
                <option value="CASH">Espèces</option>
                <option value="CARD">Carte</option>
                <option value="MOBILE_MONEY">Mobile money</option>
                <option value="SPLIT">Mixte</option>
                <option value="BANK">Banque</option>
              </select>
            </label>
            {activeDraft.paymentMethod === 'BANK' ? (
              <>
                <label>
                  Banque
                  <select
                    value={activeDraft.bankId === '' ? '' : String(activeDraft.bankId)}
                    disabled={!salesEnabled}
                    onChange={(e) => {
                      const bankId = e.target.value === '' ? '' : Number(e.target.value);
                      updateActiveDraft((d) => ({
                        ...d,
                        bankId,
                        bankAccountId: '',
                      }));
                    }}
                  >
                    <option value="">Choisir…</option>
                    {banks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Compte
                  <select
                    value={
                      activeDraft.bankAccountId === '' ? '' : String(activeDraft.bankAccountId)
                    }
                    disabled={!salesEnabled || activeDraft.bankId === ''}
                    onChange={(e) => {
                      const bankAccountId =
                        e.target.value === '' ? '' : Number(e.target.value);
                      updateActiveDraft((d) => ({ ...d, bankAccountId }));
                    }}
                  >
                    <option value="">Choisir…</option>
                    {activeBankAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {a.accountNumber ? ` (${a.accountNumber})` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
          </div>
          <div className="product-grid">
            {displayedProducts.map((p) => {
              const su = defaultSaleUnit(p);
              const up = su ? Number(su.unitsPerPackage) : 0;
              const maxInUnit = su && p.trackStock && !p.isService ? maxQtyInSaleUnit(p, up) : undefined;
              const disabled =
                !su ||
                (p.trackStock &&
                  !p.isService &&
                  maxInUnit !== undefined &&
                  maxInUnit < MIN_SALE_QTY);
              const tileColor = p.cardColor?.trim() || DEFAULT_PRODUCT_TILE_COLOR;
              return (
                <button
                  key={p.id}
                  type="button"
                  className="product-tile"
                  disabled={disabled}
                  style={{
                    backgroundColor: tileColor,
                    color: textColorForBackground(tileColor),
                  }}
                  onClick={() => addLine(p)}
                >
                  <span className="product-tile-name">{p.name}</span>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="card pos-cart">
          <div className="pos-drafts">
            <div className="pos-drafts-head">
              <h2>Panier</h2>
              <button type="button" className="btn btn-secondary btn-sm" disabled={!salesEnabled} onClick={() => createDraft()}>
                + Fiche
              </button>
            </div>
            <div className="pos-draft-name-edit">
              <label className="pos-draft-name-label">
                Nom fiche
                <input
                  value={activeDraft.name}
                  disabled={!salesEnabled}
                  onChange={(e) => setActiveDraftName(e.target.value)}
                  placeholder="Ex. Client Dupont"
                />
              </label>
            </div>
            <div className="pos-drafts-list" role="tablist" aria-label="Fiches ouvertes">
              {drafts.map((d, idx) => (
                <div key={d.id} className="pos-draft-item">
                  <button
                    type="button"
                    className={`pos-draft-btn${d.id === activeDraftId ? ' active' : ''}`}
                    onClick={() => setActiveDraftId(d.id)}
                    role="tab"
                    aria-selected={d.id === activeDraftId}
                    title={`Fiche ${idx + 1}`}
                  >
                    {d.name || 'Client'}
                  </button>
                  <button
                    type="button"
                    className="pos-draft-del"
                    disabled={drafts.length <= 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteDraft(d.id);
                    }}
                    title="Supprimer la fiche"
                    aria-label="Supprimer la fiche"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
          <ul className="cart-lines">
            {activeCart.map((l) => {
              const pr = productsById.get(l.productId);
              const unitP =
                saleMode === 'special'
                  ? (l.manualUnitPrice ?? 0)
                  : effectiveUnitPrice(pr, l, familyQtyMap);
              const lineTotal =
                saleMode === 'special' && (l.manualUnitPrice == null || !Number.isFinite(l.manualUnitPrice))
                  ? 0
                  : unitP * l.quantity;
              return (
              <li key={l.productSaleUnitId} className="cart-line">
                <div className="cart-line-main">
                  <div className="cart-line-title">{l.label}</div>
                  {saleMode === 'special' ? (
                    <label className="cart-price-label">
                      Prix unitaire
                      <input
                        className="cart-price-input"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        disabled={!salesEnabled}
                        value={l.manualUnitPrice == null ? '' : String(l.manualUnitPrice)}
                        placeholder="0.00"
                        onChange={(e) => setLineManualPrice(l.productSaleUnitId, e.target.value)}
                      />
                    </label>
                  ) : (
                    <div className="cart-line-sub">
                      {formatMoney(unitP)} × {formatQty(l.quantity)} = {formatMoney(lineTotal)}
                    </div>
                  )}
                  {saleMode === 'special' ? (
                    <div className="cart-line-sub">
                      {l.manualUnitPrice == null
                        ? `× ${formatQty(l.quantity)}`
                        : `${formatMoney(unitP)} × ${formatQty(l.quantity)} = ${formatMoney(lineTotal)}`}
                    </div>
                  ) : null}
                </div>
                <div className="cart-qty-editor">
                  <div className="cart-qty-steppers">
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      disabled={!salesEnabled}
                      title="Retirer 1 unité de vente"
                      onClick={() => bumpQty(l.productSaleUnitId, -1)}
                    >
                      −1
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      disabled={!salesEnabled}
                      title="Retirer un demi (0,5 unité)"
                      onClick={() => bumpQty(l.productSaleUnitId, -0.5)}
                    >
                      −½
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      disabled={!salesEnabled}
                      title="Ajouter un demi (0,5 unité)"
                      onClick={() => bumpQty(l.productSaleUnitId, 0.5)}
                    >
                      +½
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      disabled={!salesEnabled}
                      title="Ajouter 1 unité de vente"
                      onClick={() => bumpQty(l.productSaleUnitId, 1)}
                    >
                      +1
                    </button>
                  </div>
                  <label className="cart-qty-label">
                    Qté (décimal)
                    <input
                      key={`qty-${l.productSaleUnitId}-${l.quantity}`}
                      className="cart-qty-input"
                      type="number"
                      inputMode="decimal"
                      min={MIN_SALE_QTY}
                      step="any"
                      disabled={!salesEnabled}
                      defaultValue={formatQty(l.quantity)}
                      onBlur={(e) => setLineQty(l.productSaleUnitId, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      }}
                    />
                  </label>
                </div>
              </li>
            );
            })}
          </ul>
          <div className="cart-total-row">
            <span>Total</span>
            <strong>{formatMoney(cartTotal)}</strong>
          </div>
          {showTenderField ? (
            <div className="pos-tender-block">
              <MoneyField
                label="Montant reçu"
                currencyCode={currencyCode}
                type="text"
                inputMode="decimal"
                value={amountReceived}
                disabled={!salesEnabled}
                onChange={(e) => setAmountReceived(e.target.value)}
                placeholder="0.00"
              />
              {tenderPreview ? (
                <div className="pos-tender-preview">
                  {tenderPreview.changeDue > 0.009 ? (
                    <span className="pos-tender-change">
                      Monnaie due : {formatMoney(tenderPreview.changeDue)}
                    </span>
                  ) : null}
                  {tenderPreview.balanceDue > 0.009 ? (
                    <span className="pos-tender-balance">
                      Reste client : {formatMoney(tenderPreview.balanceDue)}
                    </span>
                  ) : null}
                  {tenderPreview.changeDue <= 0.009 && tenderPreview.balanceDue <= 0.009 ? (
                    <span className="pos-tender-ok">Montant exact</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          <label className="checkbox-row" style={{ margin: '0.75rem 0' }}>
            <input
              type="checkbox"
              checked={printTicket}
              onChange={(e) => setPrintTicket(e.target.checked)}
            />
            Imprimer le ticket
          </label>
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={
              activeCart.length === 0 ||
              !specialPricesReady ||
              (showTenderField && amountReceived.trim() === '') ||
              (activeDraft.paymentMethod === 'BANK' &&
                (activeDraft.bankId === '' || activeDraft.bankAccountId === ''))
            }
            onClick={() => void checkout()}
          >
            Encaisser
          </button>

          <div className="pos-cash-gaps">
            {(cashGaps.changeOwed.length > 0 || cashGaps.balanceOwed.length > 0) ? (
              <label className="pos-cash-gap-search">
                <span className="sr-only">Rechercher une fiche</span>
                <input
                  type="search"
                  value={cashGapQuery}
                  onChange={(e) => setCashGapQuery(e.target.value)}
                  placeholder="Rechercher (#fiche, client…)"
                  autoComplete="off"
                />
              </label>
            ) : null}
            <section className="pos-cash-gap-list">
              <h3>
                Monnaie à rendre
                {cashGapQuery.trim() && cashGaps.changeOwed.length > 0 ? (
                  <span className="pos-cash-gap-count">
                    {' '}
                    ({filteredCashGaps.changeOwed.length}/{cashGaps.changeOwed.length})
                  </span>
                ) : null}
              </h3>
              {cashGaps.changeOwed.length === 0 ? (
                <p className="dept-hint">Aucune</p>
              ) : filteredCashGaps.changeOwed.length === 0 ? (
                <p className="dept-hint">Aucun résultat</p>
              ) : (
                <ul>
                  {filteredCashGaps.changeOwed.map((row) => (
                    <li key={`c-${row.id}`}>
                      <div>
                        <strong>#{row.txnNumber ?? row.id}</strong>{' '}
                        {row.clientName?.trim() || 'Client'}
                        <div className="dept-hint">{formatMoney(row.changeDue)}</div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={!salesEnabled || cashGapBusyId === row.id}
                        onClick={() => void onSettleChange(row.id)}
                      >
                        Remettre
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="pos-cash-gap-list">
              <h3>
                Restes à encaisser
                {cashGapQuery.trim() && cashGaps.balanceOwed.length > 0 ? (
                  <span className="pos-cash-gap-count">
                    {' '}
                    ({filteredCashGaps.balanceOwed.length}/{cashGaps.balanceOwed.length})
                  </span>
                ) : null}
              </h3>
              {cashGaps.balanceOwed.length === 0 ? (
                <p className="dept-hint">Aucun</p>
              ) : filteredCashGaps.balanceOwed.length === 0 ? (
                <p className="dept-hint">Aucun résultat</p>
              ) : (
                <ul>
                  {filteredCashGaps.balanceOwed.map((row) => (
                    <li key={`b-${row.id}`}>
                      <div>
                        <strong>#{row.txnNumber ?? row.id}</strong>{' '}
                        {row.clientName?.trim() || 'Client'}
                        <div className="dept-hint">{formatMoney(row.balanceDue)}</div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={!salesEnabled || cashGapBusyId === row.id}
                        onClick={() => void onCollectBalance(row.id, row.balanceDue)}
                      >
                        Encaisser
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </aside>
      </div>

      {showClosedCaisseAlert ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setShowClosedCaisseAlert(false)}
        >
          <div
            className="modal card"
            role="dialog"
            aria-modal
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0 }}>Caisse fermée</h2>
            <p style={{ margin: '0 0 1rem' }}>
              La transaction n&apos;a pas été enregistrée. Ouvrez la caisse d&apos;abord.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowClosedCaisseAlert(false)}
              >
                OK
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setShowClosedCaisseAlert(false);
                  void openRegisterPanel('open');
                }}
              >
                Ouvrir caisse
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
