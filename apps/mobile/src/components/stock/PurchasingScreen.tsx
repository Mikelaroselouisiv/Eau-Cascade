import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { KpiCard } from '@/components/monitor/KpiCard';
import { ModalShell } from '@/components/ModalShell';
import { Screen } from '@/components/Screen';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useCompanyScope } from '@/hooks/useCompanyScope';
import {
  createPurchaseOrder,
  deleteGoodsReceipt,
  deletePurchaseOrder,
  getDepartments,
  getProducts,
  getPurchaseOrder,
  getPurchaseOrdersAmountSummary,
  listPurchaseOrders,
  receivePurchaseOrder,
} from '@/services/api';
import type {
  Department,
  Product,
  PurchaseOrderDetail,
  PurchaseOrderListItem,
  PurchaseOrdersAmountSummary,
  ReceptionStatus,
} from '@/types/api';
import { formatDateTime, formatMoney } from '@/utils/datetime';
import { stockPackagingLabel } from '@/utils/packaging';
import { formatQuantity } from '@/utils/quantity';

type LineDraft = { productId: number | ''; qty: string; unitCost: string };

const emptyLine = (): LineDraft => ({ productId: '', qty: '', unitCost: '' });

function receptionLabel(s: ReceptionStatus | undefined): string {
  switch (s) {
    case 'partial':
      return 'Partiel';
    case 'complete':
      return 'Complet';
    default:
      return 'En attente';
  }
}

function poStatusLabel(s: PurchaseOrderListItem['status']): string {
  switch (s) {
    case 'ORDERED':
      return 'Confirmé';
    case 'CLOSED':
      return 'Clôturé';
    case 'CANCELLED':
      return 'Annulé';
    default:
      return 'Brouillon';
  }
}

