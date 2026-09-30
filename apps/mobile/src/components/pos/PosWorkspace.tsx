import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';

import { ChipScroll } from '@/components/ChipScroll';
import { MoneyText } from '@/components/MoneyText';
import { PosCashGapsSheet } from '@/components/pos/PosCashGapsSheet';
import { PosHomeFields, PosSideCart } from '@/components/pos/PosSideCart';
import { emptyDraft, type SaleDraft } from '@/components/pos/posDraft';
import { RegisterSessionBar } from '@/components/pos/RegisterSessionBar';
import { makeRefreshControl } from '@/components/RefreshableScroll';
import { Screen } from '@/components/Screen';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useCompanyScope } from '@/hooks/useCompanyScope';
import { usePendingSalesCount } from '@/hooks/usePendingSalesCount';
import { formatApiError, isLikelyNetworkError } from '@/services/api-errors';
import {
  collectSaleBalance,
  createSale,
  getCompanies,
  getDepartments,
  listBanks,
  listSaleCashGaps,
  settleSaleChange,
} from '@/services/api';
import { printReceipt } from '@/services/bluetooth-printer';
import { isOnline } from '@/services/net';
import { enqueueSale, syncSalesQueue } from '@/services/offline-queue';
import { getPosDeviceId } from '@/services/pos-device';
import { loadProductsWithCache } from '@/services/product-cache';
import { buildSaleReceiptData } from '@/services/receipt';
import type {
  BankRow,
  CompanyListItem,
  CreateSalePayload,
  Department,
  Product,
  RegisterSessionContext,
  RegisterSessionDetail,
  SaleCashGapRow,
  SaleCashGaps,
} from '@/types/api';
import { DEFAULT_PRODUCT_TILE_COLOR, textColorForBackground } from '@/utils/colorContrast';
import { emitPendingSalesChanged } from '@/utils/eventBus';
import { formatMoney, formatMoneyAmount } from '@/utils/datetime';
import { paymentMethodLabel } from '@/utils/paymentLabels';
import { saleDisplayRef } from '@/utils/saleRef';
import {
  addLineToCart,
  bumpCartLine,
  defaultSaleUnit,
  effectiveUnitPrice,
  familyQtyByProduct,
  productSellable,
  setCartLineQty,
  specialPricesReady,
} from '@/utils/posCart';
import {
  departmentsForUser,
  isAdminRole,
  isDistributionOnlyUser,
  isProductionKind,
  resolvedDepartmentIds,
} from '@/utils/user-scope';
import { posPaymentOptions } from '@/utils/posCollect';

const WARNING = '#B45309';
const WARNING_BG = '#FEF3C7';

type PosWorkspaceProps = {
  mode: 'classic' | 'special';
};

