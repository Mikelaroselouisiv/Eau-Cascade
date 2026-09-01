import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { RefreshableScroll } from '@/components/RefreshableScroll';
import { Screen } from '@/components/Screen';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useCompanyScope } from '@/hooks/useCompanyScope';
import { listDonations } from '@/services/api';
import type { DonationRow } from '@/types/api';
import { formatDateTime } from '@/utils/datetime';
import { formatQuantity } from '@/utils/quantity';

export function DonationHistoryScreen() {
  const { canPerm } = useAuth();
  const { companyId, ready } = useCompanyScope();
  const allowed = canPerm('donation.view');
  const [rows, setRows] = useState<DonationRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!allowed || companyId == null) return;
    try {
      setRows(await listDonations({ companyId }));
    } catch {
      setRows([]);
    }
  }, [allowed, companyId]);

  useFocusEffect(
    useCallback(() => {
      if (!ready) return;
      void load();
    }, [load, ready]),
  );

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
      <RefreshableScroll
        refreshing={refreshing}
        onRefresh={async () => {
          setRefreshing(true);
          await load();
          setRefreshing(false);
        }}>
        <View style={styles.body}>
          {rows.length === 0 ? <Text style={styles.meta}>Aucun don</Text> : null}
          {rows.map((d) => (
            <View key={d.id} style={styles.card}>
              <Text style={styles.title}>
                {d.beneficiary?.name ?? 'Bénéficiaire'} · {d.department?.name}
              </Text>
              <Text style={styles.meta}>{formatDateTime(d.createdAt)}</Text>
              {d.items.map((it) => (
                <Text key={it.id} style={styles.meta}>
                  {it.product?.name} · {formatQuantity(it.quantity)}
                </Text>
              ))}
            </View>
          ))}
        </View>
      </RefreshableScroll>
    </Screen>
  );
}

const styles = StyleSheet.create({
  blocked: { flex: 1, justifyContent: 'center', padding: Spacing.five },
  blockedText: { textAlign: 'center', color: BrandColors.textMuted },
  body: { padding: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.six },
  card: {
    backgroundColor: BrandColors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: Spacing.three,
    gap: 4,
  },
  title: { fontWeight: '700', color: BrandColors.text },
  meta: { color: BrandColors.textMuted },
});
