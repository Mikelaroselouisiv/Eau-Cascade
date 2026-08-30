import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  useReducedMotion,
} from 'react-native-reanimated';

import { AppScrollView } from '@/components/AppScrollView';
import { BrandLogo } from '@/components/BrandLogo';
import { Screen } from '@/components/Screen';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { usePendingSalesCount } from '@/hooks/usePendingSalesCount';
import { filterMenuItems, MENU_ITEMS } from '@/navigation/menu';
import { formatRoleLabel } from '@/utils/roleLabels';

export default function HomeScreen() {
  const { user, can, canPerm } = useAuth();
  const router = useRouter();
  const pendingCount = usePendingSalesCount();
  const reduceMotion = useReducedMotion();
  const displayName = user?.fullName?.trim() || user?.phone || '';
  const roleLabel = user?.role ? formatRoleLabel(user.role, user.roleLabel) : '';

  const shortcuts = filterMenuItems(MENU_ITEMS, { can, canPerm, role: user?.role })
    .filter((item) => item.key !== 'home')
    .slice(0, 3);

  const enter = (delayMs: number) =>
    reduceMotion
      ? undefined
      : FadeInDown.delay(delayMs).duration(520).easing(Easing.out(Easing.cubic));

  return (
    <Screen edges="tabs" style={styles.screen}>
      <AppScrollView contentStyle={styles.composition}>
        <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(700)} style={styles.brandBlock}>
          <BrandLogo height={88} />
        </Animated.View>

        <Animated.View entering={enter(120)} style={styles.copyBlock}>
          <Text style={styles.headline}>
            Bonjour{displayName ? `, ${displayName}` : ''}
          </Text>
          <Text style={styles.support}>
            {roleLabel
              ? `${roleLabel} · Point de vente mobile`
              : 'Point de vente mobile'}
          </Text>
          {pendingCount > 0 ? (
            <Text style={styles.pendingHint}>
              {pendingCount} vente{pendingCount > 1 ? 's' : ''} hors ligne en attente de sync
            </Text>
          ) : null}
        </Animated.View>

        <Animated.View entering={enter(260)} style={styles.ctaGroup}>
          {shortcuts.map((item, index) => {
            const primary = index === 0;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                onPress={() => router.push(item.href as never)}
                style={({ pressed }) => [
                  primary ? styles.ctaPrimary : styles.ctaSecondary,
                  primary && pressed && styles.ctaPrimaryPressed,
                  !primary && pressed && styles.ctaSecondaryPressed,
                ]}>
                <Ionicons
                  name={item.icon}
                  size={primary ? 22 : 20}
                  color={primary ? '#FFFFFF' : BrandColors.primary}
                />
                <Text style={primary ? styles.ctaPrimaryLabel : styles.ctaSecondaryLabel}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </Animated.View>
      </AppScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  composition: {
    flexGrow: 1,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.five,
    paddingBottom: Spacing.four,
    justifyContent: 'center',
    gap: Spacing.five,
  },
  brandBlock: {
    alignItems: 'center',
  },
  copyBlock: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  headline: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    color: BrandColors.text,
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  support: {
    fontSize: 16,
    lineHeight: 22,
    color: BrandColors.textMuted,
    textAlign: 'center',
  },
  pendingHint: {
    marginTop: Spacing.one,
    fontSize: 13,
    lineHeight: 18,
    color: BrandColors.primaryHover,
    textAlign: 'center',
    fontWeight: '600',
  },
  ctaGroup: {
    gap: Spacing.three,
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  ctaPrimary: {
    minHeight: 56,
    borderRadius: 14,
    backgroundColor: BrandColors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  ctaPrimaryPressed: {
    backgroundColor: BrandColors.primaryHover,
  },
  ctaPrimaryLabel: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  ctaSecondary: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    backgroundColor: 'rgba(255,255,255,0.55)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  ctaSecondaryPressed: {
    backgroundColor: BrandColors.primarySoft,
  },
  ctaSecondaryLabel: {
    color: BrandColors.text,
    fontSize: 16,
    fontWeight: '600',
  },
});