export function PurchasingScreen() {
  const { can, canPerm } = useAuth();
  const { companyId, ready } = useCompanyScope();
  const isAdmin = can(['ADMIN']) || canPerm('*');
  const allowed =
    can(['ADMIN', 'MANAGER', 'STOCK_MANAGER']) || canPerm('purchasing.manage');

  const [departments, setDepartments] = useState<Department[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<PurchaseOrderListItem[]>([]);
  const [amountSummary, setAmountSummary] = useState<PurchaseOrdersAmountSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const [filterDeptId, setFilterDeptId] = useState<number | ''>('');
  const [filterReception, setFilterReception] = useState<ReceptionStatus | ''>('');
  const [search, setSearch] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [poDeptId, setPoDeptId] = useState<number | ''>('');
  const [poSupplier, setPoSupplier] = useState('');
  const [poRef, setPoRef] = useState('');
  const [poLines, setPoLines] = useState<LineDraft[]>([emptyLine()]);

  const [activeOrder, setActiveOrder] = useState<PurchaseOrderDetail | null>(null);
  const [receiveQty, setReceiveQty] = useState<Record<number, string>>({});
  const [receiveCost, setReceiveCost] = useState<Record<number, string>>({});
  const [receiveNote, setReceiveNote] = useState('');

  const load = useCallback(async () => {
    if (!allowed || companyId == null) return;
    try {
      setError(null);
      const [depts, prods, list] = await Promise.all([
        getDepartments(companyId),
        getProducts(),
        listPurchaseOrders(companyId),
      ]);
      setDepartments(depts);
      setProducts(prods);
      setOrders(list);
      setPoDeptId((prev) => (prev !== '' && depts.some((d) => d.id === prev) ? prev : (depts[0]?.id ?? '')));
      if (isAdmin) {
        try {
          setAmountSummary(await getPurchaseOrdersAmountSummary(companyId));
        } catch {
          setAmountSummary(null);
        }
      } else {
        setAmountSummary(null);
      }
    } catch {
      setError('Impossible de charger les achats');
    }
  }, [allowed, companyId, isAdmin]);

  useFocusEffect(
    useCallback(() => {
      if (!ready) return;
      void load();
    }, [load, ready]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const productsForDept = useCallback(
    (deptId: number | '') => {
      if (deptId === '') return [];
      return products.filter((p) => p.department?.id === deptId && p.trackStock && !p.isService);
    },
    [products],
  );

  const ordersFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (filterDeptId !== '' && o.department.id !== filterDeptId) return false;
      if (filterReception !== '' && o.receptionStatus !== filterReception) return false;
      if (!q) return true;
      const ref = (o.reference ?? '').toLowerCase();
      const supplier = (o.supplierName ?? '').toLowerCase();
      return ref.includes(q) || supplier.includes(q);
    });
  }, [orders, filterDeptId, filterReception, search]);

  async function openOrder(id: number) {
    setBusy(true);
    setStatus(null);
    try {
      const detail = await getPurchaseOrder(id);
      setActiveOrder(detail);
      const qty: Record<number, string> = {};
      const cost: Record<number, string> = {};
      for (const line of detail.lines) {
        qty[line.productId] = '';
        cost[line.productId] = line.unitPriceEst != null ? String(line.unitPriceEst) : '';
      }
      setReceiveQty(qty);
      setReceiveCost(cost);
      setReceiveNote('');
    } catch {
      setError('Impossible d’ouvrir la commande');
    } finally {
      setBusy(false);
    }
  }

  async function submitCreate() {
    if (companyId == null || poDeptId === '') {
      setStatus('Département requis');
      return;
    }
    const lines = poLines
      .map((l) => ({
        productId: typeof l.productId === 'number' ? l.productId : 0,
        quantityOrdered: Number(l.qty.replace(',', '.')),
        unitPriceEst: l.unitCost.trim() ? Number(l.unitCost.replace(',', '.')) : undefined,
      }))
      .filter((l) => l.productId > 0 && Number.isFinite(l.quantityOrdered) && l.quantityOrdered > 0);
    if (lines.length === 0) {
      setStatus('Au moins une ligne valide');
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      await createPurchaseOrder({
        companyId,
        departmentId: poDeptId,
        supplierName: poSupplier.trim() || undefined,
        reference: poRef.trim() || undefined,
        lines,
      });
      setPoLines([emptyLine()]);
      setPoSupplier('');
      setPoRef('');
      setShowCreate(false);
      setStatus('Commande créée');
      await load();
    } catch {
      setStatus('Création impossible');
    } finally {
      setBusy(false);
    }
  }

  async function submitReceive() {
    if (!activeOrder) return;
    const receptionReadOnly =
      activeOrder.status === 'CLOSED' || activeOrder.receptionStatus === 'complete';
    if (receptionReadOnly) return;

    const lines = activeOrder.lines
      .map((line) => {
        const rawQty = (receiveQty[line.productId] ?? '').trim().replace(',', '.');
        if (!rawQty) return null;
        const quantity = Number(rawQty);
        if (!Number.isFinite(quantity) || quantity <= 0) return null;
        if (isAdmin) {
          const unitCost = Number((receiveCost[line.productId] ?? '').trim().replace(',', '.'));
          if (!Number.isFinite(unitCost) || unitCost < 0) return null;
          return { productId: line.productId, quantity, unitCost };
        }
        return { productId: line.productId, quantity };
      })
      .filter((l): l is { productId: number; quantity: number; unitCost?: number } => l != null);

    if (lines.length === 0) {
      setStatus(isAdmin ? 'Quantité et prix requis' : 'Quantité requise');
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      const updated = await receivePurchaseOrder(activeOrder.id, {
        note: receiveNote.trim() || undefined,
        lines,
      });
      setStatus(
        updated.receptionStatus === 'complete' ? 'Réception complète' : 'Réception enregistrée',
      );
      setActiveOrder(updated);
      const qty: Record<number, string> = {};
      for (const line of updated.lines) qty[line.productId] = '';
      setReceiveQty(qty);
      await load();
    } catch {
      setStatus('Réception impossible');
    } finally {
      setBusy(false);
    }
  }

  function confirmDeleteOrder(order: PurchaseOrderListItem) {
    if (!isAdmin || order.receptionStatus !== 'pending') return;
    Alert.alert('Supprimer', `Supprimer la commande « ${order.reference ?? `#${order.id}`} » ?`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusy(true);
            try {
              await deletePurchaseOrder(order.id);
              if (activeOrder?.id === order.id) setActiveOrder(null);
              setStatus('Commande supprimée');
              await load();
            } catch {
              setStatus('Suppression impossible');
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  }

  function confirmDeleteReceipt(receiptId: number) {
    if (!isAdmin || !activeOrder) return;
    Alert.alert('Supprimer réception', 'Le stock sera ajusté. Continuer ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusy(true);
            try {
              const updated = await deleteGoodsReceipt(receiptId);
              setActiveOrder(updated);
              setStatus('Réception supprimée');
              await load();
            } catch {
              setStatus('Suppression impossible');
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  }

  if (!allowed) {
    return (
      <Screen>
        <View style={styles.blocked}>
          <Text style={styles.blockedText}>Stocks réservés aux rôles stock / gestion.</Text>
        </View>
      </Screen>
    );
  }

  if (ready && companyId == null) {
    return (
      <Screen>
        <View style={styles.blocked}>
          <Text style={styles.blockedText}>Aucune entreprise disponible pour les achats.</Text>
        </View>
      </Screen>
    );
  }

  if (companyId == null) {
    return (
      <Screen>
        <View style={styles.blocked}>
          <ActivityIndicator color={BrandColors.accent} />
        </View>
      </Screen>
    );
  }

  const receptionReadOnly =
    activeOrder?.status === 'CLOSED' || activeOrder?.receptionStatus === 'complete';

  return (
    <Screen keyboard={showCreate || activeOrder != null}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {status ? <Text style={styles.status}>{status}</Text> : null}

      <FlatList
        data={ordersFiltered}
        keyExtractor={(o) => String(o.id)}
        contentContainerStyle={styles.list}
        refreshing={refreshing}
        onRefresh={() => void onRefresh()}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            {isAdmin && amountSummary ? (
              <View style={styles.kpiGrid}>
                <KpiCard
                  label="Commandé (est.)"
                  value={amountSummary.amountOrderedEst}
                  money
                  hint={`${amountSummary.orderCount} cmd`}
                />
                <KpiCard
                  label="Reçu"
                  value={amountSummary.amountReceived}
                  money
                  hint={`${amountSummary.completeCount} complètes`}
                />
                <KpiCard
                  label="Reste (est.)"
                  value={amountSummary.amountPendingEst}
                  money
                  tone="warn"
                />
              </View>
            ) : null}

            <TextInput
              style={styles.input}
              placeholder="Rechercher réf. / fournisseur…"
              placeholderTextColor={BrandColors.textMuted}
              value={search}
              onChangeText={setSearch}
            />

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
              <Chip
                label="Tous dépts"
                active={filterDeptId === ''}
                onPress={() => setFilterDeptId('')}
              />
              {departments.map((d) => (
                <Chip
                  key={d.id}
                  label={d.name}
                  active={filterDeptId === d.id}
                  onPress={() => setFilterDeptId(d.id)}
                />
              ))}
            </ScrollView>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
              {(
                [
                  ['', 'Toutes'],
                  ['pending', 'En attente'],
                  ['partial', 'Partiel'],
                  ['complete', 'Complet'],
                ] as const
              ).map(([v, label]) => (
                <Chip
                  key={label}
                  label={label}
                  active={filterReception === v}
                  onPress={() => setFilterReception(v)}
                />
              ))}
            </ScrollView>

            {isAdmin ? (
              <Pressable
                style={styles.primaryBtn}
                onPress={() => {
                  setStatus(null);
                  setShowCreate(true);
                }}>
                <Text style={styles.primaryBtnText}>+ Commande</Text>
              </Pressable>
            ) : null}

            <Text style={styles.section}>{ordersFiltered.length} commande(s)</Text>
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>Aucune commande</Text>}
        renderItem={({ item: o }) => {
          const canReceive =
            o.status !== 'CANCELLED' &&
            o.receptionStatus !== 'complete' &&
            o.status !== 'CLOSED';
          return (
            <Pressable style={styles.card} onPress={() => void openOrder(o.id)} disabled={busy}>
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {o.reference ?? `#${o.id}`}
                </Text>
                <Text style={styles.badge}>{receptionLabel(o.receptionStatus)}</Text>
              </View>
              <Text style={styles.meta}>
                {o.supplierName || 'Sans fournisseur'} · {o.department.name}
              </Text>
              <Text style={styles.meta}>
                {formatDateTime(o.createdAt)} · {poStatusLabel(o.status)}
              </Text>
              {isAdmin ? (
                <Text style={styles.amounts}>
                  Cmd {formatMoney(o.amountOrderedEst)} · Reçu {formatMoney(o.amountReceived)} · Reste{' '}
                  {formatMoney(o.amountPendingEst)}
                </Text>
              ) : null}
              <View style={styles.rowActions}>
                <Text style={styles.link}>{canReceive ? 'Réception' : 'Voir'}</Text>
                {isAdmin && o.receptionStatus === 'pending' ? (
                  <Pressable onPress={() => confirmDeleteOrder(o)}>
                    <Text style={styles.danger}>Supprimer</Text>
                  </Pressable>
                ) : null}
              </View>
            </Pressable>
          );
        }}
      />

      <ModalShell
        visible={showCreate}
        onRequestClose={() => setShowCreate(false)}
        body={
          <ScrollView
            contentContainerStyle={styles.modalBody}
            keyboardShouldPersistTaps="handled">
            <Text style={styles.fieldLabel}>Département</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
              {departments.map((d) => (
                <Chip
                  key={d.id}
                  label={d.name}
                  active={poDeptId === d.id}
                  onPress={() => {
                    setPoDeptId(d.id);
                    setPoLines([emptyLine()]);
                  }}
                />
              ))}
            </ScrollView>
            <TextInput
              style={styles.input}
              placeholder="Fournisseur"
              placeholderTextColor={BrandColors.textMuted}
              value={poSupplier}
              onChangeText={setPoSupplier}
            />
            <TextInput
              style={styles.input}
              placeholder="Référence"
              placeholderTextColor={BrandColors.textMuted}
              value={poRef}
              onChangeText={setPoRef}
            />
            {poLines.map((row, idx) => (
              <View key={idx} style={styles.lineBlock}>
                <Text style={styles.fieldLabel}>Produit</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
                  {productsForDept(poDeptId).map((p) => (
                    <Chip
                      key={p.id}
                      label={`${p.name} · ${stockPackagingLabel(p)}`}
                      active={row.productId === p.id}
                      onPress={() => {
                        const next = [...poLines];
                        next[idx] = { ...next[idx], productId: p.id };
                        setPoLines(next);
                      }}
                    />
                  ))}
                </ScrollView>
                <View style={styles.row2}>
                  <TextInput
                    style={[styles.input, styles.flex]}
                    placeholder="Qté"
                    placeholderTextColor={BrandColors.textMuted}
                    keyboardType="decimal-pad"
                    value={row.qty}
                    onChangeText={(t) => {
                      const next = [...poLines];
                      next[idx] = { ...next[idx], qty: t };
                      setPoLines(next);
                    }}
                  />
                  <TextInput
                    style={[styles.input, styles.flex]}
                    placeholder="Prix / u."
                    placeholderTextColor={BrandColors.textMuted}
                    keyboardType="decimal-pad"
                    value={row.unitCost}
                    onChangeText={(t) => {
                      const next = [...poLines];
                      next[idx] = { ...next[idx], unitCost: t };
                      setPoLines(next);
                    }}
                  />
                </View>
                {poLines.length > 1 ? (
                  <Pressable onPress={() => setPoLines(poLines.filter((_, i) => i !== idx))}>
                    <Text style={styles.danger}>Retirer la ligne</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
            <Pressable style={styles.secondaryBtn} onPress={() => setPoLines([...poLines, emptyLine()])}>
              <Text style={styles.secondaryBtnText}>+ Ligne</Text>
            </Pressable>
          </ScrollView>
        }
        footer={
          <View style={styles.footer}>
            <Pressable
              style={[styles.primaryBtn, busy && styles.disabled]}
              disabled={busy}
              onPress={() => void submitCreate()}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Créer</Text>}
            </Pressable>
          </View>
        }>
        <View style={styles.modalTop}>
          <Text style={styles.modalTopTitle}>Nouvelle commande</Text>
          <Pressable onPress={() => setShowCreate(false)} hitSlop={12}>
            <Text style={styles.modalClose}>Fermer</Text>
          </Pressable>
        </View>
      </ModalShell>

      <ModalShell
        visible={activeOrder != null}
        onRequestClose={() => setActiveOrder(null)}
        body={
          activeOrder ? (
            <ScrollView
              contentContainerStyle={styles.modalBody}
              keyboardShouldPersistTaps="handled">
              <Text style={styles.meta}>
                {receptionLabel(activeOrder.receptionStatus)} · {poStatusLabel(activeOrder.status)}
              </Text>
              {isAdmin ? (
                <Text style={styles.amounts}>
                  Cmd {formatMoney(activeOrder.amountOrderedEst)} · Reçu{' '}
                  {formatMoney(activeOrder.amountReceived)} · Reste{' '}
                  {formatMoney(activeOrder.amountPendingEst)}
                </Text>
              ) : null}

              {activeOrder.lines.map((line) => {
                const editable = !receptionReadOnly && line.quantityRemaining > 0;
                return (
                  <View key={line.id} style={styles.lineCard}>
                    <Text style={styles.cardTitle}>{line.product.name}</Text>
                    <Text style={styles.meta}>
                      Cmd {formatQuantity(line.quantityOrdered)} · Reçu{' '}
                      {formatQuantity(line.quantityReceived)} · Reste{' '}
                      {formatQuantity(line.quantityRemaining)}
                    </Text>
                    {editable ? (
                      <View style={styles.row2}>
                        <TextInput
                          style={[styles.input, styles.flex]}
                          placeholder="Qté à recevoir"
                          placeholderTextColor={BrandColors.textMuted}
                          keyboardType="decimal-pad"
                          value={receiveQty[line.productId] ?? ''}
                          onChangeText={(t) =>
                            setReceiveQty((prev) => ({ ...prev, [line.productId]: t }))
                          }
                        />
                        {isAdmin ? (
                          <TextInput
                            style={[styles.input, styles.flex]}
                            placeholder="Prix / u."
                            placeholderTextColor={BrandColors.textMuted}
                            keyboardType="decimal-pad"
                            value={receiveCost[line.productId] ?? ''}
                            onChangeText={(t) =>
                              setReceiveCost((prev) => ({ ...prev, [line.productId]: t }))
                            }
                          />
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                );
              })}

              {!receptionReadOnly ? (
                <TextInput
                  style={styles.input}
                  placeholder="Note (optionnel)"
                  placeholderTextColor={BrandColors.textMuted}
                  value={receiveNote}
                  onChangeText={setReceiveNote}
                />
              ) : null}

              {isAdmin && (activeOrder.goodsReceipts?.length ?? 0) > 0 ? (
                <>
                  <Text style={styles.section}>Réceptions</Text>
                  {activeOrder.goodsReceipts!.map((r) => (
                    <View key={r.id} style={styles.lineCard}>
                      <Text style={styles.meta}>{formatDateTime(r.receivedAt)}</Text>
                      {r.lines.map((l, i) => (
                        <Text key={`${r.id}-${i}`} style={styles.meta}>
                          {l.product.name} · {formatQuantity(l.quantity)}
                          {isAdmin ? ` × ${formatMoney(l.unitCost)}` : ''}
                        </Text>
                      ))}
                      <Pressable onPress={() => confirmDeleteReceipt(r.id)}>
                        <Text style={styles.danger}>Annuler réception</Text>
                      </Pressable>
                    </View>
                  ))}
                </>
              ) : null}
            </ScrollView>
          ) : null
        }
        footer={
          <View style={styles.footer}>
            {!receptionReadOnly ? (
              <Pressable
                style={[styles.primaryBtn, busy && styles.disabled]}
                disabled={busy}
                onPress={() => void submitReceive()}>
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryBtnText}>Enregistrer réception</Text>
                )}
              </Pressable>
            ) : (
              <Pressable style={styles.secondaryBtn} onPress={() => setActiveOrder(null)}>
                <Text style={styles.secondaryBtnText}>Fermer</Text>
              </Pressable>
            )}
          </View>
        }>
        <View style={styles.modalTop}>
          <Text style={styles.modalTopTitle}>
            {activeOrder ? `#${activeOrder.reference ?? activeOrder.id}` : 'Commande'}
          </Text>
          <Pressable onPress={() => setActiveOrder(null)} hitSlop={12}>
            <Text style={styles.modalClose}>Fermer</Text>
          </Pressable>
        </View>
      </ModalShell>
    </Screen>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  blocked: { flex: 1, justifyContent: 'center', padding: Spacing.five },
  blockedText: { textAlign: 'center', color: BrandColors.textMuted },
  error: {
    color: BrandColors.danger,
    fontWeight: '600',
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.two,
  },
  status: {
    color: BrandColors.primaryHover,
    fontWeight: '600',
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.two,
  },
  list: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six },
  headerBlock: { gap: Spacing.two, marginBottom: Spacing.two },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  section: { fontSize: 15, fontWeight: '700', color: BrandColors.text, marginTop: Spacing.two },
  empty: { color: BrandColors.textMuted, textAlign: 'center', marginTop: Spacing.four },
  input: {
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    fontSize: 16,
    color: BrandColors.text,
    backgroundColor: BrandColors.surface,
  },
  chips: { flexGrow: 0 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    marginRight: 8,
    backgroundColor: BrandColors.surface,
    maxWidth: 220,
  },
  chipActive: { backgroundColor: BrandColors.primary, borderColor: BrandColors.primary },
  chipText: { fontWeight: '600', color: BrandColors.text, fontSize: 13 },
  chipTextActive: { color: '#fff' },
  card: {
    backgroundColor: BrandColors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: Spacing.three,
    gap: 4,
    marginBottom: Spacing.two,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  cardTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: BrandColors.text },
  badge: { fontSize: 12, fontWeight: '700', color: BrandColors.primaryHover },
  meta: { fontSize: 12, color: BrandColors.textMuted },
  amounts: { fontSize: 13, fontWeight: '600', color: BrandColors.text },
  rowActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  link: { color: BrandColors.primary, fontWeight: '700' },
  danger: { color: BrandColors.danger, fontWeight: '600' },
  primaryBtn: {
    backgroundColor: BrandColors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: BrandColors.surface,
  },
  secondaryBtnText: { fontWeight: '700', color: BrandColors.text },
  disabled: { opacity: 0.55 },
  modalTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  modalTopTitle: { fontSize: 18, fontWeight: '700', color: BrandColors.text },
  modalClose: { color: BrandColors.primary, fontWeight: '600' },
  modalBody: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.four, gap: Spacing.two },
  footer: { padding: Spacing.three, backgroundColor: BrandColors.bg, gap: Spacing.two },
  fieldLabel: { fontWeight: '600', color: BrandColors.textMuted, fontSize: 13 },
  lineBlock: { gap: Spacing.two, marginTop: Spacing.two },
  lineCard: {
    backgroundColor: BrandColors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: Spacing.three,
    gap: 6,
  },
  row2: { flexDirection: 'row', gap: Spacing.two },
  flex: { flex: 1 },
});
