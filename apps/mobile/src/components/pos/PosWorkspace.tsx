import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';

import { ModalShell } from '@/components/ModalShell';
import { MoneyText } from '@/components/MoneyText';
import { RegisterSessionBar } from '@/components/pos/RegisterSessionBar';
import { Screen } from '@/components/Screen';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useCompanyScope } from '@/hooks/useCompanyScope';
import { usePendingSalesCount } from '@/hooks/usePendingSalesCount';
import { isLikelyNetworkError } from '@/services/api-errors';
import {
  collectSaleBalance,
  createSale,
  listBanks,
  listSaleCashGaps,
  settleSaleChange,
} from '@/services/api';
import { printReceipt } from '@/services/bluetooth-printer';
import { isOnline } from '@/services/net';
import { enqueueSale, syncSalesQueue } from '@/services/offline-queue';
import { loadProductsWithCache } from '@/services/product-cache';
import { buildSaleReceiptData } from '@/services/receipt';
import type {
  BankRow,
  CreateSalePayload,
  Product,
  RegisterSessionDetail,
  SaleCashGapRow,
  SaleCashGaps,
} from '@/types/api';
import { DEFAULT_PRODUCT_TILE_COLOR, textColorForBackground } from '@/utils/colorContrast';
import { emitPendingSalesChanged } from '@/utils/eventBus';
import { formatMoney } from '@/utils/datetime';
import { paymentMethodLabel } from '@/utils/paymentLabels';
import { saleDisplayRef } from '@/utils/saleRef';
import {
  addLineToCart,
  bumpCartLine,
  defaultSaleUnit,
  effectiveUnitPrice,
  familyQtyByProduct,
  productSellable,
  setCartLineManualPrice,
  setCartLineQty,
  specialPricesReady,
  type CartLine,
} from '@/utils/posCart';

const DANGER = BrandColors.danger;
const WARNING = '#B45309';
const WARNING_BG = '#FEF3C7';

type PaymentMethod = 'CASH' | 'CARD' | 'MOBILE_MONEY' | 'SPLIT' | 'BANK';

type SaleDraft = {
  id: string;
  cart: CartLine[];
  paymentMethod: PaymentMethod;
  name: string;
  bankId: number | '';
  bankAccountId: number | '';
};

function emptyDraft(id = `d${Date.now()}`): SaleDraft {
  return { id, cart: [], paymentMethod: 'CASH', name: 'Client', bankId: '', bankAccountId: '' };
}

const PAYMENT_OPTIONS: {
  method: PaymentMethod;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { method: 'CASH', label: 'Espèces', icon: 'cash-outline' },
  { method: 'CARD', label: 'Carte', icon: 'card-outline' },
  { method: 'MOBILE_MONEY', label: 'Mobile', icon: 'phone-portrait-outline' },
  { method: 'SPLIT', label: 'Mixte', icon: 'git-merge-outline' },
  { method: 'BANK', label: 'Banque', icon: 'business-outline' },
];

type PosWorkspaceProps = {
  mode: 'classic' | 'special';
};

