import { Redirect } from 'expo-router';

import { useAuth } from '@/context/AuthContext';
import { filterTabsForAccess, SECTION_TABS } from '@/navigation/menu';

export default function Index() {
  const { can, canPerm } = useAuth();
  const first =
    filterTabsForAccess(SECTION_TABS.dashboard, { can, canPerm })[0]?.name ?? 'ventes';
  return <Redirect href={`/(app)/dashboard/${first}` as never} />;
}
