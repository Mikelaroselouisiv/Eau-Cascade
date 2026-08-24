import { StyleSheet, Text, View } from 'react-native';

import { RefreshableScroll } from '@/components/RefreshableScroll';
import { Screen } from '@/components/Screen';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { usePullRefresh } from '@/hooks/usePullRefresh';

type SectionPlaceholderProps = {
  title: string;
  description?: string;
  onRefresh?: () => void | Promise<void>;
};

/** Contenu provisoire d’un onglet de section (structure Phase 3). */
export function SectionPlaceholder({
  title,
  description = 'Contenu à venir — structure de navigation en place.',
  onRefresh,
}: SectionPlaceholderProps) {
  const { refreshing, onRefresh: refresh } = usePullRefresh(onRefresh);

  return (
    <Screen edges="tabs">
      <RefreshableScroll refreshing={refreshing} onRefresh={refresh}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.description}>{description}</Text>
        </View>
      </RefreshableScroll>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: BrandColors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: BrandColors.text,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    color: BrandColors.textMuted,
  },
});
