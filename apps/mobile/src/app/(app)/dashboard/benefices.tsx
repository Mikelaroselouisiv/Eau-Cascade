import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { MoneyText } from '@/components/MoneyText';
import { KpiCard } from '@/components/monitor/KpiCard';
import { PeriodChips } from '@/components/monitor/PeriodChips';
import { RefreshableScroll } from '@/components/RefreshableScroll';
import { Screen } from '@/components/Screen';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useCompanyScope } from '@/hooks/useCompanyScope';
import { getMarginAnalysis } from '@/services/api';
import type { MarginAnalysisReport } from '@/types/api';
import { periodDateRange, type PeriodKey } from '@/utils/datetime';

export default function BeneficesScreen() {
  const { can } = useAuth();
  const { companyId, ready } = useCompanyScope();
  const showCosts = can(['ADMIN']);
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [report, setReport] = useState<MarginAnalysisReport | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (companyId == null) return;
    const { dateFrom, dateTo } = periodDateRange(period);
    try {
      setReport(await getMarginAnalysis({ companyId, dateFrom, dateTo }));
    } catch {
      setReport(null);
    }
  }, [companyId, period]);

  useFocusEffect(
    useCallback(() => {
      if (!ready) return;
      void load();
    }, [load, ready]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <Screen>
      <RefreshableScroll refreshing={refreshing} onRefresh={onRefresh}>
        <PeriodChips value={period} onChange={setPeriod} />
        {report ? (
          <View style={styles.kpiGrid}>
            <KpiCard label="CA" value={report.revenue} money />
            {showCosts ? (
              <>
                <KpiCard label="Coût" value={report.cost} money tone="warn" />
                <KpiCard
                  label="Marge"
                  value={report.margin}
                  money
                  tone={report.margin >= 0 ? 'ok' : 'warn'}
                  hint={
                    report.marginPct != null ? `${report.marginPct.toFixed(1)} %` : undefined
                  }
                />
              </>
            ) : (
              <KpiCard label="Articles" value={String(report.productsCount)} />
            )}
          </View>
        ) : (
          <Text style={styles.empty}>Aucune donnée</Text>
        )}

        <Text style={styles.section}>Par produit</Text>
        {!report || report.products.length === 0 ? (
          <Text style={styles.empty}>Aucun article</Text>
        ) : (
          report.products.slice(0, 30).map((p) => (
            <View key={p.productId} style={styles.row}>
              <View style={styles.rowInfo}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {p.name}
                </Text>
                <Text style={styles.rowMeta}>
                  {p.departmentName ?? '—'} · qty {p.quantity}
                  {showCosts && p.marginPct != null
                    ? ` · marge ${p.marginPct.toFixed(1)} %`
                    : ''}
                </Text>
              </View>
              <View style={styles.rowRight}>
                <MoneyText value={p.revenue} style={styles.rowValue} />
                {showCosts ? (
                  <MoneyText value={p.margin} style={styles.rowMeta} />
                ) : null}
              </View>
            </View>
          ))
        )}
      </RefreshableScroll>
    </Screen>
  );
}

const styles = StyleSheet.create({
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  section: { marginTop: Spacing.two, fontSize: 15, fontWeight: '700', color: BrandColors.text },
  empty: { color: BrandColors.textMuted },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: BrandColors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: Spacing.three,
  },
  rowInfo: { flex: 1, gap: 2 },
  rowTitle: { fontWeight: '600', color: BrandColors.text },
  rowMeta: { fontSize: 12, color: BrandColors.textMuted },
  rowRight: { alignItems: 'flex-end', gap: 2 },
  rowValue: { fontWeight: '700', color: BrandColors.text },
});
