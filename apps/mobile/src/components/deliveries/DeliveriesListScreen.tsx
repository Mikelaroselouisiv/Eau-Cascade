import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { MoneyText } from '@/components/MoneyText';
import { ModalShell } from '@/components/ModalShell';
import { Screen } from '@/components/Screen';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { getDeliveryById, getSaleById, listDeliveries, updateDelivery } from '@/services/api';
import { printReceipt } from '@/services/bluetooth-printer';
import { buildSaleReceiptDataFromSale } from '@/services/receipt';
import type { Delivery, DeliveryStatus } from '@/types/api';
import { formatDateTime, formatMoney } from '@/utils/datetime';
import { formatQuantity } from '@/utils/quantity';

const STATUS_LABEL: Record<DeliveryStatus, string> = {
  PENDING: 'Non livré',
  PARTIAL: 'Partiel',
  DELIVERED: 'Livré',
};

const STATUS_COLOR: Record<DeliveryStatus, string> = {
  PENDING: BrandColors.primaryHover,
  PARTIAL: '#B45309',
  DELIVERED: BrandColors.ok,
};

type Props = {
  status?: DeliveryStatus;
};

export function DeliveriesListScreen({ status }: Props) {
  const { user, canPerm } = useAuth();
  const canManage = canPerm('deliveries.manage');
  const lockedScope = user?.role === 'CASHIER' || user?.role === 'LIVREUR';
  const companyId = typeof user?.companyId === 'number' ? user.companyId : undefined;

  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Delivery[]>([]);
  const [total, setTotal] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detail, setDetail] = useState<Delivery | null>(null);
  const [qtyDrafts, setQtyDrafts] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [printingId, setPrintingId] = useState<number | null>(null);

  const load = useCallback(
    async (opts?: { append?: boolean; currentCount?: number }) => {
      if (lockedScope && companyId == null) {
        setError('Entreprise manquante pour ce compte');
        setItems([]);
        return;
      }
      try {
        setError(null);
        const skip = opts?.append ? (opts.currentCount ?? 0) : 0;
        const res = await listDeliveries({
          companyId,
          status,
          q: query || undefined,
          skip,
          take: 40,
        });
        setTotal(res.total);
        setItems((prev) => (opts?.append ? [...prev, ...res.items] : res.items));
      } catch {
        if (!opts?.append) setItems([]);
        setError('Impossible de charger les livraisons');
      }
    },
    [companyId, lockedScope, query, status],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function onEndReached() {
    if (loadingMore || items.length >= total) return;
    setLoadingMore(true);
    await load({ append: true, currentCount: items.length });
    setLoadingMore(false);
  }

  async function openDetail(row: Delivery) {
    setDetailError(null);
    try {
      const full = await getDeliveryById(row.id);
      setDetail(full);
      setQtyDrafts(
        Object.fromEntries(
          (full.items ?? []).map((it) => [it.saleItemId, String(it.quantityDelivered)]),
        ),
      );
    } catch {
      setError('Impossible d’ouvrir la fiche');
    }
  }

  async function reprintDelivery(delivery: Delivery) {
    const saleId = delivery.sale?.id ?? delivery.saleId;
    if (!saleId) {
      setError('Vente introuvable pour impression');
      return;
    }
    setPrintingId(delivery.id);
    setDetailError(null);
    try {
      const sale = await getSaleById(saleId);
      const departmentId =
        delivery.departmentId ??
        sale.items?.[0]?.product?.departmentId ??
        (typeof user?.departmentId === 'number' ? user.departmentId : undefined);
      const receipt = await buildSaleReceiptDataFromSale(sale, departmentId);
      await printReceipt(receipt);
      setError(null);
      if (detail?.id === delivery.id) {
        setDetailError(null);
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'Impossible de réimprimer la fiche';
      if (detail?.id === delivery.id) setDetailError(reason);
      else setError(reason);
    } finally {
      setPrintingId(null);
    }
  }

  async function saveDetail(markAll = false) {
    if (!detail || !canManage || detail.status === 'DELIVERED') return;
    setSaving(true);
    setDetailError(null);
    try {
      const updated = markAll
        ? await updateDelivery(detail.id, { markDelivered: true })
        : await updateDelivery(detail.id, {
            items: (detail.items ?? []).map((it) => {
              const raw = (qtyDrafts[it.saleItemId] ?? '').replace(',', '.');
              const n = Number(raw);
              return {
                saleItemId: it.saleItemId,
                quantityDelivered: Number.isFinite(n) ? n : Number(it.quantityDelivered),
              };
            }),
          });
      setDetail(updated);
      setQtyDrafts(
        Object.fromEntries(
          (updated.items ?? []).map((it) => [it.saleItemId, String(it.quantityDelivered)]),
        ),
      );
      await load();
    } catch {
      setDetailError('Enregistrement impossible');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.search}
          placeholder="N° fiche ou client…"
          placeholderTextColor={BrandColors.textMuted}
          value={q}
          onChangeText={setQ}
          returnKeyType="search"
          onSubmitEditing={() => setQuery(q.trim())}
        />
        <Pressable style={styles.searchBtn} onPress={() => setQuery(q.trim())}>
          <Text style={styles.searchBtnText}>OK</Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Text style={styles.count}>{total} livraison(s)</Text>

      <FlatList
        data={items}
        numColumns={2}
        keyExtractor={(d) => String(d.id)}
        contentContainerStyle={styles.list}
        columnWrapperStyle={styles.cardRow}
        refreshing={refreshing}
        onRefresh={() => void onRefresh()}
        onEndReached={() => void onEndReached()}
        onEndReachedThreshold={0.4}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={styles.empty}>Aucune livraison</Text>}
        ListFooterComponent={
          loadingMore ? <ActivityIndicator color={BrandColors.primary} style={{ margin: 12 }} /> : null
        }
        renderItem={({ item }) => {
          const busyPrint = printingId === item.id;
          return (
            <View style={styles.card}>
              <Pressable onPress={() => void openDetail(item)}>
                <View style={styles.cardTop}>
                  <Text style={styles.cardRef}>
                    Vente #{item.saleRef ?? item.sale?.txnNumber ?? item.sale?.id ?? item.saleId}
                  </Text>
                  <View style={[styles.badge, { backgroundColor: `${STATUS_COLOR[item.status]}22` }]}>
                    <Text style={[styles.badgeText, { color: STATUS_COLOR[item.status] }]}>
                      {STATUS_LABEL[item.status]}
                    </Text>
                  </View>
                </View>
                <Text style={styles.client} numberOfLines={2}>
                  {item.sale?.clientName?.trim() || 'Client'}
                </Text>
                <Text style={styles.meta} numberOfLines={2}>
                  {[item.company?.name, item.department?.name].filter(Boolean).join(' · ') || '—'}
                </Text>
                <View style={styles.cardFoot}>
                  <Text style={styles.meta}>
                    {formatDateTime(item.sale?.createdAt ?? item.createdAt)}
                  </Text>
                  <MoneyText value={item.sale?.total} style={styles.total} />
                </View>
              </Pressable>
              <Pressable
                style={[styles.cardPrintBtn, (busyPrint || printingId != null) && styles.disabled]}
                disabled={busyPrint || printingId != null}
                onPress={() => void reprintDelivery(item)}>
                {busyPrint ? (
                  <ActivityIndicator color={BrandColors.primary} />
                ) : (
                  <Text style={styles.cardPrintText}>Imprimer</Text>
                )}
              </Pressable>
            </View>
          );
        }}
      />

      <ModalShell
        visible={detail != null}
        onRequestClose={() => setDetail(null)}
        body={
          detail ? (
            <FlatList
              data={detail.items ?? []}
              keyExtractor={(it) => String(it.saleItemId)}
              contentContainerStyle={styles.detailList}
              ListHeaderComponent={
                <View style={styles.detailHeader}>
                  <Text style={styles.detailTitle}>
                    Vente #
                    {detail.saleRef ??
                      detail.sale?.txnNumber ??
                      detail.sale?.id ??
                      detail.saleId}
                  </Text>
                  <Text style={styles.client}>{detail.sale?.clientName?.trim() || 'Client'}</Text>
                  <Text style={styles.meta}>
                    {STATUS_LABEL[detail.status]} · {formatMoney(detail.sale?.total)}
                  </Text>
                  <Text style={styles.meta}>
                    {[detail.company?.name, detail.department?.name].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              }
              renderItem={({ item: it }) => {
                const label =
                  it.saleItem?.lineLabel ||
                  it.saleItem?.product?.name ||
                  `Article #${it.saleItemId}`;
                const editable = canManage && detail.status !== 'DELIVERED';
                return (
                  <View style={styles.lineRow}>
                    <View style={styles.rowInfo}>
                      <Text style={styles.rowTitle} numberOfLines={2}>
                        {label}
                      </Text>
                      <Text style={styles.meta}>Commandé : {formatQuantity(it.quantityOrdered)}</Text>
                    </View>
                    {editable ? (
                      <TextInput
                        style={styles.qtyInput}
                        keyboardType="decimal-pad"
                        value={qtyDrafts[it.saleItemId] ?? ''}
                        onChangeText={(v) =>
                          setQtyDrafts((prev) => ({ ...prev, [it.saleItemId]: v }))
                        }
                      />
                    ) : (
                      <Text style={styles.rowValue}>
                        {formatQuantity(it.quantityDelivered)} / {formatQuantity(it.quantityOrdered)}
                      </Text>
                    )}
                  </View>
                );
              }}
            />
          ) : null
        }
        footer={
          detail ? (
            <View style={styles.footer}>
              {detailError ? <Text style={styles.error}>{detailError}</Text> : null}
              <View style={styles.footerActions}>
                <Pressable style={styles.secondaryBtn} onPress={() => setDetail(null)}>
                  <Text style={styles.secondaryBtnText}>Fermer</Text>
                </Pressable>
                <Pressable
                  style={[styles.secondaryBtn, printingId != null && styles.disabled]}
                  disabled={printingId != null || saving}
                  onPress={() => void reprintDelivery(detail)}>
                  {printingId === detail.id ? (
                    <ActivityIndicator color={BrandColors.text} />
                  ) : (
                    <Text style={styles.secondaryBtnText}>Réimprimer fiche</Text>
                  )}
                </Pressable>
                {canManage && detail.status !== 'DELIVERED' ? (
                  <>
                    <Pressable
                      style={[styles.secondaryBtn, saving && styles.disabled]}
                      disabled={saving}
                      onPress={() => void saveDetail(false)}>
                      <Text style={styles.secondaryBtnText}>Enregistrer</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.primaryBtn, saving && styles.disabled]}
                      disabled={saving}
                      onPress={() => void saveDetail(true)}>
                      {saving ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={styles.primaryBtnText}>Tout livrer</Text>
                      )}
                    </Pressable>
                  </>
                ) : null}
              </View>
            </View>
          ) : null
        }>
        <View style={styles.modalTop}>
          <Text style={styles.modalTopTitle}>Livraison</Text>
          <Pressable onPress={() => setDetail(null)} hitSlop={12}>
            <Text style={styles.modalClose}>Fermer</Text>
          </Pressable>
        </View>
      </ModalShell>
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  search: {
    flex: 1,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    backgroundColor: BrandColors.surface,
    color: BrandColors.text,
  },
  searchBtn: {
    backgroundColor: BrandColors.primary,
    borderRadius: 12,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  searchBtnText: { color: '#fff', fontWeight: '700' },
  error: {
    color: BrandColors.danger,
    fontWeight: '600',
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.two,
  },
  count: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    color: BrandColors.textMuted,
    fontSize: 13,
  },
  list: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.two },
  cardRow: { justifyContent: 'space-between', gap: Spacing.two },
  empty: { textAlign: 'center', color: BrandColors.textMuted, marginTop: Spacing.five },
  card: {
    width: '48.5%',
    backgroundColor: BrandColors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: Spacing.three,
    gap: 6,
  },
  cardPrintBtn: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: BrandColors.surfaceSoft,
  },
  cardPrintText: { fontWeight: '700', color: BrandColors.text },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardRef: { fontSize: 16, fontWeight: '700', color: BrandColors.text },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  client: { fontSize: 15, fontWeight: '600', color: BrandColors.text },
  meta: { fontSize: 12, color: BrandColors.textMuted },
  cardFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  total: { fontWeight: '700', color: BrandColors.text },
  modalTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  modalTopTitle: { fontSize: 18, fontWeight: '700', color: BrandColors.text },
  modalClose: { color: BrandColors.primary, fontWeight: '600' },
  detailList: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.four },
  detailHeader: { gap: 4, marginBottom: Spacing.three },
  detailTitle: { fontSize: 20, fontWeight: '700', color: BrandColors.text },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: BrandColors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: Spacing.three,
    marginBottom: Spacing.two,
  },
  rowInfo: { flex: 1, gap: 2 },
  rowTitle: { fontWeight: '600', color: BrandColors.text },
  rowValue: { fontWeight: '700', color: BrandColors.text },
  qtyInput: {
    width: 88,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlign: 'right',
    color: BrandColors.text,
  },
  footer: { padding: Spacing.three, gap: Spacing.two, backgroundColor: BrandColors.bg },
  footerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  secondaryBtn: {
    flexGrow: 1,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: BrandColors.surface,
  },
  secondaryBtnText: { fontWeight: '700', color: BrandColors.text },
  primaryBtn: {
    flexGrow: 1,
    backgroundColor: BrandColors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.55 },
});
