import { forwardRef } from 'react';
import {
  ScrollView,
  StyleSheet,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Spacing } from '@/constants/theme';

type AppScrollViewProps = ScrollViewProps & {
  contentStyle?: StyleProp<ViewStyle>;
  /** Padding horizontal standard des écrans. */
  padded?: boolean;
};

/**
 * ScrollView standard app :
 * - clavier : taps persistants + dismiss interactif
 * - iOS : ajustement automatique des insets
 * - contenu toujours scrollable (flexGrow)
 */
export const AppScrollView = forwardRef<ScrollView, AppScrollViewProps>(
  function AppScrollView(
    {
      children,
      contentStyle,
      padded = false,
      keyboardShouldPersistTaps = 'handled',
      keyboardDismissMode = 'interactive',
      showsVerticalScrollIndicator = false,
      contentContainerStyle,
      ...rest
    },
    ref,
  ) {
    return (
      <ScrollView
        ref={ref}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        keyboardDismissMode={keyboardDismissMode}
        showsVerticalScrollIndicator={showsVerticalScrollIndicator}
        automaticallyAdjustKeyboardInsets
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.grow,
          padded && styles.padded,
          contentContainerStyle,
          contentStyle,
        ]}
        {...rest}>
        {children}
      </ScrollView>
    );
  },
);

const styles = StyleSheet.create({
  grow: { flexGrow: 1 },
  padded: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
});
