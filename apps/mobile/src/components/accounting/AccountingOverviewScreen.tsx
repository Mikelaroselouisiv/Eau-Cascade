import type { ReactNode } from 'react';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { KpiCard } from '@/components/monitor/KpiCard';
import { RefreshableScroll } from '@/components/RefreshableScroll';
import { useAccountingScope } from '@/context/AccountingScopeContext';
import { formatDateTime, ymdFromIso } from '@/utils/datetime';

import { AccountingEmptyState } from './AccountingEmptyState';
import { AccountingPageShell } from './AccountingPageShell';
import { accountingStyles as styles } from './accountingStyles';

export function AccountingOverviewScreen({ extraHeader }: { extraHeader?: ReactNode }) {
  const {
    years,
    openYear,
    accountCount,
    entryCount,
    loadingOverview,
    refreshOverview,
    overviewError,
  } = useAccountingScope();
  const [refreshing, setRefreshing] = useState(false);

  return (
    <AccountingPageShell extraHeader={extraHeader}>
      <RefreshableScroll
        refreshing={refreshing || loadingOverview}
        onRefresh={async () => {
          setRefreshing(true);
          await refreshOverview();
          setRefreshing(false);
        }}>
        <View style={styles.kpiGrid}>
          <KpiCard label="Comptes" value={String(accountCount)} />
          <KpiCard label="Écritures" value={String(entryCount)} />
          <KpiCard label="Exercice ouvert" value={openYear?.label ?? 'Aucun'} />
        </View>
        <Text style={styles.section}>Exercices</Text>
        {years.length === 0 && !loadingOverview && !overviewError ? (
          <AccountingEmptyState>
            Aucun exercice. Ouvrez-en un dans Plus → Exercices.
          </AccountingEmptyState>
        ) : null}
        {years.map((year) => (
          <View key={year.id} style={styles.card}>
            <Text style={styles.cardTitle}>
              {year.label} · {year.status === 'OPEN' ? 'Ouvert' : 'Clôturé'}
            </Text>
            <Text style={styles.meta}>
              {ymdFromIso(year.startDate)} → {ymdFromIso(year.endDate)}
              {year._count?.entries != null ? ` · ${year._count.entries} écriture(s)` : ''}
            </Text>
            {year.closedAt ? (
              <Text style={styles.meta}>Clôturé {formatDateTime(year.closedAt)}</Text>
            ) : null}
          </View>
        ))}
      </RefreshableScroll>
    </AccountingPageShell>
  );
}
