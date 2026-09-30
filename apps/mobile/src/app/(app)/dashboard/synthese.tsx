import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { useFocusEffect } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ChipScroll } from '@/components/ChipScroll';

import { AuditJournalPanel } from '@/components/monitor/AuditJournalPanel';
import { KpiCard } from '@/components/monitor/KpiCard';
import { DashboardDateFilter } from '@/components/monitor/DashboardDateFilter';
import { RegisterSessionsPanel } from '@/components/monitor/RegisterSessionsPanel';
import { ProductionSessionsPanel } from '@/components/monitor/ProductionSessionsPanel';
import { RevenueTrendChart } from '@/components/monitor/RevenueTrendChart';
import { SyntheseFloorPanel } from '@/components/monitor/SyntheseFloorPanel';
import { RefreshableScroll } from '@/components/RefreshableScroll';
import { Screen } from '@/components/Screen';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useCompanyScope } from '@/hooks/useCompanyScope';
import { getDashboardSummaryRange } from '@/services/api';
import type { DashboardBalanceSnapshot } from '@/types/api';
import { loadDashboardSalesSeries, type SalesSeriesPoint } from '@/utils/dashboard-series';
import {
  businessTodayYmd,
  dashboardPresetRange,
  recentHistoryMinYmd,
  type DashboardSeriesGrain,
} from '@/utils/datetime';

export default function SyntheseScreen() {
  const { can, canPerm, user } = useAuth();
  const canSeeUnlimitedRange = can(['ADMIN']) || canPerm('reports.view');
  const canSeeSynthesis =
    canSeeUnlimitedRange ||
    canPerm('dashboard.synthesis') ||
    canPerm('sales.recent_totals');
  const salesRecentMinYmd = canSeeUnlimitedRange ? null : recentHistoryMinYmd();
  const { companyId, companies, setCompanyId, ready, lockedToSession } = useCompanyScope();
  const [range, setRange] = useState(() => dashboardPresetRange('week'));
  const [grain, setGrain] = useState<DashboardSeriesGrain>('day');
  const [snapshot, setSnapshot] = useState<DashboardBalanceSnapshot | null>(null);
  const [series, setSeries] = useState<SalesSeriesPoint[]>([]);
  const [seriesGrain, setSeriesGrain] = useState<DashboardSeriesGrain>('day');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'overview' | 'caisse' | 'production' | 'audit'>('overview');
  const todayYmd = businessTodayYmd();
  const dateFrom =
    salesRecentMinYmd && range.dateFrom < salesRecentMinYmd
      ? salesRecentMinYmd
      : range.dateFrom;
  const dateTo = salesRecentMinYmd && range.dateTo > todayYmd ? todayYmd : range.dateTo;

  const loadFinance = useCallback(async () => {
    if (!canSeeSynthesis || companyId == null) return;
    try {
      setError(null);
      const [snap, points] = await Promise.all([
        getDashboardSummaryRange({ companyId, dateFrom, dateTo }),
        loadDashboardSalesSeries({
          companyId,
          dateFrom,
          dateTo,
          grain,
        }),
      ]);
      setSnapshot(snap);
      setSeries(points);
      setSeriesGrain(grain);
    } catch {
      setError('Impossible de charger les chiffres');
      setSnapshot(null);
      setSeries([]);
    }
  }, [canSeeSynthesis, companyId, dateFrom, dateTo, grain]);

  useEffect(() => {
    if (!ready || view !== 'overview') return;
    const timer = setTimeout(() => void loadFinance(), 0);
    return () => clearTimeout(timer);
  }, [loadFinance, ready, view]);

  const skipNextFocusRefresh = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (!ready || view !== 'overview') return;
      if (skipNextFocusRefresh.current) {
        skipNextFocusRefresh.current = false;
        return;
      }
      setRefreshKey((key) => key + 1);
      void loadFinance();
    }, [loadFinance, ready, view]),
  );

  async function onRefresh() {
    setRefreshing(true);
    try {
      if (view === 'overview') {
        setRefreshKey((key) => key + 1);
        await loadFinance();
      } else {
        setRefreshKey((key) => key + 1);
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    } finally {
      setRefreshing(false);
    }
  }

  if (!canSeeSynthesis) {
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
      <RefreshableScroll refreshing={refreshing} onRefresh={onRefresh}>
        {!lockedToSession && companies.length > 1 ? (
          <ChipScroll>
            {companies.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => setCompanyId(c.id)}
                style={[styles.companyChip, companyId === c.id && styles.companyChipActive]}>
                <Text
                  style={[
                    styles.companyChipText,
                    companyId === c.id && styles.companyChipTextActive,
                  ]}
                  numberOfLines={1}>
                  {c.name}
                </Text>
              </Pressable>
            ))}
          </ChipScroll>
        ) : null}

        <ChipScroll contentStyle={styles.viewSwitch}>
          <ViewSwitchButton
            icon="pulse-outline"
            label="Terrain"
            active={view === 'overview'}
            onPress={() => {
              setView('overview');
              setRefreshKey((key) => key + 1);
            }}
          />
          <ViewSwitchButton
            icon="storefront-outline"
            label="Caisse"
            active={view === 'caisse'}
            onPress={() => setView('caisse')}
          />
          <ViewSwitchButton
            icon="construct-outline"
            label="Production"
            active={view === 'production'}
            onPress={() => setView('production')}
          />
          <ViewSwitchButton
            icon="shield-checkmark-outline"
            label="Audit"
            active={view === 'audit'}
            onPress={() => setView('audit')}
          />
        </ChipScroll>

        {view !== 'overview' ? (
          <DashboardDateFilter
            dateFrom={dateFrom}
            dateTo={dateTo}
            onChange={(nextFrom, nextTo) => setRange({ dateFrom: nextFrom, dateTo: nextTo })}
            minYmd={salesRecentMinYmd}
          />
        ) : null}

        {error && view !== 'overview' ? <Text style={styles.error}>{error}</Text> : null}
        {ready && companyId == null ? (
          <Text style={styles.error}>Aucune entreprise disponible pour le monitoring.</Text>
        ) : null}

        {view === 'overview' ? (
          <>
            {companyId != null ? (
              <SyntheseFloorPanel
                companyId={companyId}
                user={user}
                refreshKey={refreshKey}
                canSeeQueue={canPerm('deliveries.view')}
                canSeeRegisters={
                  canPerm('dashboard.view') ||
                  canPerm('dashboard.synthesis') ||
                  canPerm('stores.manage')
                }
                canSeeStock={
                  canPerm('stock.view') || canPerm('stock.global') || canPerm('products.view')
                }
                canSeeSales={
                  canPerm('sales.view') ||
                  canPerm('sales.recent_totals') ||
                  canPerm('reports.view')
                }
                canSeeProduction={
                  canPerm('dashboard.view') ||
                  canPerm('dashboard.synthesis') ||
                  canPerm('stores.manage') ||
                  canPerm('production.use')
                }
              />
            ) : null}

            <View style={styles.financeBlock}>
              <Text style={styles.financeTitle}>Chiffres</Text>
              <DashboardDateFilter
                dateFrom={dateFrom}
                dateTo={dateTo}
                onChange={(nextFrom, nextTo) => setRange({ dateFrom: nextFrom, dateTo: nextTo })}
                minYmd={salesRecentMinYmd}
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              {snapshot ? (
                <View style={styles.kpiGrid}>
                  <KpiCard label="CA" value={snapshot.sales} money />
                  <KpiCard label="Sorties" value={snapshot.totalOutflows} money tone="warn" />
                  <KpiCard
                    label="Résultat"
                    value={snapshot.balance}
                    money
                    tone={snapshot.balance >= 0 ? 'ok' : 'warn'}
                    hint={snapshot.trend}
                  />
                  <KpiCard label="Dépenses manuelles" value={snapshot.manualExpenses} money />
                </View>
              ) : ready && companyId != null && !error ? (
                <Text style={styles.empty}>Chargement…</Text>
              ) : null}

              {snapshot ? (
                <>
                  <ChipScroll>
                    <Pressable
                      onPress={() => setGrain('day')}
                      style={[styles.grainChip, grain === 'day' && styles.grainChipActive]}>
                      <Text style={[styles.grainText, grain === 'day' && styles.grainTextActive]}>
                        Jour
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setGrain('month')}
                      style={[styles.grainChip, grain === 'month' && styles.grainChipActive]}>
                      <Text style={[styles.grainText, grain === 'month' && styles.grainTextActive]}>
                        Mois
                      </Text>
                    </Pressable>
                  </ChipScroll>
                  <RevenueTrendChart rows={series} grain={seriesGrain} />
                </>
              ) : null}
            </View>
          </>
        ) : null}

        {companyId != null && view === 'caisse' ? (
          <RegisterSessionsPanel
            companyId={companyId}
            dateFrom={dateFrom}
            dateTo={dateTo}
            refreshKey={refreshKey}
          />
        ) : null}

        {companyId != null && view === 'production' ? (
          <ProductionSessionsPanel
            companyId={companyId}
            dateFrom={dateFrom}
            dateTo={dateTo}
            refreshKey={refreshKey}
          />
        ) : null}

        {companyId != null && view === 'audit' ? (
          <AuditJournalPanel
            companyId={companyId}
            dateFrom={dateFrom}
            dateTo={dateTo}
            refreshKey={refreshKey}
          />
        ) : null}
      </RefreshableScroll>
    </Screen>
  );
}

