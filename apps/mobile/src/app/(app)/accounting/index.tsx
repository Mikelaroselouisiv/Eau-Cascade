import { Redirect } from 'expo-router';

import { useAuth } from '@/context/AuthContext';
import { filterTabsForAccess, SECTION_TABS } from '@/navigation/menu';

export default function Index() {
  const { can, canPerm } = useAuth();
  const first =
    filterTabsForAccess(SECTION_TABS.accounting, { can, canPerm })[0]?.name ?? 'consulter';
  return <Redirect href={`/(app)/accounting/${first}` as never} />;
}
