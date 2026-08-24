import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { BrandColors } from '@/constants/brand';
import { useAuth } from '@/context/AuthContext';
import { filterTabsForAccess, type SectionTab } from '@/navigation/menu';

type SectionTabsLayoutProps = {
  tabs: SectionTab[];
  /** Routes Expo présentes dans le dossier mais hors barre d’onglets. */
  hiddenScreens?: string[];
};

/** Onglets bas de page pour une section (parité desktop). */
export function SectionTabsLayout({ tabs, hiddenScreens = [] }: SectionTabsLayoutProps) {
  const { can, canPerm } = useAuth();
  const visible = filterTabsForAccess(tabs, { can, canPerm });

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: BrandColors.primary,
        tabBarInactiveTintColor: BrandColors.textMuted,
        tabBarStyle: {
          backgroundColor: BrandColors.surfaceSoft,
          borderTopColor: BrandColors.border,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}>
      <Tabs.Screen name="index" options={{ href: null }} />
      {hiddenScreens.map((name) => (
        <Tabs.Screen key={name} name={name} options={{ href: null }} />
      ))}
      {tabs.map((tab) => {
        const show = visible.some((t) => t.name === tab.name);
        return (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            options={{
              title: tab.title,
              href: show ? undefined : null,
              tabBarIcon: ({ color, size }) => (
                <Ionicons name={tab.icon} size={size} color={color} />
              ),
            }}
          />
        );
      })}
    </Tabs>
  );
}
