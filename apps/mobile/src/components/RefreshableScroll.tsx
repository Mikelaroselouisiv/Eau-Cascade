import type { ReactNode } from 'react';
import { RefreshControl, StyleSheet } from 'react-native';

import { AppScrollView } from '@/components/AppScrollView';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';

type RefreshableScrollProps = {
  children: ReactNode;
  refreshing: boolean;
  onRefresh: () => void | Promise<void>;
  padded?: boolean;
};

/** Scroll + pull-to-refresh standard pour les écrans de section. */
export function RefreshableScroll({
  children,
  refreshing,
  onRefresh,
  padded = true,
}: RefreshableScrollProps) {
  return (
    <AppScrollView
      padded={padded}
      contentStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            void onRefresh();
          }}
          tintColor={BrandColors.primary}
          colors={[BrandColors.primary]}
        />
      }>
      {children}
    </AppScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.three,
    paddingBottom: Spacing.six,
  },
});