function ViewSwitchButton({
  icon,
  label,
  active,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.viewButton, active && styles.viewButtonActive]} onPress={onPress}>
      <Ionicons name={icon} size={17} color={active ? '#fff' : BrandColors.textMuted} />
      <Text style={[styles.viewButtonText, active && styles.viewButtonTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  blocked: { flex: 1, justifyContent: 'center', padding: Spacing.five },
  blockedText: { textAlign: 'center', color: BrandColors.textMuted },
  companyChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    backgroundColor: BrandColors.surface,
    maxWidth: 200,
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: 'center',
  },
  companyChipActive: { backgroundColor: BrandColors.primary, borderColor: BrandColors.primary },
  companyChipText: { fontWeight: '600', color: BrandColors.text, fontSize: 13 },
  companyChipTextActive: { color: '#fff' },
  error: { color: BrandColors.danger, fontWeight: '600' },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  empty: { color: BrandColors.textMuted },
  grainChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    backgroundColor: BrandColors.surface,
  },
  grainChipActive: { backgroundColor: BrandColors.primary, borderColor: BrandColors.primary },
  grainText: { fontSize: 13, fontWeight: '600', color: BrandColors.text },
  grainTextActive: { color: '#fff' },
  viewSwitch: {
    gap: 4,
    padding: 4,
    borderRadius: 14,
    backgroundColor: BrandColors.bgDeep,
  },
  viewButton: {
    minWidth: 92,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  viewButtonActive: { backgroundColor: BrandColors.primary },
  viewButtonText: { color: BrandColors.textMuted, fontSize: 12, fontWeight: '700' },
  viewButtonTextActive: { color: '#fff' },
  financeBlock: {
    gap: Spacing.three,
    marginTop: Spacing.two,
    paddingTop: Spacing.three,
    borderTopWidth: 1,
    borderTopColor: BrandColors.border,
  },
  financeTitle: { color: BrandColors.textMuted, fontSize: 13, fontWeight: '800' },
});