export function PosWorkspace({ mode }: PosWorkspaceProps) {
  const { user, can, canPerm } = useAuth();
  const { companyId } = useCompanyScope();
  const cashierLabel = user?.fullName?.trim() || user?.phone || 'Caissier';
  const departmentId = typeof user?.departmentId === 'number' ? user.departmentId : undefined;
  const canUsePos = canPerm('pos.use') || can(['ADMIN', 'MANAGER', 'CASHIER']);
  const canSpecial = canPerm('sales.special_price') || can(['ADMIN', 'MANAGER']);
  const canSell = canPerm('sales.create') || canUsePos;

  const [products, setProducts] = useState<Product[]>([]);
  const [drafts, setDrafts] = useState<SaleDraft[]>(() => [emptyDraft('d1')]);
  const [activeDraftId, setActiveDraftId] = useState('d1');
  const [amountReceived, setAmountReceived] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [printTicket, setPrintTicket] = useState(true);
  const [cartVisible, setCartVisible] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [registerSession, setRegisterSession] = useState<RegisterSessionDetail | null>(null);
  const [qtyDrafts, setQtyDrafts] = useState<Record<number, string>>({});
  const [cashGaps, setCashGaps] = useState<SaleCashGaps>({ changeOwed: [], balanceOwed: [] });
  const [cashGapBusyId, setCashGapBusyId] = useState<number | null>(null);
  const [cashGapQuery, setCashGapQuery] = useState('');
  const [banks, setBanks] = useState<BankRow[]>([]);

  const activeDraft = useMemo(
    () => drafts.find((d) => d.id === activeDraftId) ?? drafts[0],
    [drafts, activeDraftId],
  );
  const cart = useMemo(() => activeDraft?.cart ?? [], [activeDraft?.cart]);
  const paymentMethod = activeDraft?.paymentMethod ?? 'CASH';
  const clientName = activeDraft?.name ?? 'Client';
  const selectedBankId = activeDraft?.bankId ?? '';
  const selectedBankAccountId = activeDraft?.bankAccountId ?? '';
  const selectedBank = banks.find((b) => b.id === selectedBankId);
  const bankAccounts = (selectedBank?.accounts ?? []).filter((a) => a.isActive);
  const bankReady =
    paymentMethod !== 'BANK' ||
    (typeof selectedBankId === 'number' && typeof selectedBankAccountId === 'number');

  const pendingCount = usePendingSalesCount();
  const showTenderField = paymentMethod === 'CASH' || paymentMethod === 'SPLIT';
  const salesEnabled = registerSession != null;

  const loadProducts = useCallback(() => {
    loadProductsWithCache(departmentId)
      .then(setProducts)
      .catch(() => setStatus('Catalogue indisponible (hors ligne, pas de cache)'));
  }, [departmentId]);

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

  useEffect(() => {
    loadProducts();
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
    setAmountReceived('');
    setQtyDrafts({});
  }, [mode]);

  function updateActiveDraft(next: (d: SaleDraft) => SaleDraft) {
    setDrafts((prev) => prev.map((d) => (d.id === activeDraftId ? next(d) : d)));
  }

  function createDraft() {
    commitNameDraft();
    const d = emptyDraft();
    setDrafts((prev) => [...prev, d]);
    setActiveDraftId(d.id);
    setAmountReceived('');
    setNameDraft('');
    setQtyDrafts({});
  }

  function deleteDraft(id: string) {
    setDrafts((prev) => {
      if (prev.length <= 1) return prev;
      const remaining = prev.filter((d) => d.id !== id);
      if (activeDraftId === id) {
        setActiveDraftId(remaining[0].id);
        setAmountReceived('');
        setQtyDrafts({});
      }
      return remaining;
    });
  }

  function removeActiveDraftFromUI() {
    setAmountReceived('');
    setQtyDrafts({});
    if (drafts.length <= 1) {
      setDrafts((prev) =>
        prev.map((d) => (d.id === activeDraftId ? { ...d, cart: [], name: 'Client' } : d)),
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
    setAmountReceived('');
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

  const cartItemCount = cart.reduce((sum, line) => sum + line.quantity, 0);

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
    const { cart: next, error } = addLineToCart(cart, product);
    if (error) {
      setStatus(error);
      return;
    }
    updateActiveDraft((d) => ({ ...d, cart: next }));
  }

  function bumpQty(productSaleUnitId: number, delta: number) {
    updateActiveDraft((d) => ({
      ...d,
      cart: bumpCartLine(d.cart, products, productSaleUnitId, delta),
    }));
  }

  function clearActiveCart() {
    updateActiveDraft((d) => ({ ...d, cart: [] }));
    setAmountReceived('');
    setQtyDrafts({});
  }

  async function onSettleChange(row: SaleCashGapRow) {
    setCashGapBusyId(row.id);
    try {
      const r = await settleSaleChange(row.id);
      setStatus(`Monnaie remise — fiche #${saleDisplayRef(row)} (${formatMoney(r.changeSettled)})`);
      await refreshCashGaps();
    } catch {
      setStatus('Impossible de remettre la monnaie');
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
    } catch {
      setStatus('Impossible d’encaisser le reste');
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
      if (selectedBankId === '' || selectedBankAccountId === '') {
        setStatus('Choisissez la banque et le compte');
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
      clientUuid: Crypto.randomUUID(),
      registerId: registerSession.registerId,
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
            cashier: cashierLabel,
            departmentId,
          });
          await printReceipt(receiptData);
        } catch (printError) {
          const reason = printError instanceof Error ? printError.message : 'échec impression';
          setStatus(`${parts[0]} (${reason})`);
        }
      }

      removeActiveDraftFromUI();
      await refreshCashGaps();
      loadProducts();
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
        setStatus('Échec vente (stock, caisse ou données)');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function renderCashGapRow(row: SaleCashGapRow, kind: 'change' | 'balance') {
    const busy = cashGapBusyId === row.id;
    return (
      <View key={`${kind}-${row.id}`} style={styles.gapRow}>
        <View style={styles.gapInfo}>
          <Text style={styles.gapTitle}>
            #{saleDisplayRef(row)} · {row.clientName?.trim() || 'Client'}
          </Text>
          <MoneyText
            value={kind === 'change' ? row.changeDue : row.balanceDue}
            style={styles.gapAmount}
          />
        </View>
        <Pressable
          style={[
            styles.gapBtn,
            kind === 'balance' && styles.gapBtnPrimary,
            busy && styles.buttonDisabled,
          ]}
          disabled={!salesEnabled || busy}
          onPress={() =>
            kind === 'change' ? void onSettleChange(row) : void onCollectBalance(row)
          }>
          {busy ? (
            <ActivityIndicator
              color={kind === 'balance' ? '#fff' : BrandColors.primary}
              size="small"
            />
          ) : (
            <Text style={[styles.gapBtnText, kind === 'balance' && styles.gapBtnTextPrimary]}>
              {kind === 'change' ? 'Remettre' : 'Encaisser'}
            </Text>
          )}
        </Pressable>
      </View>
    );
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
        companyId={companyId ?? undefined}
        departmentId={departmentId}
        session={registerSession}
        onSessionChange={setRegisterSession}
        onStatus={setStatus}
      />

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
          <Text style={styles.modeBannerText}>Mode vente spéciale — prix manuels</Text>
        </View>
      ) : null}

      <View style={styles.draftsBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.draftsRow}
          keyboardShouldPersistTaps="handled">
          {drafts.map((d, idx) => {
            const active = d.id === activeDraftId;
            const count = d.cart.reduce((s, l) => s + l.quantity, 0);
            return (
              <View key={d.id} style={styles.draftChipWrap}>
                <Pressable
                  onPress={() => selectDraft(d.id)}
                  style={[styles.draftChip, active && styles.draftChipActive]}>
                  <Text
                    style={[styles.draftChipText, active && styles.draftChipTextActive]}
                    numberOfLines={1}>
                    {d.name || `Fiche ${idx + 1}`}
                    {count > 0 ? ` (${count})` : ''}
                  </Text>
                </Pressable>
                {drafts.length > 1 ? (
                  <Pressable onPress={() => deleteDraft(d.id)} hitSlop={8} style={styles.draftDel}>
                    <Ionicons name="close" size={14} color={BrandColors.textMuted} />
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
        <Pressable
          style={[styles.addDraftBtn, !salesEnabled && styles.buttonDisabled]}
          disabled={!salesEnabled}
          onPress={createDraft}>
          <Ionicons name="add" size={20} color="#fff" />
          <Text style={styles.addDraftBtnText}>Fiche</Text>
        </Pressable>
      </View>

      <FlatList
        data={products}
        keyExtractor={(p) => String(p.id)}
        numColumns={2}
        style={styles.productList}
        contentContainerStyle={styles.grid}
        columnWrapperStyle={styles.gridRow}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        renderItem={({ item }) => {
          const inCart = quantityInCart(item);
          const sellable = productSellable(item);
          const tileColor = item.cardColor?.trim() || DEFAULT_PRODUCT_TILE_COLOR;
          const fg = textColorForBackground(tileColor);
          const disabled = !sellable || !salesEnabled;
          return (
            <Pressable
              disabled={disabled}
              style={({ pressed }) => [
                styles.productCard,
                { backgroundColor: tileColor, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 },
              ]}
              onPress={() => addProduct(item)}>
              {inCart > 0 ? (
                <View style={[styles.productBadge, { backgroundColor: BrandColors.primary }]}>
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
            <Ionicons name="storefront-outline" size={40} color="#9AA0A6" />
            <Text style={styles.emptyStateText}>Aucun produit disponible</Text>
          </View>
        }
      />

      <Pressable
        style={[styles.cartButton, !salesEnabled && styles.cartButtonEmpty]}
        onPress={() => {
          if (!salesEnabled) {
            refuseClosedCaisse();
            return;
          }
          setCartVisible(true);
        }}>
        <Ionicons name="cart-outline" size={20} color="#ffffff" />
        <Text style={styles.cartButtonText}>
          {cart.length === 0
            ? drafts.length > 1
              ? `Fiches (${drafts.length}) · monnaie / restes`
              : 'Panier · monnaie / restes'
            : `${clientName || 'Panier'} (${cartItemCount}) — ${formatMoney(cartTotal)}${
                drafts.length > 1 ? ` · ${drafts.length} fiches` : ''
              }`}
        </Text>
      </Pressable>

      <ModalShell
        visible={cartVisible}
        onRequestClose={() => setCartVisible(false)}
        body={
          <FlatList
            data={cart}
            keyExtractor={(l) => String(l.productSaleUnitId)}
            style={styles.cartList}
            contentContainerStyle={styles.cartListContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            ListHeaderComponent={
              <View style={styles.cartListHeader}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.draftsRow}
                  keyboardShouldPersistTaps="handled">
                  {drafts.map((d, idx) => {
                    const active = d.id === activeDraftId;
                    return (
                      <Pressable
                        key={d.id}
                        onPress={() => selectDraft(d.id)}
                        style={[styles.draftChip, active && styles.draftChipActive]}>
                        <Text
                          style={[styles.draftChipText, active && styles.draftChipTextActive]}
                          numberOfLines={1}>
                          {d.name || `Fiche ${idx + 1}`}
                        </Text>
                      </Pressable>
                    );
                  })}
                  <Pressable
                    style={[styles.draftChip, styles.draftChipAdd]}
                    disabled={!salesEnabled}
                    onPress={createDraft}>
                    <Text style={styles.draftChipText}>+ Fiche</Text>
                  </Pressable>
                </ScrollView>
              </View>
            }
            ListFooterComponent={
              <View style={styles.gapsBlock}>
                {cashGaps.changeOwed.length > 0 || cashGaps.balanceOwed.length > 0 ? (
                  <TextInput
                    style={styles.gapsSearch}
                    placeholder="Rechercher (#fiche, client…)"
                    placeholderTextColor={BrandColors.textMuted}
                    value={cashGapQuery}
                    onChangeText={setCashGapQuery}
                    autoCorrect={false}
                    clearButtonMode="while-editing"
                  />
                ) : null}
                <Text style={styles.gapsTitle}>Monnaie à rendre</Text>
                {cashGaps.changeOwed.length === 0 ? (
                  <Text style={styles.gapsEmpty}>Aucune</Text>
                ) : filteredCashGaps.changeOwed.length === 0 ? (
                  <Text style={styles.gapsEmpty}>Aucun résultat</Text>
                ) : (
                  filteredCashGaps.changeOwed.map((row) => renderCashGapRow(row, 'change'))
                )}
                <Text style={[styles.gapsTitle, { marginTop: Spacing.three }]}>
                  Restes à encaisser
                </Text>
                {cashGaps.balanceOwed.length === 0 ? (
                  <Text style={styles.gapsEmpty}>Aucun</Text>
                ) : filteredCashGaps.balanceOwed.length === 0 ? (
                  <Text style={styles.gapsEmpty}>Aucun résultat</Text>
                ) : (
                  filteredCashGaps.balanceOwed.map((row) => renderCashGapRow(row, 'balance'))
                )}
              </View>
            }
            renderItem={({ item }) => {
              const product = productsById.get(item.productId);
              const price = effectiveUnitPrice(product, item, familyQtyMap);
              return (
                <View style={styles.cartRow}>
                  <View style={styles.cartRowInfo}>
                    <Text style={styles.cartRowLabel} numberOfLines={2}>
                      {item.label}
                    </Text>
                    {mode === 'special' ? (
                      <TextInput
                        style={styles.priceInput}
                        keyboardType="decimal-pad"
                        placeholder="Prix unitaire"
                        placeholderTextColor={BrandColors.textMuted}
                        value={item.manualUnitPrice != null ? String(item.manualUnitPrice) : ''}
                        onChangeText={(v) =>
                          updateActiveDraft((d) => ({
                            ...d,
                            cart: setCartLineManualPrice(d.cart, item.productSaleUnitId, v),
                          }))
                        }
                      />
                    ) : (
                      <Text style={styles.cartRowMeta}>{formatMoney(price)} / unité</Text>
                    )}
                  </View>
                  <View style={styles.qtyControls}>
                    <Pressable onPress={() => bumpQty(item.productSaleUnitId, -0.5)} hitSlop={8}>
                      <Ionicons name="remove-circle-outline" size={24} color={BrandColors.primary} />
                    </Pressable>
                    <TextInput
                      style={styles.qtyInput}
                      keyboardType="decimal-pad"
                      value={qtyDrafts[item.productSaleUnitId] ?? String(item.quantity)}
                      onChangeText={(v) =>
                        setQtyDrafts((prev) => ({ ...prev, [item.productSaleUnitId]: v }))
                      }
                      onBlur={() => {
                        const raw = (qtyDrafts[item.productSaleUnitId] ?? '').replace(',', '.');
                        const n = Number(raw);
                        if (Number.isFinite(n)) {
                          updateActiveDraft((d) => ({
                            ...d,
                            cart: setCartLineQty(d.cart, products, item.productSaleUnitId, n),
                          }));
                        }
                        setQtyDrafts((prev) => {
                          const next = { ...prev };
                          delete next[item.productSaleUnitId];
                          return next;
                        });
                      }}
                    />
                    <Pressable onPress={() => bumpQty(item.productSaleUnitId, 0.5)} hitSlop={8}>
                      <Ionicons name="add-circle-outline" size={24} color={BrandColors.primary} />
                    </Pressable>
                  </View>
                  <MoneyText value={price * item.quantity} style={styles.cartRowTotal} />
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyCart}>
                <Ionicons name="cart-outline" size={36} color="#9AA0A6" />
                <Text style={styles.emptyStateText}>Panier vide</Text>
              </View>
            }
          />
        }
        footer={
          <View style={styles.cartFooter}>
            <View style={styles.inputWrapper}>
              <Ionicons name="person-outline" size={18} color="#9AA0A6" />
              <TextInput
                style={styles.input}
                placeholder="Nom fiche / client"
                placeholderTextColor={BrandColors.textMuted}
                value={nameDraft}
                onChangeText={setNameDraft}
                onBlur={commitNameDraft}
                onSubmitEditing={commitNameDraft}
                returnKeyType="done"
                blurOnSubmit
              />
            </View>

            <View style={styles.paymentRow}>
              {PAYMENT_OPTIONS.map(({ method, label, icon }) => {
                const active = paymentMethod === method;
                return (
                  <Pressable
                    key={method}
                    onPress={() =>
                      updateActiveDraft((d) => ({
                        ...d,
                        paymentMethod: method,
                        ...(method !== 'BANK' ? { bankId: '' as const, bankAccountId: '' as const } : {}),
                      }))
                    }
                    style={[styles.paymentButton, active && styles.paymentButtonActive]}>
                    <Ionicons name={icon} size={16} color={active ? '#ffffff' : '#60646C'} />
                    <Text style={[styles.paymentLabel, active && styles.paymentLabelActive]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {paymentMethod === 'BANK' ? (
              <View style={styles.bankBlock}>
                <Text style={styles.bankLabel}>Banque</Text>
                <View style={styles.paymentRow}>
                  {banks.length === 0 ? (
                    <Text style={styles.tenderWarn}>Aucune banque configurée</Text>
                  ) : (
                    banks.map((bank) => {
                      const active = selectedBankId === bank.id;
                      return (
                        <Pressable
                          key={bank.id}
                          onPress={() =>
                            updateActiveDraft((d) => ({ ...d, bankId: bank.id, bankAccountId: '' }))
                          }
                          style={[styles.bankChip, active && styles.bankChipActive]}>
                          <Text style={[styles.bankChipText, active && styles.bankChipTextActive]}>
                            {bank.name}
                          </Text>
                        </Pressable>
                      );
                    })
                  )}
                </View>
                <Text style={styles.bankLabel}>Compte</Text>
                <View style={styles.paymentRow}>
                  {selectedBankId === '' ? (
                    <Text style={styles.tenderWarn}>Choisissez une banque</Text>
                  ) : bankAccounts.length === 0 ? (
                    <Text style={styles.tenderWarn}>Aucun compte actif</Text>
                  ) : (
                    bankAccounts.map((account) => {
                      const active = selectedBankAccountId === account.id;
                      return (
                        <Pressable
                          key={account.id}
                          onPress={() =>
                            updateActiveDraft((d) => ({ ...d, bankAccountId: account.id }))
                          }
                          style={[styles.bankChip, active && styles.bankChipActive]}>
                          <Text style={[styles.bankChipText, active && styles.bankChipTextActive]}>
                            {account.name}
                            {account.accountNumber ? ` (${account.accountNumber})` : ''}
                          </Text>
                        </Pressable>
                      );
                    })
                  )}
                </View>
              </View>
            ) : null}

            {showTenderField ? (
              <View style={styles.inputWrapper}>
                <Ionicons name="cash-outline" size={18} color="#9AA0A6" />
                <TextInput
                  style={styles.input}
                  placeholder="Montant reçu"
                  placeholderTextColor={BrandColors.textMuted}
                  keyboardType="decimal-pad"
                  value={amountReceived}
                  onChangeText={setAmountReceived}
                />
              </View>
            ) : null}

            {tenderPreview ? (
              <View style={styles.tenderMeta}>
                {tenderPreview.changeDue > 0.009 ? (
                  <Text style={styles.tenderOk}>Monnaie : {formatMoney(tenderPreview.changeDue)}</Text>
                ) : null}
                {tenderPreview.balanceDue > 0.009 ? (
                  <Text style={styles.tenderWarn}>
                    Reste dû : {formatMoney(tenderPreview.balanceDue)}
                  </Text>
                ) : null}
              </View>
            ) : null}

            <Pressable onPress={() => setPrintTicket((v) => !v)} style={styles.printToggle}>
              <Ionicons
                name={printTicket ? 'checkbox' : 'square-outline'}
                size={20}
                color={BrandColors.primary}
              />
              <Text style={styles.printToggleLabel}>Imprimer le ticket</Text>
            </Pressable>

            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <MoneyText value={cartTotal} style={styles.totalValue} />
            </View>

            <View style={styles.actionsRow}>
              <Pressable style={styles.clearButton} onPress={clearActiveCart}>
                <Ionicons name="trash-outline" size={18} color={DANGER} />
                <Text style={styles.clearButtonText}>Vider</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.checkoutButton,
                  (submitting || cart.length === 0 || !salesEnabled || !bankReady) &&
                    styles.buttonDisabled,
                ]}
                onPress={() => void checkout()}
                disabled={submitting || cart.length === 0 || !salesEnabled || !bankReady}>
                <Ionicons name="checkmark-circle-outline" size={20} color="#ffffff" />
                <Text style={styles.checkoutButtonText}>
                  {submitting ? 'Encaissement…' : 'Encaisser'}
                </Text>
              </Pressable>
            </View>
          </View>
        }>
        <View style={styles.cartHeader}>
          <Text style={styles.cartTitle}>Panier</Text>
          <View style={styles.cartHeaderActions}>
            <Pressable
              style={[styles.addDraftBtnSm, !salesEnabled && styles.buttonDisabled]}
              disabled={!salesEnabled}
              onPress={createDraft}>
              <Text style={styles.addDraftBtnText}>+ Fiche</Text>
            </Pressable>
            <Pressable onPress={() => setCartVisible(false)} hitSlop={12} style={styles.closeButton}>
              <Ionicons name="close" size={22} color="#60646C" />
            </Pressable>
          </View>
        </View>
      </ModalShell>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  blocked: { flex: 1, justifyContent: 'center', padding: Spacing.five, gap: Spacing.two },
  blockedTitle: { fontSize: 22, fontWeight: '700', color: BrandColors.text, textAlign: 'center' },
  blockedText: { fontSize: 15, color: BrandColors.textMuted, textAlign: 'center', lineHeight: 22 },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.two,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    borderRadius: Spacing.two,
    backgroundColor: BrandColors.surface,
  },
  statusText: { flex: 1, color: BrandColors.text, fontSize: 13 },
  pendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    backgroundColor: WARNING_BG,
  },
  pendingBadgeText: { color: WARNING, flex: 1, fontSize: 13 },
  modeBanner: {
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    padding: Spacing.two,
    borderRadius: 10,
    backgroundColor: BrandColors.primarySoft,
  },
  modeBannerText: { color: BrandColors.primaryHover, fontWeight: '700', fontSize: 13 },
  productList: { flex: 1 },
  grid: { padding: Spacing.three, flexGrow: 1 },
  gridRow: { gap: Spacing.three },
  productCard: {
    flex: 1,
    marginBottom: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    minHeight: 110,
    justifyContent: 'space-between',
  },
  productBadge: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 5,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  productBadgeText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  productName: { fontWeight: '700', fontSize: 15 },
  productPrice: { fontWeight: '700', marginTop: Spacing.two },
  emptyState: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.six },
  emptyStateText: { textAlign: 'center', color: BrandColors.textMuted },
  cartButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: BrandColors.primary,
    margin: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  cartButtonEmpty: { backgroundColor: '#9AA0A6' },
  cartButtonText: { color: '#ffffff', fontWeight: '600', fontSize: 16 },
  cartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  cartTitle: { fontSize: 20, fontWeight: '700', color: BrandColors.text },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#0000000A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartList: { flex: 1 },
  cartListContent: { paddingHorizontal: Spacing.three, gap: Spacing.two, flexGrow: 1 },
  emptyCart: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.six },
  cartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
    backgroundColor: BrandColors.surface,
    borderWidth: 1,
    borderColor: BrandColors.border,
    marginBottom: Spacing.two,
  },
  cartRowInfo: { flex: 1, gap: 4 },
  cartRowLabel: { fontWeight: '600', color: BrandColors.text },
  cartRowMeta: { fontSize: 13, color: BrandColors.textMuted },
  priceInput: {
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 14,
    color: BrandColors.text,
  },
  cartRowTotal: { width: 70, textAlign: 'right', fontWeight: '700', color: BrandColors.text },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  qtyInput: {
    minWidth: 44,
    textAlign: 'center',
    fontWeight: '600',
    borderWidth: 1,
    borderColor: BrandColors.border,
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 6,
    color: BrandColors.text,
  },
  cartFooter: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
    gap: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BrandColors.border,
    backgroundColor: BrandColors.bg,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
    backgroundColor: BrandColors.surface,
  },
  input: { flex: 1, paddingVertical: Spacing.three, color: BrandColors.text },
  paymentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  paymentButton: {
    flexGrow: 1,
    flexBasis: '22%',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
  },
  paymentButtonActive: {
    backgroundColor: BrandColors.primary,
    borderColor: BrandColors.primary,
  },
  paymentLabel: { fontSize: 12, color: BrandColors.text },
  paymentLabelActive: { color: '#ffffff', fontWeight: '600' },
  bankBlock: { gap: Spacing.two },
  bankLabel: { fontSize: 12, fontWeight: '700', color: BrandColors.textMuted },
  bankChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    backgroundColor: BrandColors.surface,
  },
  bankChipActive: { backgroundColor: BrandColors.primary, borderColor: BrandColors.primary },
  bankChipText: { color: BrandColors.text, fontWeight: '600', fontSize: 12 },
  bankChipTextActive: { color: '#fff' },
  tenderMeta: { gap: 4 },
  tenderOk: { color: BrandColors.ok, fontWeight: '600' },
  tenderWarn: { color: BrandColors.primaryHover, fontWeight: '600' },
  printToggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  printToggleLabel: { color: BrandColors.text, fontWeight: '600' },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: { color: BrandColors.textMuted, fontSize: 16 },
  totalValue: { fontSize: 28, fontWeight: '700', color: BrandColors.text },
  actionsRow: { flexDirection: 'row', gap: Spacing.two },
  clearButton: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderColor: DANGER,
  },
  clearButtonText: { color: DANGER, fontWeight: '600' },
  checkoutButton: {
    flex: 2,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    backgroundColor: BrandColors.primary,
  },
  buttonDisabled: { opacity: 0.5 },
  checkoutButtonText: { color: '#ffffff', fontWeight: '600', fontSize: 16 },
  draftsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  draftsRow: { alignItems: 'center', gap: Spacing.two, paddingRight: Spacing.two },
  draftChipWrap: { flexDirection: 'row', alignItems: 'center' },
  draftChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    backgroundColor: BrandColors.surface,
    maxWidth: 160,
  },
  draftChipActive: { backgroundColor: BrandColors.primary, borderColor: BrandColors.primary },
  draftChipAdd: { borderStyle: 'dashed' },
  draftChipText: { fontWeight: '600', color: BrandColors.text, fontSize: 13 },
  draftChipTextActive: { color: '#fff' },
  draftDel: { marginLeft: 2, padding: 4 },
  addDraftBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: BrandColors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  addDraftBtnSm: {
    backgroundColor: BrandColors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    marginRight: 8,
  },
  addDraftBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  cartHeaderActions: { flexDirection: 'row', alignItems: 'center' },
  cartListHeader: { marginBottom: Spacing.two },
  gapsBlock: {
    marginTop: Spacing.four,
    marginBottom: Spacing.three,
    padding: Spacing.three,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BrandColors.border,
    backgroundColor: BrandColors.surface,
    gap: Spacing.two,
  },
  gapsSearch: {
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: BrandColors.text,
    backgroundColor: BrandColors.surface,
    marginBottom: Spacing.one,
  },
  gapsTitle: { fontWeight: '700', color: BrandColors.text, fontSize: 15 },
  gapsEmpty: { color: BrandColors.textMuted, fontSize: 13 },
  gapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 6,
  },
  gapInfo: { flex: 1, gap: 2 },
  gapTitle: { fontWeight: '600', color: BrandColors.text },
  gapAmount: { fontWeight: '700', color: BrandColors.primaryHover },
  gapBtn: {
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 88,
    alignItems: 'center',
    backgroundColor: BrandColors.bg,
  },
  gapBtnPrimary: { backgroundColor: BrandColors.primary, borderColor: BrandColors.primary },
  gapBtnText: { fontWeight: '700', color: BrandColors.text, fontSize: 13 },
  gapBtnTextPrimary: { color: '#fff' },

});
