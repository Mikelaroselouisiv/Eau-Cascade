import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { Spacing } from '@/constants/theme';

type ChipScrollProps = {
  children: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
};

/**
 * Rangée d’onglets / chips horizontale.
 * Un ScrollView RN a flexGrow: 1 par défaut : en colonne flex il s’étire en hauteur
 * et les pills deviennent des capsules verticales. Ici la rangée reste collée au contenu.
 */
export function ChipScroll({ children, contentStyle }: ChipScrollProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={styles.scroll}
      contentContainerStyle={[styles.content, contentStyle]}>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    alignContent: 'center',
    flexGrow: 0,
    gap: Spacing.two,
    paddingVertical: 2,
  },
});
