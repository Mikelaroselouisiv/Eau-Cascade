import type { ReactNode } from 'react';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';

import { KpiCard } from '@/components/monitor/KpiCard';
import { RefreshableScroll } from '@/components/RefreshableScroll';
import { useAccountingScope } from '@/context/AccountingScopeContext';
import { backfillAccounting } from '@/services/api';
import { formatApiError } from '@/services/api-errors';
import type { AccountingBackfillResult } from '@/types/api';
import { ymdFromIso } from '@/utils/datetime';

import { AccountingEmptyState } from './AccountingEmptyState';
import { AccountingPageShell } from './AccountingPageShell';
import { accountingStyles as styles } from './accountingStyles';

export function AccountingBackfillScreen({ extraHeader }: { extraHeader?: ReactNode }) {
  const { companyId, canManage, openYear, refreshOverview } = useAccountingScope();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AccountingBackfillResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  function onBackfill() {
    if (companyId == null) return;
    Alert.alert(
      'Reprise historique',
      'Reprendre toutes les opérations de l’exercice ouvert (ventes, crédits, dépenses, achats, banques) en écritures comptables ? Les écritures déjà présentes seront ignorées.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Lancer',
          onPress: () => {
            void (async () => {
              setBusy(true);
              setError(null);
              try {
                setResult(await backfillAccounting(companyId));
                await refreshOverview();
              } catch (err) {
                setError(formatApiError(err, 'Reprise impossible'));
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
  }

  return (
    <AccountingPageShell extraHeader={extraHeader}>
      <RefreshableScroll
        refreshing={refreshing}
        onRefresh={async () => {
          setRefreshing(true);
          await refreshOverview();
          setRefreshing(false);
        }}>
        <Text style={styles.section}>Reprise historique</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!openYear ? (
          <AccountingEmptyState>Ouvrez un exercice pour lancer la reprise.</AccountingEmptyState>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{openYear.label}</Text>
            <Text style={styles.meta}>
              {ymdFromIso(openYear.startDate)} → {ymdFromIso(openYear.endDate)}
            </Text>
            {canManage ? (
              <Pressable
                style={[styles.primaryBtn, busy && styles.disabled]}
                disabled={busy}
                onPress={onBackfill}>
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryBtnText}>Lancer la reprise</Text>
                )}
              </Pressable>
            ) : (
              <AccountingEmptyState>
                Reprise réservée aux comptes accounting.manage.
              </AccountingEmptyState>
            )}
          </View>
        )}
        {result ? (
          <>
            <Text style={styles.section}>Résultat · {result.fiscalYear.label}</Text>
            <View style={styles.kpiGrid}>
              <KpiCard label="Ventes" value={String(result.posted.sales)} />
              <KpiCard label="Crédit" value={String(result.posted.creditSales)} />
              <KpiCard label="Encaissements" value={String(result.posted.creditPayments)} />
              <KpiCard label="Dépenses" value={String(result.posted.expenses)} />
              <KpiCard label="Achats" value={String(result.posted.purchases)} />
              <KpiCard label="Banques" value={String(result.posted.bankManual)} />
              <KpiCard label="Fournisseurs" value={String(result.posted.supplierPayments)} />
              <KpiCard label="Immos" value={String(result.posted.fixedAssets)} />
              <KpiCard
                label="Ignorées"
                value={String(
                  result.skipped.alreadyPosted +
                    result.skipped.outsidePeriod +
                    result.skipped.other,
                )}
              />
            </View>
          </>
        ) : null}
      </RefreshableScroll>
    </AccountingPageShell>
  );
}
