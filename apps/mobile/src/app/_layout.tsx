import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { AndroidUpdatePrompt } from '@/components/AndroidUpdatePrompt';
import { WaterBackground } from '@/components/WaterBackground';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { onReconnect } from '@/services/net';
import { syncSalesQueue } from '@/services/offline-queue';
import { emitPendingSalesChanged } from '@/utils/eventBus';

SplashScreen.preventAutoHideAsync();

const LightTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: '#0F4C81',
    background: 'transparent',
    card: '#FFFFFF',
    text: '#0A2540',
    border: '#C5DDE0',
    notification: '#3D9B8F',
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

  return (
    <>
      <AndroidUpdatePrompt />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="(app)" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider value={LightTheme}>
      <AuthProvider>
        <WaterBackground>
          <RootNavigator />
        </WaterBackground>
      </AuthProvider>
    </ThemeProvider>
  );
}
