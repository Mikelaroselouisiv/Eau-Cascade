import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { LogoutButton } from '@/components/LogoutButton';
import { useAuth } from '@/context/AuthContext';

export default function TabsLayout() {
  const { user, canPerm } = useAuth();

  if (!user) return <Redirect href="/login" />;

  const canSeeDashboard = canPerm('dashboard.view');

  return (
    <Tabs screenOptions={{ headerShown: true, headerRight: () => <LogoutButton /> }}>
      <Tabs.Screen
        name="home"
        options={{
          title: 'Accueil',
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="pos"
        options={{
          title: 'Caisse',
          tabBarIcon: ({ color, size }) => <Ionicons name="cart-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Moniteur',
          href: canSeeDashboard ? undefined : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="printer-settings"
        options={{
          title: 'Imprimante',
          tabBarIcon: ({ color, size }) => <Ionicons name="print-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
