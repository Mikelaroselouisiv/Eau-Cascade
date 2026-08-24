import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View, StyleSheet } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { AppMenu } from '@/components/AppMenu';
import { BrandColors } from '@/constants/brand';
import { AppShellProvider } from '@/context/AppShellContext';
import { useAuth } from '@/context/AuthContext';
import { SECTION_TITLES } from '@/navigation/menu';

function AppStack() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={BrandColors.primary} size="large" />
      </View>
    );
  }

  if (!user) return <Redirect href="/login" />;

  return (
    <View style={styles.root}>
      <Stack
        screenOptions={({ route }) => {
          const root = route.name.split('/')[0];
          const title = SECTION_TITLES[root] ?? SECTION_TITLES[route.name] ?? 'POS';
          return {
            header: () => <AppHeader title={title} />,
            contentStyle: { backgroundColor: BrandColors.bg },
            animation: 'fade',
          };
        }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="home" options={{ header: () => <AppHeader title="Accueil" /> }} />
        <Stack.Screen name="pos" options={{ header: () => <AppHeader title="Caisse" /> }} />
        <Stack.Screen name="deliveries" options={{ header: () => <AppHeader title="Livraisons" /> }} />
        <Stack.Screen name="dashboard" options={{ header: () => <AppHeader title="Tableau de bord" /> }} />
        <Stack.Screen name="credit" options={{ header: () => <AppHeader title="Crédit" /> }} />
        <Stack.Screen name="stock" options={{ header: () => <AppHeader title="Stocks" /> }} />
        <Stack.Screen name="accounting" options={{ header: () => <AppHeader title="Comptabilité" /> }} />
        <Stack.Screen name="config" options={{ header: () => <AppHeader title="Configuration" /> }} />
      </Stack>
      <AppMenu />
    </View>
  );
}

export default function AppLayout() {
  return (
    <AppShellProvider>
      <AppStack />
    </AppShellProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BrandColors.bg },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BrandColors.bg,
  },
});
