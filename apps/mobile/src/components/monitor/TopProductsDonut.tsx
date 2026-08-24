import { StyleSheet, Text, View } from 'react-native';

import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import type { DashboardSalesByProductRow } from '@/types/api';
import { formatQuantity } from '@/utils/quantity';

const COLORS = ['#0F4C81', '#3D9B8F', '#2563EB', '#7C3AED', '#DB2777'];

type Props = {
  rows: DashboardSalesByProductRow[];
};

export function TopProductsDonut({ rows }: Props) {
  const bars = [...rows]
    .sort((a, b) => Number(b.quantity) - Number(a.quantity))
    .slice(0, COLORS.length);
  const maximum = Math.max(...bars.map((row) => Number(row.quantity || 0)), 0);

  if (bars.length === 0 || maximum <= 0) {
    return <Text style={styles.empty}>Aucune vente sur la période</Text>;
  }

  return (
    <View style={styles.card} accessibilityLabel="Graphique des articles les plus vendus">
      {bars.map((row, index) => {
        const quantity = Number(row.quantity || 0);
        const width = `${Math.max(6, (quantity / maximum) * 100)}%` as `${number}%`;
        return (
          <View key={`${row.productId}-${row.departmentId}`} style={styles.barGroup}>
            <View style={styles.labelRow}>
              <Text style={styles.name} numberOfLines={1}>
                {row.productName}
              </Text>
              <Text style={styles.value}>{formatQuantity(quantity)}</Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.bar, { width, backgroundColor: COLORS[index] }]} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: BrandColors.surface,
    borderWidth: 1,
    borderColor: BrandColors.border,
    borderRadius: 16,
    padding: Spacing.three,
    gap: 10,
  },
  barGroup: { gap: 4 },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  name: { flex: 1, color: BrandColors.text, fontWeight: '600', fontSize: 12 },
  value: { color: BrandColors.text, fontSize: 12, fontWeight: '800' },
  track: {
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: BrandColors.bgDeep,
  },
  bar: { height: '100%', borderRadius: 6 },
  empty: { color: BrandColors.textMuted },
});
