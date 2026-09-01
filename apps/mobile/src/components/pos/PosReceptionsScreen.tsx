import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { RefreshableScroll } from '@/components/RefreshableScroll';
import { Screen } from '@/components/Screen';
import { TransferInboxPanel } from '@/components/transfers/TransferInboxPanel';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { canConfirmShopStockReceptions } from '@/utils/user-scope';
import { listInternalTransfers } from '@/services/api';
import type { InternalTransferRow } from '@/types/api';

export function PosReceptionsScreen() {
  const { user, canPerm } = useAuth();
  const allowed = canPerm('transfers.confirm') && canConfirmShopStockReceptions(user);
  const [inbox, setInbox] = useState<InternalTransferRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!allowed) {
      setInbox([]);
      return;
    }
    try {
      const rows = await listInternalTransfers({ inbox: true, status: 'PENDING' });
      setInbox(rows);
    } catch {
      setInbox([]);
    }
  }, [allowed]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (!allowed) {
    return (
      <Screen>
        <View style={styles.blocked}>
          <Text style={styles.blockedText}>Accès refusé.</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <RefreshableScroll refreshing={refreshing} onRefresh={() => void onRefresh()}>
        <View style={styles.body}>
          <TransferInboxPanel inbox={inbox} onChange={setInbox} />
        </View>
      </RefreshableScroll>
    </Screen>
  );
}

const styles = StyleSheet.create({
  blocked: { flex: 1, justifyContent: 'center', padding: Spacing.five },
  blockedText: { textAlign: 'center', color: BrandColors.textMuted },
  body: { padding: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.six },
});
