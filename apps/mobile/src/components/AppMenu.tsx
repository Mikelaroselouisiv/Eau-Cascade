import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { useMemo } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AndroidUpdateCard } from '@/components/AndroidUpdateCard';
import { BrandLogo } from '@/components/BrandLogo';
import { BRAND_NAME, BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { useAppShell } from '@/context/AppShellContext';
import { useAuth } from '@/context/AuthContext';
import { usePendingSalesCount } from '@/hooks/usePendingSalesCount';
import { filterMenuItems, MENU_ITEMS } from '@/navigation/menu';
import { getInstalledAppVersion } from '@/services/app-update';

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrateur',
  MANAGER: 'Gestionnaire',
  CASHIER: 'Caissier',
  STOCK_MANAGER: 'Gestionnaire de stock',
  ACCOUNTANT: 'Comptable',
  LIVREUR: 'Livreur',
};

export function AppMenu() {
  const { menuOpen, closeMenu } = useAppShell();

  return (
    <Modal visible={menuOpen} animationType="fade" transparent onRequestClose={closeMenu}>
      <SafeAreaProvider>
        <AppMenuPanel />
      </SafeAreaProvider>
    </Modal>
  );
}

function AppMenuPanel() {
  const { closeMenu } = useAppShell();
  const { user, logout, can, canPerm } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const pendingCount = usePendingSalesCount();
  const appVersion = getInstalledAppVersion();

  const items = useMemo(
    () => filterMenuItems(MENU_ITEMS, { can, canPerm }),
    [can, canPerm],
  );

  function go(href: string) {
    closeMenu();
    router.push(href as never);
  }

  function confirmLogout() {
    Alert.alert('Déconnexion', 'Voulez-vous vraiment vous déconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Déconnexion',
        style: 'destructive',
        onPress: () => {
          closeMenu();
          logout();
        },
      },
    ]);
  }

  return (
    <View style={styles.overlay}>
      <Pressable style={styles.backdrop} onPress={closeMenu} accessibilityLabel="Fermer le menu" />
      <View
        style={[
          styles.panel,
          { paddingTop: insets.top + Spacing.three, paddingBottom: insets.bottom + Spacing.three },
        ]}>
        <View style={styles.brand}>
          <BrandLogo height={44} />
          <Text style={styles.brandName}>{BRAND_NAME}</Text>
          {user ? (
            <Text style={styles.userMeta}>
              {user.fullName?.trim() || user.phone}
              {user.role ? ` · ${ROLE_LABELS[user.role] ?? user.role}` : ''}
            </Text>
          ) : null}
          {pendingCount > 0 ? (
            <Text style={styles.pending}>
              {pendingCount} vente{pendingCount > 1 ? 's' : ''} hors ligne
            </Text>
          ) : null}
        </View>

        <View style={styles.nav}>
          {items.map((item) => {
            const active =
              pathname === `/${item.key}` ||
              pathname.startsWith(`/${item.key}/`) ||
              (item.key === 'home' && (pathname === '/' || pathname === '/home'));
            return (
              <Pressable
                key={item.key}
                onPress={() => go(item.href)}
                style={({ pressed }) => [
                  styles.navItem,
                  active && styles.navItemActive,
                  pressed && styles.navItemPressed,
                ]}>
                <Ionicons
                  name={item.icon}
                  size={22}
                  color={active ? '#FFFFFF' : BrandColors.text}
                />
                <Text style={[styles.navLabel, active && styles.navLabelActive]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={confirmLogout}
          style={({ pressed }) => [styles.logout, pressed && styles.logoutPressed]}>
          <Ionicons name="log-out-outline" size={22} color={BrandColors.danger} />
          <Text style={styles.logoutLabel}>Déconnexion</Text>
        </Pressable>
        <View style={styles.footer}>
          <Text style={styles.versionLabel}>
            Version {appVersion.version} ({appVersion.versionCode})
          </Text>
          <AndroidUpdateCard />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(28, 25, 23, 0.35)',
  },
  backdrop: { flex: 1 },
  panel: {
    width: '82%',
    maxWidth: 360,
    backgroundColor: BrandColors.surfaceSoft,
    paddingHorizontal: Spacing.three,
    gap: Spacing.four,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: BrandColors.border,
  },
  brand: { gap: Spacing.two, alignItems: 'flex-start' },
  brandName: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: BrandColors.primary,
  },
  userMeta: { fontSize: 14, color: BrandColors.textMuted, lineHeight: 20 },
  pending: { fontSize: 13, fontWeight: '600', color: BrandColors.primaryHover },
  nav: { flex: 1, gap: Spacing.one },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: 14,
    paddingHorizontal: Spacing.three,
    borderRadius: 12,
  },
  navItemActive: { backgroundColor: BrandColors.primary },
  navItemPressed: { opacity: 0.9 },
  navLabel: { fontSize: 16, fontWeight: '600', color: BrandColors.text },
  navLabelActive: { color: '#FFFFFF' },
  logout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: 14,
    paddingHorizontal: Spacing.three,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BrandColors.border,
  },
  logoutPressed: { backgroundColor: '#FEF2F2' },
  logoutLabel: { fontSize: 16, fontWeight: '600', color: BrandColors.danger },
  footer: { alignItems: 'center', gap: 2, paddingTop: Spacing.one },
  versionLabel: {
    fontSize: 11,
    color: BrandColors.textMuted,
    textAlign: 'center',
  },
});
