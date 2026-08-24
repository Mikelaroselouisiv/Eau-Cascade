import { Ionicons } from '@expo/vector-icons';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { ModalShell } from '@/components/ModalShell';
import { MoneyText } from '@/components/MoneyText';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import type { DashboardSalesByProductRow } from '@/types/api';
import { formatQuantity } from '@/utils/quantity';

type DepartmentGroup = {
  key: string;
  label: string;
  departmentId: number | null;
  rows: DashboardSalesByProductRow[];
};

type Props = {
  group: DepartmentGroup | null;
  dateFrom: string;
  dateTo: string;
  onClose: () => void;
};

export function VentesDepartmentModal({ group, dateFrom, dateTo, onClose }: Props) {
  const total = group?.rows.reduce((sum, row) => sum + Number(row.totalSubtotal), 0) ?? 0;
  const quantity = group?.rows.reduce((sum, row) => sum + Number(row.quantity), 0) ?? 0;

  return (
    <ModalShell
      visible={group != null}
      onRequestClose={onClose}
      body={
        <FlatList
          data={group?.rows ?? []}
          keyExtractor={(row) => `${row.productId}-${row.departmentId}`}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.summary}>
              <View style={styles.summaryCell}>
                <Text style={styles.summaryLabel}>Articles</Text>
                <Text style={styles.summaryValue}>{group?.rows.length ?? 0}</Text>
              </View>
              <View style={styles.summaryCell}>
                <Text style={styles.summaryLabel}>Quantité totale</Text>
                <Text style={styles.summaryValue}>{formatQuantity(quantity)}</Text>
              </View>
              <View style={styles.summaryCell}>
                <Text style={styles.summaryLabel}>Total vendu</Text>
                <MoneyText value={total} style={styles.summaryValue} />
              </View>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.rowInfo}>
                <Text style={styles.rowTitle} numberOfLines={2}>
                  {item.productName}
                </Text>
                <Text style={styles.rowMeta}>
                  {item.isService ? 'Service' : 'Produit'} · {formatQuantity(item.quantity)} unité(s)
                </Text>
              </View>
              <MoneyText value={item.totalSubtotal} style={styles.rowAmount} />
            </View>
          )}
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
            {dateFrom} → {dateTo}
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
  list: { padding: Spacing.three, gap: Spacing.two },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginBottom: Spacing.two },
  summaryCell: {
    flex: 1,
    minWidth: '30%',
    borderRadius: 12,
    padding: Spacing.three,
    backgroundColor: BrandColors.primarySoft,
    gap: 3,
  },
  summaryLabel: { color: BrandColors.textMuted, fontSize: 10, fontWeight: '600' },
  summaryValue: { color: BrandColors.text, fontSize: 15, fontWeight: '800' },
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
