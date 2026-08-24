import { Pressable, Text } from 'react-native';

import { ChipScroll } from '@/components/ChipScroll';

import { accountingStyles as styles } from './accountingStyles';

export type AccountingSubTab<T extends string> = { id: T; label: string };

export function AccountingSubTabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: Array<AccountingSubTab<T>>;
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <ChipScroll contentStyle={styles.subTabScroll}>
      {items.map((item) => {
        const active = item.id === value;
        return (
          <Pressable
            key={item.id}
            onPress={() => onChange(item.id)}
            style={[styles.chip, active && styles.chipActive]}>
            <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </ChipScroll>
  );
}
