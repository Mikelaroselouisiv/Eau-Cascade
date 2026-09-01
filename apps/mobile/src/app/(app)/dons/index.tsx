import { Redirect } from 'expo-router';

import { useAuth } from '@/context/AuthContext';
import { filterTabsForAccess, SECTION_TABS } from '@/navigation/menu';

export default function Index() {
  const { can, canPerm, user } = useAuth();
  const first =
    filterTabsForAccess(SECTION_TABS.dons, {
      can,
      canPerm,
      role: user?.role,
      productionDepartmentIds: user?.productionDepartmentIds,
      departmentIds: user?.departmentIds,
    })[0]?.name ?? 'overview';
  return <Redirect href={`/(app)/dons/${first}` as never} />;
}
