import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { useAppShell } from '@/context/AppShellContext';

type AppHeaderProps = {
  title?: string;
};

export function AppHeader({ title = 'POS' }: AppHeaderProps) {
  const insets = useSafeAreaInsets();
  const { openMenu } = useAppShell();

  return (
    <View style={[styles.wrap, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ouvrir le menu"
          hitSlop={12}
          onPress={openMenu}
          style={({ pressed }) => [styles.menuBtn, pressed && styles.menuBtnPressed]}>
          <Ionicons name="menu" size={26} color={BrandColors.text} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: BrandColors.surfaceSoft,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BrandColors.border,
  },
  bar: {
    minHeight: 52,
    paddingHorizontal: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: BrandColors.text,
    letterSpacing: -0.2,
  },
  menuBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(230, 126, 0, 0.08)',
  },
  menuBtnPressed: {
    backgroundColor: BrandColors.primarySoft,
  },
});
