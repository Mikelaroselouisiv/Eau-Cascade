import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { RefreshableScroll } from '@/components/RefreshableScroll';
import { Screen } from '@/components/Screen';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useCompanyScope } from '@/hooks/useCompanyScope';
import { listDonations } from '@/services/api';
import { printReceipt } from '@/services/bluetooth-printer';
import { buildDonationReceiptData } from '@/services/receipt';
import type { DonationRow } from '@/types/api';
import { formatDateTime } from '@/utils/datetime';
import { formatQuantity } from '@/utils/quantity';

export function DonationHistoryScreen() {
  const { canPerm, user } = useAuth();
  const { companyId, ready } = useCompanyScope();
  const allowed = canPerm('donation.view');
  const [rows, setRows] = useState<DonationRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [printingId, setPrintingId] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);

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

  async function reprint(donation: DonationRow) {
    setPrintingId(donation.id);
    setStatus(null);
    try {
      const data = await buildDonationReceiptData({
        donation,
        beneficiary: {
          name: donation.beneficiary?.name ?? 'Bénéficiaire',
        },
        cashier: user?.fullName?.trim() || user?.phone || 'Caissier',
      });
      await printReceipt(data);
    } catch {
      setStatus('Impression impossible');
    } finally {
      setPrintingId(null);
    }
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
      <RefreshableScroll
        refreshing={refreshing}
        onRefresh={async () => {
          setRefreshing(true);
          await load();
          setRefreshing(false);
        }}>
        <View style={styles.body}>
          {status ? <Text style={styles.error}>{status}</Text> : null}
          {rows.length === 0 ? <Text style={styles.meta}>Aucun don</Text> : null}
          {rows.map((d) => (
            <View key={d.id} style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.title}>
                  {d.beneficiary?.name ?? 'Bénéficiaire'} · {d.department?.name}
                </Text>
                <Pressable
                  onPress={() => void reprint(d)}
                  disabled={printingId === d.id}
                  hitSlop={8}>
                  <Ionicons name="print-outline" size={20} color={BrandColors.primary} />
                </Pressable>
              </View>
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
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  title: { flex: 1, fontWeight: '700', color: BrandColors.text },
  meta: { color: BrandColors.textMuted },
  error: { color: BrandColors.danger, fontWeight: '600' },
});
