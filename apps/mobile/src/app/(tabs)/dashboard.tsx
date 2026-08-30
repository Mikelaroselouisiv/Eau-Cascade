import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { getDashboardSummary, getInventoryAlerts, listSales } from '@/services/api';
import type { DashboardSummaryReport, Product, Sale } from '@/types/api';
import { formatDateTime } from '@/utils/datetime';
import { isSaleDeleted } from '@/utils/saleRef';

function isForbidden(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'response' in e &&
    (e as { response?: { status?: number } }).response?.status === 403
  );
}

export default function DashboardScreen() {
  const { user, canPerm } = useAuth();
  const companyId = typeof user?.companyId === 'number' ? user.companyId : undefined;
  const canSeeSummary = canPerm('dashboard.view');

  const [summary, setSummary] = useState<DashboardSummaryReport | null>(null);
  const [recentSales, setRecentSales] = useState<Sale[]>([]);
  const [alerts, setAlerts] = useState<Product[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (canSeeSummary && companyId != null) {
      try {
        setSummary(await getDashboardSummary({ companyId }));
      } catch (e) {
        if (!isForbidden(e)) setSummary(null);
      }
    }
    if (companyId != null) {
      try {
        const result = await listSales({ companyId, take: 10 });
        setRecentSales(result.items);
      } catch {
        setRecentSales([]);
      }
    }
    try {
      const result = await getInventoryAlerts({ threshold: 5, companyId });
      setAlerts(result.items);
    } catch {
      setAlerts([]);
    }
  }, [canSeeSummary, companyId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <Screen>
      <FlatList
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        data={[]}
        keyExtractor={() => 'noop'}
        renderItem={null}
        ListHeaderComponent={
          <View style={styles.headerGap}>
            {canSeeSummary && summary && (
              <ThemedView type="backgroundElement" style={styles.card}>
                <ThemedText type="smallBold">Aujourd&apos;hui</ThemedText>
                <ThemedText type="title" style={styles.summaryNumber}>
                  {summary.day.sales.toFixed(2)}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Solde: {summary.day.balance.toFixed(2)} ({summary.day.trend})
                </ThemedText>
              </ThemedView>
            )}

            <View>
              <ThemedText type="smallBold" style={styles.sectionTitle}>
                Ventes récentes
              </ThemedText>
              {recentSales.length === 0 ? (
                <ThemedText themeColor="textSecondary">Aucune vente récente</ThemedText>
              ) : (
                recentSales.map((sale) => (
                  <ThemedView key={sale.id} type="backgroundElement" style={styles.row}>
                    <ThemedText style={isSaleDeleted(sale) ? styles.deletedText : undefined}>
                      #{sale.id}
                    </ThemedText>
                    <ThemedText
                      themeColor="textSecondary"
                      type="small"
                      style={isSaleDeleted(sale) ? styles.deletedText : undefined}>
                      {formatDateTime(sale.createdAt)}
                    </ThemedText>
                    <ThemedText
                      type="smallBold"
                      style={isSaleDeleted(sale) ? styles.deletedText : undefined}>
                      {Number(sale.total).toFixed(2)}
                    </ThemedText>
                  </ThemedView>
                ))
              )}
            </View>

            <View>
              <ThemedText type="smallBold" style={styles.sectionTitle}>
                Alertes stock
              </ThemedText>
              {alerts.length === 0 ? (
                <ThemedText themeColor="textSecondary">Aucune alerte</ThemedText>
              ) : (
                alerts.map((product) => (
                  <ThemedView key={product.id} type="backgroundElement" style={styles.row}>
                    <ThemedText numberOfLines={1} style={styles.alertLabel}>
                      {product.name}
                    </ThemedText>
                    <ThemedText type="smallBold">
                      {Number(product.stock)} / min {Number(product.stockMin)}
                    </ThemedText>
                  </ThemedView>
                ))
              )}
            </View>
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.four, flexGrow: 1 },
  headerGap: { gap: Spacing.four },
  card: { padding: Spacing.four, borderRadius: Spacing.three, gap: Spacing.one },
  summaryNumber: { fontSize: 36 },
  sectionTitle: { marginBottom: Spacing.two },
  alertLabel: { flex: 1 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.three,
    borderRadius: Spacing.two,
    marginBottom: Spacing.one,
  },
  deletedText: {
    color: '#DC2626',
    textDecorationLine: 'line-through',
  },
});
