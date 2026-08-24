import type { ReactNode } from 'react';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from 'react-native';

import { RefreshableScroll } from '@/components/RefreshableScroll';
import { BrandColors } from '@/constants/brand';
import { useAccountingScope } from '@/context/AccountingScopeContext';
import { closeFiscalYear, createFiscalYear, ensureAccountingChart } from '@/services/api';
import { formatApiError } from '@/services/api-errors';
import { businessTodayYmd, formatMoney, ymdFromIso } from '@/utils/datetime';

import { AccountingEmptyState } from './AccountingEmptyState';
import { AccountingPageShell } from './AccountingPageShell';
import { accountingStyles as styles } from './accountingStyles';

function defaultYearBounds() {
  const y = businessTodayYmd().slice(0, 4);
  return { label: y, start: `${y}-01-01`, end: `${y}-12-31` };
}

export function AccountingFiscalYearsScreen({ extraHeader }: { extraHeader?: ReactNode }) {
  const { years, openYear, canManage, companyId, refreshOverview, loadingOverview } =
    useAccountingScope();
  const defaults = defaultYearBounds();
  const [label, setLabel] = useState(defaults.label);
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function onOpenYear() {
    if (companyId == null) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await ensureAccountingChart(companyId);
      await createFiscalYear({
        companyId,
        label: label.trim(),
        startDate,
        endDate,
      });
      setStatus(`Exercice « ${label.trim()} » ouvert`);
      await refreshOverview();
    } catch (err) {
      setError(formatApiError(err, 'Impossible d’ouvrir l’exercice'));
    } finally {
      setBusy(false);
    }
  }

  function onCloseYear() {
    if (!openYear) return;
    Alert.alert(
      'Clôturer l’exercice',
      `Clôturer « ${openYear.label} » ? Les comptes de charges et produits seront soldés vers le résultat. Cette action est définitive.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Clôturer',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              setError(null);
              try {
                const res = await closeFiscalYear(openYear.id);
                setStatus(
                  `Exercice clôturé. Résultat : ${formatMoney(res.resultat)} (${res.resultat >= 0 ? 'bénéfice' : 'perte'})`,
                );
                await refreshOverview();
              } catch (err) {
                setError(formatApiError(err, 'Clôture impossible'));
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
    <AccountingPageShell extraHeader={extraHeader} keyboard={canManage}>
      <RefreshableScroll
        refreshing={refreshing || loadingOverview}
        onRefresh={async () => {
          setRefreshing(true);
          await refreshOverview();
          setRefreshing(false);
        }}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {status ? <Text style={styles.ok}>{status}</Text> : null}

        <Text style={styles.section}>Exercice en cours</Text>
        {openYear ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{openYear.label}</Text>
            <Text style={styles.meta}>
              {ymdFromIso(openYear.startDate)} → {ymdFromIso(openYear.endDate)}
              {openYear._count?.entries != null ? ` · ${openYear._count.entries} écriture(s)` : ''}
            </Text>
            {canManage ? (
              <Pressable
                style={[styles.dangerBtn, busy && styles.disabled]}
                disabled={busy}
                onPress={onCloseYear}>
                <Text style={styles.primaryBtnText}>Clôturer</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <AccountingEmptyState>Aucun exercice ouvert.</AccountingEmptyState>
        )}

        <Text style={styles.section}>Nouvel exercice</Text>
        {!canManage ? (
          <AccountingEmptyState>Ouverture réservée aux comptes accounting.manage.</AccountingEmptyState>
        ) : openYear ? (
          <AccountingEmptyState>
            Clôturez « {openYear.label} » avant d’en ouvrir un autre.
          </AccountingEmptyState>
        ) : (
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Libellé</Text>
            <TextInput
              style={styles.input}
              value={label}
              onChangeText={setLabel}
              placeholderTextColor={BrandColors.textMuted}
            />
            <Text style={styles.fieldLabel}>Début</Text>
            <TextInput
              style={styles.input}
              value={startDate}
              onChangeText={setStartDate}
              placeholder="AAAA-MM-JJ"
              placeholderTextColor={BrandColors.textMuted}
            />
            <Text style={styles.fieldLabel}>Fin</Text>
            <TextInput
              style={styles.input}
              value={endDate}
              onChangeText={setEndDate}
              placeholder="AAAA-MM-JJ"
              placeholderTextColor={BrandColors.textMuted}
            />
            <Pressable
              style={[styles.primaryBtn, busy && styles.disabled]}
              disabled={busy}
              onPress={() => void onOpenYear()}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Ouvrir</Text>}
            </Pressable>
          </View>
        )}

        <Text style={styles.section}>Historique</Text>
        {years.length === 0 ? (
          <AccountingEmptyState>Aucun exercice.</AccountingEmptyState>
        ) : (
          years.map((year) => (
            <View key={year.id} style={styles.denseRow}>
              <Text style={[styles.colName, { fontWeight: '700' }]}>{year.label}</Text>
              <Text style={styles.colMuted}>
                {ymdFromIso(year.startDate)} → {ymdFromIso(year.endDate)}
              </Text>
              <Text style={styles.meta}>{year.status === 'OPEN' ? 'Ouvert' : 'Clôturé'}</Text>
            </View>
          ))
        )}
      </RefreshableScroll>
    </AccountingPageShell>
  );
}
