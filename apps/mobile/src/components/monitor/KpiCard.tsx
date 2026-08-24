import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MoneyText } from '@/components/MoneyText';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';

type Props = {
  label: string;
  value: ReactNode;
  /** Si true, affiche le montant avec HTG en petit. */
  money?: boolean;
  hint?: string;
  tone?: 'default' | 'ok' | 'warn';
};

export function KpiCard({ label, value, money = false, hint, tone = 'default' }: Props) {
  const valueColor =
    tone === 'ok' ? BrandColors.ok : tone === 'warn' ? BrandColors.danger : BrandColors.text;

  return (
    <View style={styles.card}>
      <Text style={styles.label}>{label}</Text>
      {money && (typeof value === 'string' || typeof value === 'number' || value == null) ? (
        <MoneyText
          value={value as string | number | null | undefined}
          style={[styles.value, { color: valueColor }]}
          currencyStyle={styles.currency}
        />
      ) : (
        <Text style={[styles.value, { color: valueColor }]}>{value}</Text>
      )}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: '46%',
    backgroundColor: BrandColors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: Spacing.three,
    gap: 4,
  },
  label: { fontSize: 13, fontWeight: '600', color: BrandColors.textMuted },
  value: { fontSize: 24, fontWeight: '700', letterSpacing: -0.3 },
  currency: { fontSize: 12, fontWeight: '700', color: BrandColors.textMuted },
  hint: { fontSize: 12, color: BrandColors.textMuted },
});
