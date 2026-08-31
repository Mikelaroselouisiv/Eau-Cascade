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

export function makeRefreshControl(
  refreshing: boolean,
  onRefresh: () => void | Promise<void>,
) {
  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={() => {
        void onRefresh();
      }}
      tintColor={BrandColors.primary}
      colors={[BrandColors.primary]}
    />
  );
}

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
      alwaysBounceVertical
      bounces
      contentStyle={styles.content}
      refreshControl={makeRefreshControl(refreshing, onRefresh)}>
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
