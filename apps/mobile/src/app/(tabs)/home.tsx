import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { LogoutButton } from '@/components/LogoutButton';
import { Screen } from '@/components/Screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { usePendingSalesCount } from '@/hooks/usePendingSalesCount';

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrateur',
  MANAGER: 'Gestionnaire',
  CASHIER: 'Caissier',
  STOCK_MANAGER: 'Gestionnaire de stock',
  ACCOUNTANT: 'Comptable',
};

export default function HomeScreen() {
  const { user, canPerm } = useAuth();
  const router = useRouter();
  const pendingCount = usePendingSalesCount();
  const canSeeDashboard = canPerm('dashboard.view');
  const displayName = user?.fullName?.trim() || user?.phone || '';

  const shortcuts = [
    { title: 'Caisse', description: 'Encaisser une vente', href: '/(tabs)/pos' as const },
    ...(canSeeDashboard
      ? [{ title: 'Moniteur', description: 'Ventes du jour et alertes', href: '/(tabs)/dashboard' as const }]
      : []),
    { title: 'Imprimante', description: 'Appairage et réglages ticket', href: '/(tabs)/printer-settings' as const },
  ];

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View>
          <ThemedText type="title" style={styles.title}>
            Bonjour{displayName ? `, ${displayName}` : ''}
          </ThemedText>
          {user?.role && (
            <ThemedText themeColor="textSecondary">{ROLE_LABELS[user.role] ?? user.role}</ThemedText>
          )}
        </View>

        {pendingCount > 0 && (
          <ThemedView type="backgroundSelected" style={styles.pendingCard}>
            <ThemedText type="smallBold">{pendingCount} vente(s) en attente de synchronisation</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Elles seront envoyées automatiquement dès qu&apos;une connexion réseau est disponible.
            </ThemedText>
          </ThemedView>
        )}

        <View style={styles.shortcuts}>
          {shortcuts.map((shortcut) => (
            <Pressable
              key={shortcut.href}
              style={styles.card}
              onPress={() => router.push(shortcut.href)}>
              <ThemedText type="smallBold">{shortcut.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {shortcut.description}
              </ThemedText>
            </Pressable>
          ))}
        </View>

        <View style={styles.logoutRow}>
          <LogoutButton />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.four, gap: Spacing.four, flexGrow: 1 },
  title: { fontSize: 28 },
  pendingCard: { padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.half },
  shortcuts: { gap: Spacing.three },
  card: {
    padding: Spacing.four,
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderColor: '#8886',
    gap: Spacing.half,
  },
  logoutRow: { alignItems: 'flex-start' },
});
