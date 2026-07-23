import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { AuthProvider, useAuth } from '@/context/AuthContext';
import { onReconnect } from '@/services/net';
import { syncSalesQueue } from '@/services/offline-queue';
import { emitPendingSalesChanged } from '@/utils/eventBus';

SplashScreen.preventAutoHideAsync();

const LightTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: '#E67E00',
    background: '#F7F4EF',
    card: '#FFFFFF',
    text: '#1C1917',
    border: '#E6DDD2',
    notification: '#FF8C00',
  },
};

function RootNavigator() {
  const { loading } = useAuth();

  useEffect(() => {
    if (!loading) void SplashScreen.hideAsync();
  }, [loading]);

  useEffect(() => {
    return onReconnect(() => {
      syncSalesQueue()
        .then((result) => {
          if (result.synced > 0) emitPendingSalesChanged();
        })
        .catch(() => undefined);
    });
  }, []);

  if (loading) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider value={LightTheme}>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </ThemeProvider>
  );
}
