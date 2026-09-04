import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { MoneyText } from '@/components/MoneyText';
import { ChipScroll } from '@/components/ChipScroll';
import { KpiCard } from '@/components/monitor/KpiCard';
import { DashboardDateFilter } from '@/components/monitor/DashboardDateFilter';
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
  dashboardPresetRange,
  formatYmdDisplay,
} from '@/utils/datetime';
import { isSaleDeleted, saleDisplayRef } from '@/utils/saleRef';
import { formatQuantity } from '@/utils/quantity';
import { salesQueryDepartmentParams } from '@/utils/user-scope';

type DepartmentGroup = {
  key: string;
  label: string;
  departmentId: number | null;
  rows: DashboardSalesByProductRow[];
};

export default function VentesScreen() {
  const { can, canPerm, user } = useAuth();
  const salesDeptParams = useMemo(() => salesQueryDepartmentParams(user), [user]);
  const { companyId, companies, setCompanyId, ready, lockedToSession } = useCompanyScope();
  const [range, setRange] = useState(() => dashboardPresetRange('week'));
  const [byProduct, setByProduct] = useState<DashboardSalesByProductRow[]>([]);
  const [salesTotal, setSalesTotal] = useState(0);
  const [selectedDepartment, setSelectedDepartment] = useState<DepartmentGroup | null>(null);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deptRefreshKey, setDeptRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const canManageSales = canPerm('sales.cancel');
  const canDeleteSales = canPerm('sales.delete');
  const canSeeUnlimitedSalesRange = can(['ADMIN']) || canPerm('reports.view');
  const canSeeSalesTotals = canSeeUnlimitedSalesRange || canPerm('sales.recent_totals');
  const salesRecentMinYmd =
    canSeeUnlimitedSalesRange || !canSeeSalesTotals ? null : addDaysYmd(businessTodayYmd(), -1);

  const load = useCallback(async () => {
    if (companyId == null) return;
    const rawRange = range;
    const today = businessTodayYmd();
    const dateFrom =
      salesRecentMinYmd && rawRange.dateFrom < salesRecentMinYmd
        ? salesRecentMinYmd
        : rawRange.dateFrom;
    const dateTo = salesRecentMinYmd && rawRange.dateTo > today ? today : rawRange.dateTo;
    try {
      setError(null);
      const [products, salesRes] = await Promise.all([
        getDashboardSalesByProduct({ companyId, dateFrom, dateTo, ...salesDeptParams }),
        listSales({
          companyId,
          skip: 0,
          take: 1,
          createdFrom: businessDayStartIso(dateFrom),
          createdTo: businessDayEndIso(dateTo),
          ...salesDeptParams,
        }),
      ]);
      setByProduct(products);
      setSalesTotal(salesRes.total);
    } catch {
      setError('Impossible de charger les ventes');
      setByProduct([]);
      setSalesTotal(0);
    }
  }, [companyId, range, salesRecentMinYmd, salesDeptParams]);

  useFocusEffect(
    useCallback(() => {
      if (!ready) return;
      void load();
    }, [load, ready]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setDeptRefreshKey((key) => key + 1);
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

  useEffect(() => {
    setSelectedDepartment((current) => {
      if (!current) return current;
      return departmentGroups.find((group) => group.key === current.key) ?? current;
    });
  }, [departmentGroups]);

  const grandTotal = byProduct.reduce((s, r) => s + Number(r.totalSubtotal || 0), 0);
  const rawDisplayRange = range;
  const todayYmd = businessTodayYmd();
  const dateFrom =
    salesRecentMinYmd && rawDisplayRange.dateFrom < salesRecentMinYmd
      ? salesRecentMinYmd
      : rawDisplayRange.dateFrom;
  const dateTo =
    salesRecentMinYmd && rawDisplayRange.dateTo > todayYmd ? todayYmd : rawDisplayRange.dateTo;

  async function openSale(sale: Sale) {
    setError(null);
    try {
      setSelectedSale(await getSaleById(sale.id));
    } catch {
      setSelectedSale(sale);
    }
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
              title: 'Supprimer la vente',
              message: `Supprimer la vente #${saleDisplayRef(sale)} ? Les stocks, paiements et écritures de caisse seront annulés. La ligne restera visible comme supprimée.`,
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
      await load();
      setDeptRefreshKey((key) => key + 1);
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

        <DashboardDateFilter
          dateFrom={range.dateFrom}
          dateTo={range.dateTo}
          onChange={(nextFrom, nextTo) => setRange({ dateFrom: nextFrom, dateTo: nextTo })}
          minYmd={salesRecentMinYmd}
        />
        {salesRecentMinYmd ? (
          <Text style={styles.sectionHint}>
            Totaux limités aux 2 derniers jours (depuis {formatYmdDisplay(salesRecentMinYmd)}).
          </Text>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {ready && companyId == null ? (
          <Text style={styles.error}>Aucune entreprise disponible.</Text>
        ) : null}

        <View style={styles.kpiGrid}>
          <KpiCard label="Total période" value={grandTotal} money />
          <KpiCard label="Transactions" value={String(salesTotal)} />
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.section}>Ventes par département</Text>
          <Text style={styles.periodLabel}>
            {formatYmdDisplay(dateFrom)} → {formatYmdDisplay(dateTo)}
          </Text>
        </View>
        {departmentGroups.length === 0 ? (
          <Text style={styles.empty}>Aucune vente sur cette période.</Text>
        ) : (
          <View style={styles.departmentGrid}>
            {departmentGroups.map((group) => {
              const deptTotal = group.rows.reduce(
                (sum, row) => sum + Number(row.totalSubtotal),
                0,
              );
              const quantity = group.rows.reduce((sum, row) => sum + Number(row.quantity), 0);
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
                    {group.rows.length} article(s) · {formatQuantity(quantity)}
                  </Text>
                  <MoneyText value={deptTotal} style={styles.departmentTotal} />
                </Pressable>
              );
            })}
          </View>
        )}
      </RefreshableScroll>

      <VentesDepartmentModal
        group={selectedDepartment}
        companyId={companyId}
        dateFrom={dateFrom}
        dateTo={dateTo}
        refreshKey={deptRefreshKey}
        salesDeptParams={salesDeptParams}
        canCancel={can(['ADMIN'])}
        cancelBusy={actionBusy}
        onOpenSale={(sale) => void openSale(sale)}
        onCancelSale={(sale) => confirmAction('cancel', sale)}
        onClose={() => {
          setSelectedDepartment(null);
          setSelectedSale(null);
        }}
      />
      <SaleDetailModal
        sale={selectedSale}
        busy={actionBusy}
        canManage={canManageSales && selectedSale != null && !isSaleDeleted(selectedSale)}
        canDelete={canDeleteSales && selectedSale != null && !isSaleDeleted(selectedSale)}
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
  cardPressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
});