export function PosWorkspace({ mode }: PosWorkspaceProps) {
  const { user, canPerm } = useAuth();
  const { companyId: scopedCompanyId } = useCompanyScope();
  const cashierLabel = user?.fullName?.trim() || user?.phone || 'Caissier';
  const assignedDeptIds = resolvedDepartmentIds(user);
  const posScopeLocked = !isAdminRole(user?.role) && assignedDeptIds.length === 1;
  const canUsePos = canPerm('pos.use');
  const canSpecial = canPerm('sales.special_price');
  const canSell = canPerm('sales.create') || canUsePos;
  const paymentChoices = useMemo(
    () => posPaymentOptions(user),
    [user?.role, user?.productionDepartmentIds],
  );

  const [products, setProducts] = useState<Product[]>([]);
  const [companies, setCompanies] = useState<CompanyListItem[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | ''>('');
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<number | ''>('');
  const [drafts, setDrafts] = useState<SaleDraft[]>(() => [emptyDraft('d1')]);
  const [activeDraftId, setActiveDraftId] = useState('d1');
  const [amountReceived, setAmountReceived] = useState('');
  const tenderFollowsTotal = useRef(true);
  const [nameDraft, setNameDraft] = useState('');
  const [printTicket, setPrintTicket] = useState(true);
  const [gapsOpen, setGapsOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [productQuery, setProductQuery] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [registerSession, setRegisterSession] = useState<RegisterSessionDetail | null>(null);
  const [mineElsewhere, setMineElsewhere] = useState<RegisterSessionDetail | null>(null);
  const [sessionOccupancy, setSessionOccupancy] = useState<RegisterSessionDetail | null>(null);
  const [qtyDrafts, setQtyDrafts] = useState<Record<number, string>>({});
  const [cashGaps, setCashGaps] = useState<SaleCashGaps>({ changeOwed: [], balanceOwed: [] });
  const [cashGapBusyId, setCashGapBusyId] = useState<number | null>(null);
  const [cashGapQuery, setCashGapQuery] = useState('');
  const [banks, setBanks] = useState<BankRow[]>([]);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [sessionRefreshKey, setSessionRefreshKey] = useState(0);

  const companyId = posScopeLocked
    ? typeof user?.companyId === 'number'
      ? user.companyId
      : (scopedCompanyId ?? undefined)
    : selectedCompanyId === ''
      ? undefined
      : selectedCompanyId;

  const departmentId = posScopeLocked
    ? assignedDeptIds[0]
    : selectedDepartmentId === ''
      ? undefined
      : selectedDepartmentId;

  const canSellHome = useMemo(() => {
    const kind = departments.find((d) => d.id === departmentId)?.kind;
    if (isProductionKind(kind)) return true;
    return departmentId != null && (user?.productionDepartmentIds ?? []).includes(departmentId);
  }, [departments, departmentId, user?.productionDepartmentIds]);

  useEffect(() => {
    if (canSellHome) return;
    setDrafts((prev) =>
      prev.map((d) => (d.fulfillmentType === 'HOME' ? { ...d, fulfillmentType: 'ON_SITE' } : d)),
    );
  }, [canSellHome]);

  useEffect(() => {
    const allowed = new Set(paymentChoices.map((opt) => opt.method));
    setDrafts((prev) =>
      prev.map((d) =>
        allowed.has(d.paymentMethod)
          ? d
          : { ...d, paymentMethod: 'CASH', bankId: '', bankAccountId: '' },
      ),
    );
  }, [paymentChoices]);

  const activeDraft = useMemo(
    () => drafts.find((d) => d.id === activeDraftId) ?? drafts[0],
    [drafts, activeDraftId],
  );
  const cart = useMemo(() => activeDraft?.cart ?? [], [activeDraft?.cart]);
  const paymentMethod = activeDraft?.paymentMethod ?? 'CASH';
  const selectedBankId = activeDraft?.bankId ?? '';
  const selectedBankAccountId = activeDraft?.bankAccountId ?? '';
  const bankReady =
    paymentMethod !== 'BANK' ||
    (typeof selectedBankId === 'number' && typeof selectedBankAccountId === 'number');

  const pendingCount = usePendingSalesCount();
  const showTenderField = paymentMethod === 'CASH';
  const salesEnabled = registerSession != null;

  const loadProducts = useCallback(async () => {
    if (!posScopeLocked && departmentId == null) {
      setProducts([]);
      return;
    }
    try {
      setProducts(await loadProductsWithCache(departmentId));
    } catch {
      setStatus('Catalogue indisponible (hors ligne, pas de cache)');
    }
  }, [departmentId, posScopeLocked]);

  const refreshCashGaps = useCallback(async () => {
    if (companyId == null) {
      setCashGaps({ changeOwed: [], balanceOwed: [] });
      return;
    }
    try {
      setCashGaps(
        await listSaleCashGaps({
          companyId,
          departmentId,
          take: 40,
        }),
      );
    } catch {
      // panneau secondaire
    }
  }, [companyId, departmentId]);

  const onPullRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try {
      await Promise.all([
        loadProducts(),
        refreshCashGaps(),
        syncSalesQueue()
          .then((result) => {
            if (result.synced > 0) emitPendingSalesChanged();
          })
          .catch(() => undefined),
      ]);
      setSessionRefreshKey((key) => key + 1);
    } finally {
      setPullRefreshing(false);
    }
  }, [loadProducts, refreshCashGaps]);

  useEffect(() => {
    if (posScopeLocked) return;
    let cancelled = false;
    void getCompanies()
      .then((list) => {
        if (cancelled) return;
        setCompanies(list);
        setSelectedCompanyId((prev) => {
          if (prev !== '' && list.some((c) => c.id === prev)) return prev;
          if (typeof user?.companyId === 'number' && list.some((c) => c.id === user.companyId)) {
            return user.companyId;
          }
          return list[0]?.id ?? '';
        });
      })
      .catch(() => {
        if (!cancelled) setCompanies([]);
      });
    return () => {
      cancelled = true;
    };
  }, [posScopeLocked, user?.id, user?.companyId]);

  useEffect(() => {
    if (posScopeLocked || companyId == null) return;
    let cancelled = false;
    void getDepartments(companyId)
      .then((depts) => {
        if (cancelled) return;
        const scoped = departmentsForUser(depts, user);
        setDepartments(scoped);
        setSelectedDepartmentId((prev) => {
          if (typeof prev === 'number' && scoped.some((d) => d.id === prev)) return prev;
          if (
            typeof user?.departmentId === 'number' &&
            scoped.some((d) => d.id === user.departmentId)
          ) {
            return user.departmentId;
          }
          return scoped[0]?.id ?? '';
        });
      })
      .catch(() => {
        if (!cancelled) {
          setDepartments([]);
          setSelectedDepartmentId('');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [posScopeLocked, companyId, user?.departmentId, user?.departmentIds]);

  const displayedProducts = useMemo(() => {
    const rows = posScopeLocked
      ? products.filter((p) => p.nature !== 'RAW_MATERIAL')
      : products.filter((p) => {
          if (p.nature === 'RAW_MATERIAL') return false;
          const productCompanyId = p.companyId ?? p.company?.id;
          const productDeptId = p.department?.id;
          if (companyId != null && productCompanyId != null && productCompanyId !== companyId) {
            return false;
          }
          if (departmentId != null && productDeptId != null && productDeptId !== departmentId) {
            return false;
          }
          return true;
        });
    const sorted = [...rows].sort((a, b) =>
      a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }),
    );
    const q = productQuery.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, posScopeLocked, companyId, departmentId, productQuery]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    if (companyId == null) {
      setBanks([]);
      return;
    }
    void listBanks({ companyId })
      .then((rows) => setBanks(rows.filter((b) => b.isActive)))
      .catch(() => setBanks([]));
  }, [companyId]);

  useFocusEffect(
    useCallback(() => {
      syncSalesQueue()
        .then((result) => {
          if (result.synced > 0) emitPendingSalesChanged();
        })
        .catch(() => undefined);
      void refreshCashGaps();
    }, [refreshCashGaps]),
  );

  useEffect(() => {
    void refreshCashGaps();
  }, [refreshCashGaps, salesEnabled]);

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 4500);
    return () => clearTimeout(t);
  }, [status]);

  useEffect(() => {
    const d = emptyDraft('d1');
    setDrafts([d]);
    setActiveDraftId(d.id);
    tenderFollowsTotal.current = true;
    setAmountReceived('');
    setQtyDrafts({});
  }, [mode]);

  const handleContextChange = useCallback((ctx: RegisterSessionContext) => {
    setRegisterSession(ctx.local);
    setMineElsewhere(ctx.mineElsewhere);
    setSessionOccupancy(ctx.occupancy);
    if (ctx.local && !posScopeLocked) {
      setSelectedCompanyId(ctx.local.department.company.id);
      setSelectedDepartmentId(ctx.local.departmentId);
    }
  }, [posScopeLocked]);

  function resetTender() {
    tenderFollowsTotal.current = true;
    setAmountReceived('');
  }

  function resetCartDrafts() {
    const d = emptyDraft('d1');
    setDrafts([d]);
    setActiveDraftId(d.id);
    resetTender();
    setQtyDrafts({});
  }

  function selectCompany(id: number) {
    if (id === companyId) return;
    if (registerSession != null && registerSession.department.company.id !== id) {
      setStatus('Fermez la caisse');
      return;
    }
    setSelectedCompanyId(id);
    resetCartDrafts();
  }

  function selectDepartment(id: number) {
    if (id === departmentId) return;
    if (registerSession != null && registerSession.departmentId !== id) {
      setStatus('Fermez la caisse');
      return;
    }
    setSelectedDepartmentId(id);
    resetCartDrafts();
  }

  function updateActiveDraft(next: (d: SaleDraft) => SaleDraft) {
    setDrafts((prev) => prev.map((d) => (d.id === activeDraftId ? next(d) : d)));
  }

  function createDraft() {
    commitNameDraft();
    const d = emptyDraft();
    setDrafts((prev) => [...prev, d]);
    setActiveDraftId(d.id);
    resetTender();
    setNameDraft('');
    setQtyDrafts({});
  }

  function deleteDraft(id: string) {
    setDrafts((prev) => {
      if (prev.length <= 1) return prev;
      const remaining = prev.filter((d) => d.id !== id);
      if (activeDraftId === id) {
        setActiveDraftId(remaining[0].id);
        resetTender();
        setQtyDrafts({});
      }
      return remaining;
    });
  }

  function removeActiveDraftFromUI() {
    resetTender();
    setQtyDrafts({});
    if (drafts.length <= 1) {
      setDrafts((prev) =>
        prev.map((d) =>
          d.id === activeDraftId
            ? {
                ...d,
                cart: [],
                name: 'Client',
                fulfillmentType: 'ON_SITE',
                clientPhone: '',
                clientAddress: '',
                deliveryStops: [{ address: '', quantity: '' }],
              }
            : d,
        ),
      );
      return;
    }
    const remaining = drafts.filter((d) => d.id !== activeDraftId);
    setDrafts(remaining);
    setActiveDraftId(remaining[0].id);
  }

  function selectDraft(id: string) {
    if (id === activeDraftId) return;
    commitNameDraft();
    setActiveDraftId(id);
    resetTender();
    setQtyDrafts({});
  }

  function commitNameDraft() {
    const trimmed = nameDraft.trim();
    updateActiveDraft((d) => ({ ...d, name: trimmed || 'Client' }));
  }

  // Sync champ local quand on change de fiche (évite re-render panier à chaque frappe).
  useEffect(() => {
    const n = activeDraft?.name ?? 'Client';
    setNameDraft(n === 'Client' ? '' : n);
  }, [activeDraftId, activeDraft?.name]);

  const productsById = useMemo(() => {
    const byId = new Map<number, Product>();
    for (const product of products) byId.set(product.id, product);
    return byId;
  }, [products]);

  const familyQtyMap = useMemo(
    () => familyQtyByProduct(cart, productsById),
    [cart, productsById],
  );

  const cartTotal = useMemo(
    () =>
      cart.reduce((sum, line) => {
        const product = productsById.get(line.productId);
        return sum + effectiveUnitPrice(product, line, familyQtyMap) * line.quantity;
      }, 0),
    [cart, productsById, familyQtyMap],
  );

  const cashGapCount = cashGaps.changeOwed.length + cashGaps.balanceOwed.length;
  const activeDeptName = departments.find((d) => d.id === departmentId)?.name;
  const activeCompanyName = companies.find((c) => c.id === companyId)?.name;
  const fulfillment = activeDraft?.fulfillmentType ?? 'ON_SITE';
  const selectedBank = banks.find((b) => b.id === selectedBankId);
  const bankAccounts = (selectedBank?.accounts ?? []).filter((a) => a.isActive);

  useEffect(() => {
    if (!showTenderField) return;
    if (!tenderFollowsTotal.current) return;
    setAmountReceived(cartTotal > 0.009 ? formatMoneyAmount(cartTotal) : '');
  }, [cartTotal, showTenderField]);

  const tenderPreview = useMemo(() => {
    if (!showTenderField) return null;
    const raw = amountReceived.trim().replace(',', '.');
    if (raw === '') return null;
    const tendered = Number(raw);
    if (!Number.isFinite(tendered) || tendered < 0) return null;
    const changeDue = Math.max(0, Math.round((tendered - cartTotal) * 100) / 100);
    const balanceDue = Math.max(0, Math.round((cartTotal - tendered) * 100) / 100);
    return { tendered, changeDue, balanceDue };
  }, [amountReceived, cartTotal, showTenderField]);

  const filteredCashGaps = useMemo(() => {
    const q = cashGapQuery.trim().toLowerCase().replace(/^#/, '');
    if (!q) return cashGaps;
    const match = (row: SaleCashGapRow) => {
      const txn = String(row.txnNumber ?? row.id);
      const name = (row.clientName ?? '').trim().toLowerCase();
      const cashier = (row.cashier ?? '').trim().toLowerCase();
      const amounts = [row.changeDue, row.balanceDue, row.total, row.amountReceived, row.amountPaid]
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

  function refuseClosedCaisse() {
    setStatus('Caisse fermée — ouvrez une session pour encaisser');
  }

  function quantityInCart(product: Product): number {
    return cart
      .filter((l) => l.productId === product.id)
      .reduce((sum, l) => sum + l.quantity, 0);
  }

  function addProduct(product: Product) {
    if (!canSell) {
      setStatus('Vente non autorisée pour ce compte');
      return;
    }
    if (!salesEnabled) {
      refuseClosedCaisse();
      return;
    }
    if (mode === 'special' && !canSpecial) {
      setStatus('Vente spéciale réservée aux managers et administrateurs');
      return;
    }
    const ignoreStock = activeDraft?.fulfillmentType === 'HOME';
    const { cart: next, error } = addLineToCart(cart, product, ignoreStock);
    if (error) {
      setStatus(error);
      return;
    }
    updateActiveDraft((d) => ({ ...d, cart: next }));
  }

  function bumpQty(productSaleUnitId: number, delta: number) {
    updateActiveDraft((d) => ({
      ...d,
      cart: bumpCartLine(
        d.cart,
        products,
        productSaleUnitId,
        delta,
        d.fulfillmentType === 'HOME',
      ),
    }));
  }

  function setLineQty(productSaleUnitId: number, qty: number) {
    updateActiveDraft((d) => ({
      ...d,
      cart: setCartLineQty(
        d.cart,
        products,
        productSaleUnitId,
        qty,
        d.fulfillmentType === 'HOME',
      ),
    }));
  }

  function clearActiveCart() {
    updateActiveDraft((d) => ({ ...d, cart: [] }));
    resetTender();
    setQtyDrafts({});
  }

  async function onSettleChange(row: SaleCashGapRow) {
    setCashGapBusyId(row.id);
    try {
      const r = await settleSaleChange(row.id);
      setStatus(`Monnaie remise — fiche #${saleDisplayRef(row)} (${formatMoney(r.changeSettled)})`);
      await refreshCashGaps();
    } catch (err) {
      setStatus(formatApiError(err, 'Impossible de remettre la monnaie'));
    } finally {
      setCashGapBusyId(null);
    }
  }

  async function onCollectBalance(row: SaleCashGapRow) {
    setCashGapBusyId(row.id);
    try {
      await collectSaleBalance(row.id, row.balanceDue);
      setStatus(`Reste encaissé — fiche #${saleDisplayRef(row)} (${formatMoney(row.balanceDue)})`);
      await refreshCashGaps();
    } catch (err) {
      setStatus(formatApiError(err, 'Impossible d’encaisser le reste'));
    } finally {
      setCashGapBusyId(null);
    }
  }

  async function checkout() {
    commitNameDraft();
    const draftName = (nameDraft.trim() || activeDraft?.name || 'Client').trim();
    if (cart.length === 0 || submitting) return;
    if (mode === 'special' && !canSpecial) {
      setStatus('Vente spéciale réservée aux managers et administrateurs');
      return;
    }
    if (mode === 'special' && !specialPricesReady(cart)) {
      setStatus('Renseignez le prix de chaque ligne');
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
        setStatus('Indiquez le montant reçu');
        return;
      }
      tendered = Number(raw);
      if (!Number.isFinite(tendered) || tendered < 0) {
        setStatus('Montant reçu invalide');
        return;
      }
    }

    if (paymentMethod === 'BANK') {
      if (!paymentChoices.some((opt) => opt.method === 'BANK')) {
        setStatus('Encaissement espèces uniquement');
        return;
      }
      if (selectedBankId === '' || selectedBankAccountId === '') {
        setStatus('Choisissez la banque et le compte');
        return;
      }
    }

    const fulfillmentType = activeDraft?.fulfillmentType ?? 'ON_SITE';
    const clientPhone = (activeDraft?.clientPhone ?? '').trim();
    const homeStops = (activeDraft?.deliveryStops ?? [])
      .map((s) => ({
        address: s.address.trim(),
        quantity: Number(String(s.quantity).replace(',', '.')),
      }))
      .filter((s) => s.address || (Number.isFinite(s.quantity) && s.quantity > 0));
    const clientAddress = homeStops[0]?.address ?? (activeDraft?.clientAddress ?? '').trim();
    if (fulfillmentType === 'HOME') {
      if (!draftName || draftName === 'Client') {
        setStatus('Indiquez le nom du client pour la livraison à domicile');
        return;
      }
      if (!clientPhone) {
        setStatus('Indiquez le téléphone du client');
        return;
      }
      if (!homeStops.length || homeStops.some((s) => !s.address || !Number.isFinite(s.quantity) || s.quantity <= 0)) {
        setStatus('Chaque adresse doit avoir une quantité');
        return;
      }
      const cartQty = cart.reduce((acc, l) => acc + l.quantity, 0);
      const stopQty = homeStops.reduce((acc, s) => acc + s.quantity, 0);
      if (Math.abs(stopQty - cartQty) > 0.0001) {
        setStatus('La somme des quantités par adresse doit égaler la quantité vendue');
        return;
      }
    }

    const total = cartTotal;
    const applied = tendered != null ? Math.min(tendered, total) : total;
    if (applied < 0.01 && total > 0.009) {
      setStatus('Montant reçu insuffisant');
      return;
    }

    const cartSnapshot = cart;
    const nameSnapshot = draftName === 'Client' ? null : draftName;
    const methodSnapshot = paymentMethod;
    const bankAccountSnapshot =
      methodSnapshot === 'BANK' && typeof selectedBankAccountId === 'number'
        ? selectedBankAccountId
        : undefined;

    setSubmitting(true);
    const deviceId = await getPosDeviceId();
    const payload: CreateSalePayload = {
      items: cartSnapshot.map((l) => ({
        productSaleUnitId: l.productSaleUnitId,
        quantity: l.quantity,
        ...(mode === 'special' && l.manualUnitPrice != null
          ? { unitPrice: l.manualUnitPrice }
          : {}),
      })),
      payments: [
        {
          method: methodSnapshot,
          amount: applied > 0.009 ? applied : total > 0.009 ? applied : 0.01,
          ...(bankAccountSnapshot != null ? { bankAccountId: bankAccountSnapshot } : {}),
        },
      ],
      clientName: nameSnapshot,
      ...(fulfillmentType === 'HOME'
        ? { clientPhone, clientAddress, deliveryStops: homeStops }
        : {}),
      fulfillmentType,
      clientUuid: Crypto.randomUUID(),
      registerId: registerSession.registerId,
      deviceId,
      ...(mode === 'special' ? { specialSale: true } : {}),
      ...(tendered != null ? { amountReceived: tendered } : {}),
    };

    try {
      const online = await isOnline();
      if (!online) {
        if (methodSnapshot === 'BANK') {
          setStatus('Paiement banque indisponible hors ligne');
          return;
        }
        await enqueueSale(payload);
        emitPendingSalesChanged();
        setStatus('Hors ligne : vente mise en file d’attente');
        removeActiveDraftFromUI();
        return;
      }

      const sale = await createSale(payload);
      const txnRef = saleDisplayRef(sale);
      const changeDue = Number(sale.changeDue ?? tenderPreview?.changeDue ?? 0);
      const balanceDue = Number(
        sale.balanceDue ??
          (tenderPreview ? Math.max(0, cartTotal - (tendered ?? cartTotal)) : 0),
      );
      const parts = [`Vente #${txnRef} enregistrée`];
      if (changeDue > 0.009) parts.push(`monnaie ${formatMoney(changeDue)}`);
      if (balanceDue > 0.009) parts.push(`reste ${formatMoney(balanceDue)}`);
      if (fulfillmentType === 'ON_SITE' && isDistributionOnlyUser(user)) parts.push('Livré');
      setStatus(parts.join(' — '));

      if (printTicket) {
        try {
          const receiptData = await buildSaleReceiptData({
            items: cartSnapshot.map((l) => {
              const product = productsById.get(l.productId);
              return {
                name: l.label,
                qty: l.quantity,
                price: effectiveUnitPrice(product, l, familyQtyMap),
              };
            }),
            total,
            saleRef: txnRef,
            paymentMode: paymentMethodLabel(methodSnapshot),
            clientName: nameSnapshot ?? undefined,
            clientPhone: fulfillmentType === 'HOME' ? clientPhone : undefined,
            clientAddress: fulfillmentType === 'HOME' ? clientAddress : undefined,
            fulfillmentLabel: fulfillmentType === 'HOME' ? 'À domicile' : 'Sur place',
            departmentName:
              fulfillmentType === 'HOME'
                ? undefined
                : departments.find((d) => d.id === departmentId)?.name,
            cashier: cashierLabel,
            departmentId: fulfillmentType === 'HOME' ? undefined : departmentId,
          });
          await printReceipt(receiptData);
        } catch (printError) {
          const reason = printError instanceof Error ? printError.message : 'échec impression';
          setStatus(`${parts[0]} (${reason})`);
        }
      }

      removeActiveDraftFromUI();
      await refreshCashGaps();
      void loadProducts();
    } catch (e) {
      const online = await isOnline();
      if ((isLikelyNetworkError(e) || !online) && methodSnapshot !== 'BANK') {
        await enqueueSale(payload);
        emitPendingSalesChanged();
        setStatus('Réseau indisponible : vente mise en file d’attente');
        removeActiveDraftFromUI();
      } else if (methodSnapshot === 'BANK' && (isLikelyNetworkError(e) || !online)) {
        setStatus('Paiement banque indisponible hors ligne');
      } else {
        setStatus(formatApiError(e, 'Échec vente (stock, caisse ou données)'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!canUsePos) {
    return (
      <Screen style={styles.container}>
        <View style={styles.blocked}>
          <Text style={styles.blockedTitle}>Caisse</Text>
          <Text style={styles.blockedText}>Accès caisse non autorisé pour ce compte.</Text>
        </View>
      </Screen>
    );
  }

  if (mode === 'special' && !canSpecial) {
    return (
      <Screen style={styles.container}>
        <View style={styles.blocked}>
          <Text style={styles.blockedTitle}>Vente spéciale</Text>
          <Text style={styles.blockedText}>
            Réservée aux comptes avec l’autorisation « prix spécial ».
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen style={styles.container}>
      <RegisterSessionBar
        companyId={companyId}
        departmentId={departmentId}
        session={registerSession}
        mineElsewhere={mineElsewhere}
        occupancy={sessionOccupancy}
        refreshKey={sessionRefreshKey}
        onContextChange={handleContextChange}
        onStatus={setStatus}
      />

      {!posScopeLocked ? (
        <View style={styles.scopeBlock}>
          <Pressable style={styles.scopeToggle} onPress={() => setScopeOpen((v) => !v)}>
            <Ionicons name="storefront-outline" size={16} color={BrandColors.primary} />
            <Text style={styles.scopeToggleText} numberOfLines={1}>
              {[activeCompanyName, activeDeptName].filter(Boolean).join(' · ') || 'Point de vente'}
            </Text>
            <Ionicons
              name={scopeOpen ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={BrandColors.textMuted}
            />
          </Pressable>
          {scopeOpen ? (
            <>
              <ChipScroll>
                {companies.map((c) => {
                  const active = companyId === c.id;
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => selectCompany(c.id)}
                      style={[styles.scopeChip, active && styles.scopeChipActive]}>
                      <Text
                        style={[styles.scopeChipText, active && styles.scopeChipTextActive]}
                        numberOfLines={1}>
                        {c.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ChipScroll>
              <ChipScroll>
                {departments.map((d) => {
                  const active = departmentId === d.id;
                  return (
                    <Pressable
                      key={d.id}
                      onPress={() => selectDepartment(d.id)}
                      style={[styles.scopeChip, active && styles.scopeChipActive]}>
                      <Text
                        style={[styles.scopeChipText, active && styles.scopeChipTextActive]}
                        numberOfLines={1}>
                        {d.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ChipScroll>
            </>
          ) : null}
        </View>
      ) : null}

      {status ? (
        <View style={styles.status}>
          <Ionicons name="information-circle-outline" size={18} color={BrandColors.primary} />
          <Text style={styles.statusText}>{status}</Text>
        </View>
      ) : null}

      {pendingCount > 0 ? (
        <View style={styles.pendingBadge}>
          <Ionicons name="cloud-upload-outline" size={16} color={WARNING} />
          <Text style={styles.pendingBadgeText}>
            {pendingCount} vente(s) en attente de synchronisation
          </Text>
        </View>
      ) : null}

      {mode === 'special' ? (
        <View style={styles.modeBanner}>
          <Text style={styles.modeBannerText}>Prix manuels</Text>
        </View>
      ) : null}

      <View style={styles.entry}>
        <View style={styles.entryRow}>
          <View style={styles.field}>
            <Ionicons name="person-outline" size={16} color={BrandColors.textMuted} />
            <TextInput
              style={styles.fieldInput}
              placeholder="Client"
              placeholderTextColor={BrandColors.textMuted}
              value={nameDraft}
              onChangeText={setNameDraft}
              onBlur={commitNameDraft}
              onSubmitEditing={commitNameDraft}
              returnKeyType="next"
              blurOnSubmit={false}
            />
          </View>
          {showTenderField ? (
            <View style={styles.field}>
              <Ionicons name="cash-outline" size={16} color={BrandColors.textMuted} />
              <TextInput
                style={styles.fieldInput}
                placeholder="Reçu"
                placeholderTextColor={BrandColors.textMuted}
                keyboardType="decimal-pad"
                value={amountReceived}
                onChangeText={(value) => {
                  tenderFollowsTotal.current = false;
                  setAmountReceived(value);
                }}
                returnKeyType="done"
              />
            </View>
          ) : null}
        </View>
        <View style={styles.segRow}>
          <Pressable
            style={[styles.segBtn, fulfillment === 'ON_SITE' && styles.segBtnOn]}
            onPress={() => updateActiveDraft((d) => ({ ...d, fulfillmentType: 'ON_SITE' }))}>
            <Text style={[styles.segText, fulfillment === 'ON_SITE' && styles.segTextOn]}>
              Sur place
            </Text>
          </Pressable>
          {canSellHome ? (
            <Pressable
              style={[styles.segBtn, fulfillment === 'HOME' && styles.segBtnOn]}
              onPress={() =>
                updateActiveDraft((d) => ({
                  ...d,
                  fulfillmentType: 'HOME',
                  deliveryStops: d.deliveryStops?.length
                    ? d.deliveryStops
                    : [{ address: '', quantity: '' }],
                }))
              }>
              <Text style={[styles.segText, fulfillment === 'HOME' && styles.segTextOn]}>
                À domicile
              </Text>
            </Pressable>
          ) : null}
          {paymentChoices.map(({ method, label, icon }) => {
            const on = paymentMethod === method;
            return (
              <Pressable
                key={method}
                onPress={() =>
                  updateActiveDraft((d) => ({
                    ...d,
                    paymentMethod: method,
                    ...(method !== 'BANK'
                      ? { bankId: '' as const, bankAccountId: '' as const }
                      : {}),
                  }))
                }
                style={[styles.segBtn, on && styles.segBtnOn]}>
                <Ionicons name={icon} size={13} color={on ? '#fff' : BrandColors.textMuted} />
                <Text style={[styles.segText, on && styles.segTextOn]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
        {paymentMethod === 'BANK' ? (
          <View style={styles.bankWrap}>
            <ChipScroll>
              {banks.length === 0 ? (
                <Text style={styles.warn}>Aucune banque</Text>
              ) : (
                banks.map((bank) => {
                  const on = selectedBankId === bank.id;
                  return (
                    <Pressable
                      key={bank.id}
                      onPress={() =>
                        updateActiveDraft((d) => ({ ...d, bankId: bank.id, bankAccountId: '' }))
                      }
                      style={[styles.chip, on && styles.chipOn]}>
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{bank.name}</Text>
                    </Pressable>
                  );
                })
              )}
            </ChipScroll>
            <ChipScroll>
              {selectedBankId === '' ? (
                <Text style={styles.warn}>Banque</Text>
              ) : bankAccounts.length === 0 ? (
                <Text style={styles.warn}>Aucun compte</Text>
              ) : (
                bankAccounts.map((account) => {
                  const on = selectedBankAccountId === account.id;
                  return (
                    <Pressable
                      key={account.id}
                      onPress={() =>
                        updateActiveDraft((d) => ({ ...d, bankAccountId: account.id }))
                      }
                      style={[styles.chip, on && styles.chipOn]}>
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>
                        {account.name}
                        {account.accountNumber ? ` (${account.accountNumber})` : ''}
                      </Text>
                    </Pressable>
                  );
                })
              )}
            </ChipScroll>
          </View>
        ) : null}
        {fulfillment === 'HOME' && activeDraft ? (
          <PosHomeFields draft={activeDraft} onUpdateDraft={updateActiveDraft} />
        ) : null}
        <View style={styles.draftsBar}>
          <View style={styles.draftsRow}>
            <ChipScroll>
              {drafts.map((d, idx) => {
                const active = d.id === activeDraftId;
                const count = d.cart.reduce((s, l) => s + l.quantity, 0);
                return (
                  <Pressable
                    key={d.id}
                    onPress={() => selectDraft(d.id)}
                    style={[styles.draftChip, active && styles.draftChipActive]}>
                    <Text
                      style={[styles.draftChipText, active && styles.draftChipTextActive]}
                      numberOfLines={1}>
                      {d.name === 'Client' ? `Fiche ${idx + 1}` : d.name}
                      {count > 0 ? ` · ${count}` : ''}
                    </Text>
                    {drafts.length > 1 ? (
                      <Pressable
                        onPress={() => deleteDraft(d.id)}
                        hitSlop={8}
                        style={styles.draftDel}>
                        <Ionicons
                          name="close"
                          size={12}
                          color={active ? '#fff' : BrandColors.textMuted}
                        />
                      </Pressable>
                    ) : null}
                  </Pressable>
                );
              })}
              <Pressable
                style={[styles.addDraftBtn, !salesEnabled && styles.buttonDisabled]}
                disabled={!salesEnabled}
                onPress={createDraft}>
                <Ionicons name="add" size={16} color="#fff" />
              </Pressable>
            </ChipScroll>
          </View>
          <Pressable style={styles.gapChip} onPress={() => setGapsOpen(true)}>
            <Ionicons name="cash-outline" size={16} color={BrandColors.primary} />
            {cashGapCount > 0 ? (
              <View style={styles.gapDot}>
                <Text style={styles.gapDotText}>{cashGapCount}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>
      </View>

      <View style={styles.split}>
        <View style={styles.productsCol}>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={16} color={BrandColors.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Produit"
              placeholderTextColor={BrandColors.textMuted}
              value={productQuery}
              onChangeText={setProductQuery}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
            {productQuery.length > 0 ? (
              <Pressable onPress={() => setProductQuery('')} hitSlop={10}>
                <Ionicons name="close-circle" size={16} color={BrandColors.textMuted} />
              </Pressable>
            ) : null}
          </View>
          <FlatList
            data={displayedProducts}
            keyExtractor={(p) => String(p.id)}
            style={styles.flex}
            contentContainerStyle={styles.productList}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            alwaysBounceVertical
            refreshControl={makeRefreshControl(pullRefreshing, onPullRefresh)}
            renderItem={({ item }) => {
              const inCart = quantityInCart(item);
              const sellable = productSellable(item, fulfillment === 'HOME');
              const tileColor = item.cardColor?.trim() || DEFAULT_PRODUCT_TILE_COLOR;
              const fg = textColorForBackground(tileColor);
              const disabled = !sellable || !salesEnabled;
              return (
                <Pressable
                  disabled={disabled}
                  style={({ pressed }) => [
                    styles.productRow,
                    { backgroundColor: tileColor, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 },
                  ]}
                  onPress={() => {
                    Keyboard.dismiss();
                    addProduct(item);
                  }}>
                  {inCart > 0 ? (
                    <View style={styles.productBadge}>
                      <Text style={styles.productBadgeText}>{inCart}</Text>
                    </View>
                  ) : null}
                  <Text style={[styles.productName, { color: fg }]} numberOfLines={2}>
                    {item.name}
                  </Text>
                  <MoneyText
                    value={defaultSaleUnit(item)?.salePrice ?? 0}
                    style={[styles.productPrice, { color: fg }]}
                  />
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>
                  {productQuery.trim()
                    ? 'Aucun résultat'
                    : !posScopeLocked && departmentId == null
                      ? 'Aucun département'
                      : 'Aucun produit'}
                </Text>
              </View>
            }
          />
        </View>
        <PosSideCart
          mode={mode}
          cart={cart}
          productsById={productsById}
          familyQtyMap={familyQtyMap}
          qtyDrafts={qtyDrafts}
          setQtyDrafts={setQtyDrafts}
          onUpdateDraft={updateActiveDraft}
          onBumpQty={bumpQty}
          onSetQty={setLineQty}
        />
      </View>

      <View style={styles.totals}>
        {tenderPreview?.changeDue ? (
          <Text style={styles.ok}>Monnaie {formatMoney(tenderPreview.changeDue)}</Text>
        ) : null}
        {tenderPreview?.balanceDue ? (
          <Text style={styles.warn}>Reste {formatMoney(tenderPreview.balanceDue)}</Text>
        ) : null}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <MoneyText value={cartTotal} style={styles.totalValue} />
        </View>
        <View style={styles.actions}>
          <Pressable onPress={() => setPrintTicket((v) => !v)} style={styles.printBtn}>
            <Ionicons
              name={printTicket ? 'checkbox' : 'square-outline'}
              size={18}
              color={BrandColors.primary}
            />
            <Text style={styles.printLabel}>Ticket</Text>
          </Pressable>
          <Pressable style={styles.clear} onPress={clearActiveCart}>
            <Text style={styles.clearText}>Vider</Text>
          </Pressable>
          <Pressable
            style={[
              styles.pay,
              (submitting || cart.length === 0 || !salesEnabled || !bankReady) &&
                styles.buttonDisabled,
            ]}
            disabled={submitting || cart.length === 0 || !salesEnabled || !bankReady}
            onPress={() => {
              Keyboard.dismiss();
              void checkout();
            }}>
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.payText}>Encaisser</Text>
            )}
          </Pressable>
        </View>
      </View>

      <PosCashGapsSheet
        visible={gapsOpen}
        salesEnabled={salesEnabled}
        query={cashGapQuery}
        onQueryChange={setCashGapQuery}
        cashGaps={cashGaps}
        filtered={filteredCashGaps}
        busyId={cashGapBusyId}
        onSettleChange={(row) => void onSettleChange(row)}
        onCollectBalance={(row) => void onCollectBalance(row)}
        onClose={() => setGapsOpen(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  blocked: { flex: 1, justifyContent: 'center', padding: Spacing.five, gap: Spacing.two },
  blockedTitle: { fontSize: 22, fontWeight: '700', color: BrandColors.text, textAlign: 'center' },
  blockedText: { fontSize: 15, color: BrandColors.textMuted, textAlign: 'center', lineHeight: 22 },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: BrandColors.surface,
  },
  statusText: { flex: 1, color: BrandColors.text, fontSize: 12 },
  pendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: WARNING_BG,
  },
  pendingBadgeText: { color: WARNING, flex: 1, fontSize: 13 },
  modeBanner: {
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: BrandColors.primarySoft,
  },
  modeBannerText: { color: BrandColors.primaryHover, fontWeight: '700', fontSize: 13 },
  scopeBlock: {
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    gap: 8,
  },
  scopeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: BrandColors.surface,
    borderWidth: 1,
    borderColor: BrandColors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  scopeToggleText: { flex: 1, color: BrandColors.text, fontWeight: '700', fontSize: 13 },
  scopeChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    backgroundColor: BrandColors.surface,
    maxWidth: 220,
  },
  scopeChipActive: { backgroundColor: BrandColors.primary, borderColor: BrandColors.primary },
  scopeChipText: { color: BrandColors.text, fontSize: 13, fontWeight: '600' },
  scopeChipTextActive: { color: '#fff' },
  entry: {
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    gap: 8,
  },
  entryRow: { flexDirection: 'row', gap: 8 },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 12,
    paddingHorizontal: 10,
    backgroundColor: BrandColors.surface,
  },
  fieldInput: { flex: 1, paddingVertical: Platform.OS === 'ios' ? 10 : 8, color: BrandColors.text, fontSize: 15 },
  segRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  segBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: BrandColors.surface,
  },
  segBtnOn: { backgroundColor: BrandColors.primary, borderColor: BrandColors.primary },
  segText: { fontWeight: '700', color: BrandColors.text, fontSize: 12 },
  segTextOn: { color: '#fff' },
  bankWrap: { gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    backgroundColor: BrandColors.surface,
  },
  chipOn: { backgroundColor: BrandColors.primary, borderColor: BrandColors.primary },
  chipText: { color: BrandColors.text, fontWeight: '700', fontSize: 12 },
  chipTextOn: { color: '#fff' },
  draftsBar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  draftsRow: { flex: 1, minWidth: 0 },
  draftChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    backgroundColor: BrandColors.surface,
    maxWidth: 140,
  },
  draftChipActive: { backgroundColor: BrandColors.primary, borderColor: BrandColors.primary },
  draftChipText: { fontWeight: '700', color: BrandColors.text, fontSize: 12 },
  draftChipTextActive: { color: '#fff' },
  draftDel: { padding: 2 },
  addDraftBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: BrandColors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gapChip: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: BrandColors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gapDot: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: BrandColors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  gapDotText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  split: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: Spacing.three,
    marginTop: 8,
    minHeight: 0,
  },
  productsCol: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: Platform.OS === 'ios' ? 8 : 2,
    borderRadius: 12,
    backgroundColor: BrandColors.surface,
    borderWidth: 1,
    borderColor: BrandColors.border,
  },
  searchInput: { flex: 1, color: BrandColors.text, fontSize: 14, paddingVertical: 6 },
  productList: { paddingBottom: 8, gap: 6, flexGrow: 1 },
  productRow: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    minHeight: 56,
    justifyContent: 'center',
  },
  productBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BrandColors.primary,
  },
  productBadgeText: { color: '#ffffff', fontSize: 11, fontWeight: '800' },
  productName: { fontWeight: '800', fontSize: 13, paddingRight: 22 },
  productPrice: { fontWeight: '800', marginTop: 2, fontSize: 12 },
  emptyState: { alignItems: 'center', paddingVertical: Spacing.four },
  emptyStateText: { textAlign: 'center', color: BrandColors.textMuted, fontSize: 13 },
  totals: {
    marginHorizontal: Spacing.three,
    marginTop: 8,
    marginBottom: Spacing.three,
    padding: 12,
    borderRadius: 16,
    backgroundColor: BrandColors.surface,
    borderWidth: 1,
    borderColor: BrandColors.border,
    gap: 6,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { color: BrandColors.textMuted, fontSize: 14, fontWeight: '700' },
  totalValue: { fontSize: 26, fontWeight: '900', color: BrandColors.text },
  ok: { color: BrandColors.ok, fontWeight: '700', fontSize: 13 },
  warn: { color: BrandColors.primaryHover, fontWeight: '700', fontSize: 13 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  printBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: 4 },
  printLabel: { color: BrandColors.text, fontWeight: '700', fontSize: 12 },
  clear: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BrandColors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  clearText: { color: BrandColors.danger, fontWeight: '800', fontSize: 13 },
  pay: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: BrandColors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  payText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  buttonDisabled: { opacity: 0.45 },
});
