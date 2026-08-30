import { Redirect } from 'expo-router';

import { useAuth } from '@/context/AuthContext';
import { filterTabsForAccess, SECTION_TABS } from '@/navigation/menu';

export default function Index() {
  const { can, canPerm, user } = useAuth();
  const first =
    filterTabsForAccess(SECTION_TABS.stock, {
      can,
      canPerm,
      role: user?.role,
      productionDepartmentIds: user?.productionDepartmentIds,
    })[0]?.name ?? 'achats';
  return <Redirect href={`/(app)/stock/${first}` as never} />;
}
