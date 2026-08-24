import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { MoneyText } from '@/components/MoneyText';
import { ChipScroll } from '@/components/ChipScroll';
import { KpiCard } from '@/components/monitor/KpiCard';
import { PeriodChips } from '@/components/monitor/PeriodChips';
import { SaleDetailModal } from '@/components/monitor/SaleDetailModal';
import { VentesDepartmentModal } from '@/components/monitor/VentesDepartmentModal';
import { RefreshableScroll } from '@/components/RefreshableScroll';
import { Screen } from '@/components/Screen';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useCompanyScope } from '@/hooks/useCompanyScope';
import {
  cancelSale,
  deleteSalePermanently,
  getDashboardSalesByProduct,
  getSaleById,
  listSales,
  refundSale,
} from '@/services/api';
import type { DashboardSalesByProductRow, Sale } from '@/types/api';
import {
  addDaysYmd,
  businessDayEndIso,
  businessDayStartIso,
  businessTodayYmd,
  formatDateTime,
  periodDateRange,
  type PeriodKey,
} from '@/utils/datetime';
import { saleDisplayRef } from '@/utils/saleRef';
import { formatQuantity } from '@/utils/quantity';

type DepartmentGroup = {
  key: string;
  label: string;
  departmentId: number | null;
  rows: DashboardSalesByProductRow[];
};

