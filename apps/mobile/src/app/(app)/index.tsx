import { Redirect } from 'expo-router';

import { useAuth } from '@/context/AuthContext';
import { defaultAppHref } from '@/navigation/menu';

export default function AppIndex() {
  const { user } = useAuth();
  return <Redirect href={defaultAppHref(user?.role) as never} />;
}
