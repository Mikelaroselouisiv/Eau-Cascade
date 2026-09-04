import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { ModalShell } from '@/components/ModalShell';
import { MoneyText } from '@/components/MoneyText';
import { SaleTransactionRow } from '@/components/monitor/SaleTransactionRow';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { listSales } from '@/services/api';
import type { DashboardSalesByProductRow, Sale } from '@/types/api';
import { businessDayEndIso, businessDayStartIso, formatYmdDisplay } from '@/utils/datetime';
import { formatQuantity } from '@/utils/quantity';

type DepartmentGroup = {
  key: string;
  label: string;
  departmentId: number | null;
  rows: DashboardSalesByProductRow[];
};

type Props = {
  group: DepartmentGroup | null;
  companyId: number | null;
  dateFrom: string;
  dateTo: string;
  refreshKey?: number;
  salesDeptParams?: { departmentId?: number; departmentIds?: number[] };
  canCancel?: boolean;
  cancelBusy?: boolean;
  onOpenSale: (sale: Sale) => void;
  onCancelSale?: (sale: Sale) => void;
  onClose: () => void;
};

const PAGE_SIZE = 20;

export function VentesDepartmentModal({
  group,
  companyId,
  dateFrom,
  dateTo,
  refreshKey = 0,
  salesDeptParams,
  canCancel = false,
  cancelBusy = false,
  onOpenSale,
  onCancelSale,
  onClose,
}: Props) {
  const [sales, setSales] = useState<Sale[]>([]);
  const [salesTotal, setSalesTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadLock = useRef(false);

  const total = group?.rows.reduce((sum, row) => sum + Number(row.totalSubtotal), 0) ?? 0;
  const quantity = group?.rows.reduce((sum, row) => sum + Number(row.quantity), 0) ?? 0;

  const loadSales = useCallback(
    async (append: boolean, currentCount: number) => {
      if (!group || companyId == null) return;
      if (loadLock.current) return;
      loadLock.current = true;
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setSales([]);
        setSalesTotal(0);
      }
      setError(null);
      try {
        const page = await listSales({
          companyId,
          skip: append ? currentCount : 0,
          take: PAGE_SIZE,
          createdFrom: businessDayStartIso(dateFrom),
          createdTo: businessDayEndIso(dateTo),
          ...(group.departmentId != null
            ? { departmentId: group.departmentId }
            : salesDeptParams),
        });
        setSalesTotal(page.total);
        setSales((previous) => {
          const base = append ? previous : [];
          const seen = new Set(base.map((sale) => sale.id));
          const next = [...base];
          for (const item of page.items) {
            if (seen.has(item.id)) continue;
            seen.add(item.id);
            next.push(item);
          }
          return next;
        });
      } catch {
        if (!append) setSales([]);
        setError('Impossible de charger les transactions.');
      } finally {
        loadLock.current = false;
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [companyId, dateFrom, dateTo, group, salesDeptParams],
  );

  useEffect(() => {
    if (!group || companyId == null) {
      setSales([]);
      setSalesTotal(0);
      setError(null);
      return;
    }
    void loadSales(false, 0);
  }, [companyId, dateFrom, dateTo, group, loadSales, refreshKey]);

  function onEndReached() {
    if (loading || loadingMore || sales.length >= salesTotal) return;
    void loadSales(true, sales.length);
  }

  return (
    <ModalShell
      visible={group != null}
      onRequestClose={onClose}
      body={
        <FlatList
          style={styles.listFlex}
          data={sales}
          keyExtractor={(sale) => String(sale.id)}
          contentContainerStyle={styles.list}
          onEndReached={() => onEndReached()}
          onEndReachedThreshold={0.4}
          ListHeaderComponent={
            <View style={styles.headerBlock}>
              <View style={styles.summary}>
                <View style={styles.summaryCell}>
                  <Text style={styles.summaryLabel}>Articles</Text>
                  <Text style={styles.summaryValue}>{group?.rows.length ?? 0}</Text>
                </View>
                <View style={styles.summaryCell}>
                  <Text style={styles.summaryLabel}>Quantité</Text>
                  <Text style={styles.summaryValue}>{formatQuantity(quantity)}</Text>
                </View>
                <View style={styles.summaryCell}>
                  <Text style={styles.summaryLabel}>CA</Text>
                  <MoneyText value={total} style={styles.summaryValue} />
                </View>
              </View>
              <Text style={styles.section}>Articles</Text>
              {(group?.rows ?? []).length === 0 ? (
                <Text style={styles.empty}>Aucun article</Text>
              ) : (
                (group?.rows ?? []).map((item) => (
                  <View key={`${item.productId}-${item.departmentId}`} style={styles.row}>
                    <View style={styles.rowInfo}>
                      <Text style={styles.rowTitle} numberOfLines={2}>
                        {item.productName}
                      </Text>
                      <Text style={styles.rowMeta}>
                        {item.isService ? 'Service' : 'Produit'} · {formatQuantity(item.quantity)}
                      </Text>
                    </View>
                    <MoneyText value={item.totalSubtotal} style={styles.rowAmount} />
                  </View>
                ))
              )}
              <View style={styles.txnHeader}>
                <Text style={styles.section}>Transactions</Text>
                <Text style={styles.txnCount}>{salesTotal}</Text>
              </View>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              {loading && sales.length === 0 ? (
                <ActivityIndicator color={BrandColors.primary} style={styles.loader} />
              ) : null}
            </View>
          }
          renderItem={({ item }) => (
            <SaleTransactionRow
              sale={item}
              canCancel={canCancel}
              cancelBusy={cancelBusy}
              onPress={onOpenSale}
              onCancel={onCancelSale}
            />
          )}
          ListEmptyComponent={
            loading || error ? null : <Text style={styles.empty}>Aucune transaction</Text>
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={BrandColors.primary} style={styles.loader} />
            ) : null
          }
        />
      }
      footer={
        <View style={styles.footer}>
          <Pressable style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeText}>Fermer</Text>
          </Pressable>
        </View>
      }>
      <View style={styles.header}>
        <View style={styles.headerInfo}>
          <Text style={styles.eyebrow}>VENTES PAR DÉPARTEMENT</Text>
          <Text style={styles.title} numberOfLines={1}>
            {group?.label ?? ''}
          </Text>
          <Text style={styles.period}>
            {formatYmdDisplay(dateFrom)} → {formatYmdDisplay(dateTo)}
          </Text>
        </View>
        <Pressable onPress={onClose} hitSlop={12}>
          <Ionicons name="close" size={26} color={BrandColors.text} />
        </Pressable>
      </View>
    </ModalShell>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: 1,
    borderBottomColor: BrandColors.border,
  },
  headerInfo: { flex: 1 },
  eyebrow: { color: BrandColors.primary, fontSize: 10, fontWeight: '800', letterSpacing: 0.7 },
  title: { color: BrandColors.text, fontSize: 20, fontWeight: '800', marginTop: 2 },
  period: { color: BrandColors.textMuted, fontSize: 11, marginTop: 2 },
  listFlex: { flex: 1 },
  list: { padding: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.five },
  headerBlock: { gap: Spacing.two, marginBottom: Spacing.two },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  summaryCell: {
    flex: 1,
    minWidth: '30%',
    borderRadius: 12,
    padding: Spacing.three,
    backgroundColor: BrandColors.primarySoft,
    gap: 3,
  },
  summaryLabel: { color: BrandColors.textMuted, fontSize: 10, fontWeight: '700' },
  summaryValue: { color: BrandColors.text, fontSize: 15, fontWeight: '800' },
  section: { color: BrandColors.text, fontSize: 15, fontWeight: '800', marginTop: Spacing.two },
  txnHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: Spacing.two,
  },
  txnCount: { color: BrandColors.textMuted, fontSize: 12, fontWeight: '700' },
  error: { color: BrandColors.danger, fontWeight: '600' },
  empty: { color: BrandColors.textMuted, fontSize: 13, paddingVertical: Spacing.two },
  loader: { marginVertical: Spacing.three },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: BrandColors.surface,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: Spacing.three,
  },
  rowInfo: { flex: 1, gap: 3 },
  rowTitle: { color: BrandColors.text, fontWeight: '700' },
  rowMeta: { color: BrandColors.textMuted, fontSize: 11 },
  rowAmount: { color: BrandColors.text, fontWeight: '800', textAlign: 'right' },
  footer: { padding: Spacing.three, backgroundColor: BrandColors.bg },
  closeButton: {
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: BrandColors.primary,
    paddingVertical: 13,
  },
  closeText: { color: '#fff', fontWeight: '800' },
});
