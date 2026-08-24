import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState, type ComponentProps } from 'react';
import { useFocusEffect } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ChipScroll } from '@/components/ChipScroll';

import { AuditJournalPanel } from '@/components/monitor/AuditJournalPanel';
import { KpiCard } from '@/components/monitor/KpiCard';
import { PeriodChips } from '@/components/monitor/PeriodChips';
import { RegisterSessionsPanel } from '@/components/monitor/RegisterSessionsPanel';
import { TopProductsDonut } from '@/components/monitor/TopProductsDonut';
import { RefreshableScroll } from '@/components/RefreshableScroll';
import { Screen } from '@/components/Screen';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useCompanyScope } from '@/hooks/useCompanyScope';
import { getDashboardSalesByProduct, getDashboardSummaryRange } from '@/services/api';
import type { DashboardBalanceSnapshot, DashboardSalesByProductRow } from '@/types/api';
import { periodDateRange, type PeriodKey } from '@/utils/datetime';

export default function SyntheseScreen() {
  const { can, canPerm } = useAuth();
  const canSeeSynthesis =
    can(['ADMIN']) || canPerm('dashboard.synthesis') || canPerm('reports.view');
  const { companyId, companies, setCompanyId, ready, lockedToSession } = useCompanyScope();
  const [period, setPeriod] = useState<PeriodKey>('week');
  const [snapshot, setSnapshot] = useState<DashboardBalanceSnapshot | null>(null);
  const [topProducts, setTopProducts] = useState<DashboardSalesByProductRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'overview' | 'sessions' | 'audit'>('overview');

  const load = useCallback(async () => {
    if (!canSeeSynthesis || companyId == null) return;
    const { dateFrom, dateTo } = periodDateRange(period);
    try {
      setError(null);
      const [snap, products] = await Promise.all([
        getDashboardSummaryRange({ companyId, dateFrom, dateTo }),
        getDashboardSalesByProduct({ companyId, dateFrom, dateTo }),
      ]);
      setSnapshot(snap);
      setTopProducts(
        [...products]
          .sort((a, b) => Number(b.quantity) - Number(a.quantity))
          .slice(0, 8),
      );
    } catch {
      setError('Impossible de charger la synthèse');
      setSnapshot(null);
      setTopProducts([]);
    }
  }, [canSeeSynthesis, companyId, period]);

  useFocusEffect(
    useCallback(() => {
      if (!ready) return;
      void load();
    }, [load, ready]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshKey((key) => key + 1);
    setRefreshing(false);
  }

  if (!canSeeSynthesis) {
    return (
      <Screen>
        <View style={styles.blocked}>
          <Text style={styles.blockedText}>
            Synthèse réservée aux comptes avec dashboard.synthesis ou reports.view.
          </Text>
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

        <PeriodChips value={period} onChange={setPeriod} />
        <View style={styles.viewSwitch}>
          <ViewSwitchButton
            icon="pie-chart-outline"
            label="Aperçu"
            active={view === 'overview'}
            onPress={() => setView('overview')}
          />
          <ViewSwitchButton
            icon="storefront-outline"
            label="Sessions"
            active={view === 'sessions'}
            onPress={() => setView('sessions')}
          />
          <ViewSwitchButton
            icon="shield-checkmark-outline"
            label="Audit"
            active={view === 'audit'}
            onPress={() => setView('audit')}
          />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {ready && companyId == null ? (
          <Text style={styles.error}>Aucune entreprise disponible pour le monitoring.</Text>
        ) : null}

        {view === 'overview' ? (
          <>
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

            <Text style={styles.section}>Top articles · unités vendues</Text>
            <TopProductsDonut rows={topProducts} />
          </>
        ) : null}

        {companyId != null && view === 'sessions' ? (
          <RegisterSessionsPanel
            companyId={companyId}
            {...periodDateRange(period)}
            refreshKey={refreshKey}
          />
        ) : null}

        {companyId != null && view === 'audit' ? (
          <AuditJournalPanel
            companyId={companyId}
            {...periodDateRange(period)}
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
  section: { marginTop: Spacing.two, fontSize: 15, fontWeight: '700', color: BrandColors.text },
  empty: { color: BrandColors.textMuted },
  viewSwitch: {
    flexDirection: 'row',
    backgroundColor: BrandColors.bgDeep,
    borderRadius: 14,
    padding: 4,
    gap: 4,
  },
  viewButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: 10,
    paddingVertical: 9,
  },
  viewButtonActive: { backgroundColor: BrandColors.primary },
  viewButtonText: { color: BrandColors.textMuted, fontSize: 12, fontWeight: '700' },
  viewButtonTextActive: { color: '#fff' },
});
