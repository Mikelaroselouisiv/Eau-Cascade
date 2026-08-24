import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import type { PeriodKey } from '@/utils/datetime';

const OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: 'day', label: 'Aujourd’hui' },
  { key: 'week', label: '7 jours' },
  { key: 'month', label: 'Mois' },
];

type Props = {
  value: PeriodKey;
  onChange: (value: PeriodKey) => void;
};

export function PeriodChips({ value, onChange }: Props) {
  return (
    <View style={styles.row}>
      {OPTIONS.map((opt) => {
        const active = opt.key === value;
        return (
          <Pressable
            key={opt.key}
            onPress={() => onChange(opt.key)}
            style={[styles.chip, active && styles.chipActive]}>
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    backgroundColor: BrandColors.surface,
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: 'flex-start',
  },
  chipActive: {
    backgroundColor: BrandColors.primary,
    borderColor: BrandColors.primary,
  },
  chipText: { fontSize: 13, fontWeight: '600', color: BrandColors.text },
  chipTextActive: { color: '#fff' },
});
