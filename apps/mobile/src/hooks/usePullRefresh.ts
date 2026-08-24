import { useCallback, useState } from 'react';

/** Hook pull-to-refresh réutilisable (avec ou sans chargeur métier). */
export function usePullRefresh(loader?: () => void | Promise<void>) {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loader?.();
    } finally {
      setRefreshing(false);
    }
  }, [loader]);

  return { refreshing, onRefresh };
}