export default function VentesScreen() {
  const { can, canPerm } = useAuth();
  const { companyId, companies, setCompanyId, ready, lockedToSession } = useCompanyScope();
  const [period, setPeriod] = useState<PeriodKey>('week');
  const [view, setView] = useState<'departments' | 'transactions'>('departments');
  const [byProduct, setByProduct] = useState<DashboardSalesByProductRow[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [salesTotal, setSalesTotal] = useState(0);
  const [selectedDepartment, setSelectedDepartment] = useState<DepartmentGroup | null>(null);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManageSales = can(['ADMIN', 'MANAGER']) || canPerm('sales.cancel');
  const canDeleteSales = can(['ADMIN']) || canPerm('sales.delete');
  const canSeeUnlimitedSalesRange = can(['ADMIN']) || canPerm('reports.view');
  const canSeeSalesTotals = canSeeUnlimitedSalesRange || canPerm('sales.recent_totals');
  const salesRecentMinYmd =
    canSeeUnlimitedSalesRange || !canSeeSalesTotals ? null : addDaysYmd(businessTodayYmd(), -1);

  const load = useCallback(async (offset = 0) => {
    if (companyId == null) return;
    const append = offset > 0;
    const rawRange = periodDateRange(period);
    const today = businessTodayYmd();
    const dateFrom =
      salesRecentMinYmd && rawRange.dateFrom < salesRecentMinYmd
        ? salesRecentMinYmd
        : rawRange.dateFrom;
    const dateTo = salesRecentMinYmd && rawRange.dateTo > today ? today : rawRange.dateTo;
    try {
      setError(null);
      const [products, salesRes] = await Promise.all([
        getDashboardSalesByProduct({ companyId, dateFrom, dateTo }),
        listSales({
          companyId,
          skip: offset,
          take: 20,
          createdFrom: businessDayStartIso(dateFrom),
          createdTo: businessDayEndIso(dateTo),
        }),
      ]);
      setByProduct(products);
      setSales((previous) => (append ? [...previous, ...salesRes.items] : salesRes.items));
      setSalesTotal(salesRes.total);
    } catch {
      setError('Impossible de charger les ventes');
      if (!append) {
        setByProduct([]);
        setSales([]);
        setSalesTotal(0);
      }
    }
  }, [companyId, period, salesRecentMinYmd]);

  useFocusEffect(
    useCallback(() => {
      if (!ready) return;
      void load(0);
    }, [load, ready]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load(0);
    setRefreshing(false);
  }

  const departmentGroups = useMemo(() => {
    const groups = new Map<string, DepartmentGroup>();
    for (const row of byProduct) {
      const key = String(row.departmentId ?? 'none');
      const existing = groups.get(key);
      if (existing) existing.rows.push(row);
      else {
        groups.set(key, {
          key,
          label: row.departmentName?.trim() || 'Sans département',
          departmentId: row.departmentId,
          rows: [row],
        });
      }
    }
    return [...groups.values()].sort((a, b) => {
      const totalA = a.rows.reduce((sum, row) => sum + Number(row.totalSubtotal), 0);
      const totalB = b.rows.reduce((sum, row) => sum + Number(row.totalSubtotal), 0);
      return totalB - totalA;
    });
  }, [byProduct]);

  const grandTotal = byProduct.reduce((s, r) => s + Number(r.totalSubtotal || 0), 0);
  const rawDisplayRange = periodDateRange(period);
  const todayYmd = businessTodayYmd();
  const dateFrom =
    salesRecentMinYmd && rawDisplayRange.dateFrom < salesRecentMinYmd
      ? salesRecentMinYmd
      : rawDisplayRange.dateFrom;
  const dateTo =
    salesRecentMinYmd && rawDisplayRange.dateTo > todayYmd ? todayYmd : rawDisplayRange.dateTo;

  async function openSale(id: number) {
    setDetailLoading(true);
    setError(null);
    try {
      setSelectedSale(await getSaleById(id));
    } catch {
      setError('Impossible d’ouvrir cette transaction');
    } finally {
      setDetailLoading(false);
    }
  }

  async function loadMore() {
    if (loadingMore || sales.length >= salesTotal) return;
    setLoadingMore(true);
    await load(sales.length);
    setLoadingMore(false);
  }

  function confirmAction(kind: 'cancel' | 'refund' | 'delete', sale: Sale) {
    const copy =
      kind === 'cancel'
        ? {
            title: 'Annuler la vente',
            message: `Annuler la vente #${saleDisplayRef(sale)} et rétablir son stock ?`,
            button: 'Annuler la vente',
          }
        : kind === 'refund'
          ? {
              title: 'Rembourser la vente',
              message: `Rembourser la vente #${saleDisplayRef(sale)} et rétablir son stock ?`,
              button: 'Rembourser',
            }
          : {
              title: 'Suppression définitive',
              message: `Supprimer définitivement la vente #${saleDisplayRef(sale)} ? Cette action est irréversible.`,
              button: 'Supprimer',
            };
    Alert.alert(copy.title, copy.message, [
      { text: 'Retour', style: 'cancel' },
      {
        text: copy.button,
        style: 'destructive',
        onPress: () => void runSaleAction(kind, sale),
      },
    ]);
  }

  async function runSaleAction(kind: 'cancel' | 'refund' | 'delete', sale: Sale) {
    if (companyId == null) return;
    setActionBusy(true);
    try {
      if (kind === 'cancel') await cancelSale(sale.id);
      else if (kind === 'refund') await refundSale(sale.id);
      else await deleteSalePermanently(sale.id, companyId);
      setSelectedSale(null);
      await load(0);
    } catch {
      Alert.alert('Action impossible', 'La transaction n’a pas pu être modifiée.');
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <Screen>
      <RefreshableScroll refreshing={refreshing} onRefresh={onRefresh}>
        {!lockedToSession && companies.length > 1 ? (
          <ChipScroll>
            {companies.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => setCompanyId(c.id)}
                style={[styles.companyChip, companyId === c.id && styles.companyChipActive]}>
                <Text
                  style={[
                    styles.companyChipText,
                    companyId === c.id && styles.companyChipTextActive,
                  ]}
                  numberOfLines={1}>
                  {c.name}
                </Text>
              </Pressable>
            ))}
          </ChipScroll>
        ) : null}

        <PeriodChips value={period} onChange={setPeriod} />
        {salesRecentMinYmd ? (
          <Text style={styles.sectionHint}>
            Totaux limités aux 2 derniers jours (depuis {salesRecentMinYmd}, fuseau Port-au-Prince).
          </Text>
        ) : null}
        <View style={styles.viewSwitch}>
          <Pressable
            style={[styles.viewButton, view === 'departments' && styles.viewButtonActive]}
            onPress={() => setView('departments')}>
            <Ionicons
              name="business-outline"
              size={17}
              color={view === 'departments' ? '#fff' : BrandColors.textMuted}
            />
            <Text
              style={[
                styles.viewButtonText,
                view === 'departments' && styles.viewButtonTextActive,
              ]}>
              Départements
            </Text>
          </Pressable>
          <Pressable
            style={[styles.viewButton, view === 'transactions' && styles.viewButtonActive]}
            onPress={() => setView('transactions')}>
            <Ionicons
              name="receipt-outline"
              size={17}
              color={view === 'transactions' ? '#fff' : BrandColors.textMuted}
            />
            <Text
              style={[
                styles.viewButtonText,
                view === 'transactions' && styles.viewButtonTextActive,
              ]}>
              Transactions
            </Text>
          </Pressable>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {ready && companyId == null ? (
          <Text style={styles.error}>Aucune entreprise disponible.</Text>
        ) : null}

        <View style={styles.kpiGrid}>
          <KpiCard label="Total période" value={grandTotal} money />
          <KpiCard label="Transactions" value={String(salesTotal)} />
        </View>

        {view === 'departments' ? (
          <>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.section}>Ventes par département</Text>
                <Text style={styles.sectionHint}>Touchez une carte pour voir les articles</Text>
              </View>
              <Text style={styles.periodLabel}>
                {dateFrom} → {dateTo}
              </Text>
            </View>
            {departmentGroups.length === 0 ? (
              <Text style={styles.empty}>Aucune vente sur cette période.</Text>
            ) : (
              <View style={styles.departmentGrid}>
                {departmentGroups.map((group) => {
                  const total = group.rows.reduce(
                    (sum, row) => sum + Number(row.totalSubtotal),
                    0,
                  );
                  const quantity = group.rows.reduce(
                    (sum, row) => sum + Number(row.quantity),
                    0,
                  );
                  return (
                    <Pressable
                      key={group.key}
                      style={({ pressed }) => [
                        styles.departmentCard,
                        pressed && styles.cardPressed,
                      ]}
                      onPress={() => setSelectedDepartment(group)}>
                      <View style={styles.departmentIcon}>
                        <Ionicons name="storefront-outline" size={18} color={BrandColors.primary} />
                      </View>
                      <Text style={styles.departmentName} numberOfLines={2}>
                        {group.label}
                      </Text>
                      <Text style={styles.departmentMeta}>
                        {group.rows.length} article(s) · {formatQuantity(quantity)} unité(s)
                      </Text>
                      <MoneyText value={total} style={styles.departmentTotal} />
                    </Pressable>
                  );
                })}
              </View>
            )}
          </>
        ) : (
          <>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.section}>Transactions de vente</Text>
                <Text style={styles.sectionHint}>
                  {sales.length} affichée(s) sur {salesTotal}
                </Text>
              </View>
            </View>
            {detailLoading ? <ActivityIndicator color={BrandColors.primary} /> : null}
            {sales.length === 0 ? (
              <Text style={styles.empty}>Aucune transaction sur cette période.</Text>
            ) : (
              sales.map((sale) => {
                const statusTone =
                  sale.status === 'COMPLETED'
                    ? styles.statusCompleted
                    : sale.status === 'REFUNDED'
                      ? styles.statusRefunded
                      : styles.statusCancelled;
                const statusLabel =
                  sale.status === 'COMPLETED'
                    ? 'Complétée'
                    : sale.status === 'REFUNDED'
                      ? 'Remboursée'
                      : 'Annulée';
                return (
                  <Pressable
                    key={sale.id}
                    style={({ pressed }) => [styles.saleCard, pressed && styles.cardPressed]}
                    onPress={() => void openSale(sale.id)}>
                    <View style={styles.saleTop}>
                      <View style={styles.saleRefWrap}>
                        <Text style={styles.saleRef}>#{saleDisplayRef(sale)}</Text>
                        <View style={[styles.statusBadge, statusTone]}>
                          <Text style={styles.statusText}>{statusLabel}</Text>
                        </View>
                      </View>
                      <MoneyText value={sale.total} style={styles.saleTotal} />
                    </View>
                    <Text style={styles.saleClient} numberOfLines={1}>
                      {sale.clientName?.trim() || 'Client inconnu'}
                    </Text>
                    <View style={styles.saleBottom}>
                      <Text style={styles.saleMeta}>{formatDateTime(sale.createdAt)}</Text>
                      <Text style={styles.saleMeta} numberOfLines={1}>
                        {sale.user?.fullName?.trim() || sale.cashier || sale.user?.phone || '—'}
                      </Text>
                    </View>
                  </Pressable>
                );
              })
            )}
            {sales.length < salesTotal ? (
              <Pressable
                style={[styles.loadMore, loadingMore && styles.disabled]}
                disabled={loadingMore}
                onPress={() => void loadMore()}>
                {loadingMore ? (
                  <ActivityIndicator color={BrandColors.primary} />
                ) : (
                  <Text style={styles.loadMoreText}>Charger plus</Text>
                )}
              </Pressable>
            ) : null}
          </>
        )}
      </RefreshableScroll>

      <VentesDepartmentModal
        group={selectedDepartment}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onClose={() => setSelectedDepartment(null)}
      />
      <SaleDetailModal
        sale={selectedSale}
        busy={actionBusy}
        canManage={canManageSales}
        canDelete={canDeleteSales}
        onCancel={(sale) => confirmAction('cancel', sale)}
        onRefund={(sale) => confirmAction('refund', sale)}
        onDelete={(sale) => confirmAction('delete', sale)}
        onClose={() => setSelectedSale(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  companyChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    backgroundColor: BrandColors.surface,
    maxWidth: 200,
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: 'center',
  },
  companyChipActive: { backgroundColor: BrandColors.primary, borderColor: BrandColors.primary },
  companyChipText: { fontWeight: '600', color: BrandColors.text, fontSize: 13 },
  companyChipTextActive: { color: '#fff' },
  error: { color: BrandColors.danger, fontWeight: '600' },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  viewSwitch: {
    flexDirection: 'row',
    backgroundColor: BrandColors.bgDeep,
    borderRadius: 14,
    padding: 4,
    gap: 4,
  },
  viewButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    paddingVertical: 9,
  },
  viewButtonActive: { backgroundColor: BrandColors.primary },
  viewButtonText: { color: BrandColors.textMuted, fontSize: 12, fontWeight: '700' },
  viewButtonTextActive: { color: '#fff' },
  sectionHeader: {
    marginTop: Spacing.two,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  section: { fontSize: 16, fontWeight: '800', color: BrandColors.text },
  sectionHint: { color: BrandColors.textMuted, fontSize: 11, marginTop: 2 },
  periodLabel: { color: BrandColors.textMuted, fontSize: 9, textAlign: 'right' },
  empty: {
    color: BrandColors.textMuted,
    textAlign: 'center',
    paddingVertical: Spacing.five,
  },
  departmentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  departmentCard: {
    width: '48%',
    flexGrow: 1,
    minHeight: 145,
    backgroundColor: BrandColors.surface,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: Spacing.three,
    gap: 6,
  },
  departmentIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: BrandColors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  departmentName: { color: BrandColors.text, fontSize: 14, fontWeight: '800', minHeight: 34 },
  departmentMeta: { color: BrandColors.textMuted, fontSize: 10, flex: 1 },
  departmentTotal: { color: BrandColors.text, fontSize: 16, fontWeight: '900' },
  saleCard: {
    backgroundColor: BrandColors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: Spacing.three,
    gap: 7,
  },
  cardPressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
  saleTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  saleRefWrap: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  saleRef: { color: BrandColors.text, fontSize: 15, fontWeight: '900' },
  statusBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  statusCompleted: { backgroundColor: '#DCFCE7' },
  statusRefunded: { backgroundColor: '#FEF3C7' },
  statusCancelled: { backgroundColor: '#FEE2E2' },
  statusText: { color: BrandColors.text, fontSize: 9, fontWeight: '800' },
  saleTotal: { color: BrandColors.text, fontSize: 15, fontWeight: '900' },
  saleClient: { color: BrandColors.text, fontSize: 13, fontWeight: '700' },
  saleBottom: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  saleMeta: { flex: 1, color: BrandColors.textMuted, fontSize: 10 },
  loadMore: {
    borderWidth: 1,
    borderColor: BrandColors.primary,
    borderRadius: 12,
    alignItems: 'center',
    paddingVertical: 12,
  },
  loadMoreText: { color: BrandColors.primary, fontWeight: '800' },
  disabled: { opacity: 0.55 },
});
