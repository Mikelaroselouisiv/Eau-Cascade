import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { RefreshableScroll } from '@/components/RefreshableScroll';
import { BrandColors } from '@/constants/brand';
import { useAccountingScope } from '@/context/AccountingScopeContext';
import { ensureAccountingChart, getAccountingAccounts } from '@/services/api';
import { formatApiError } from '@/services/api-errors';
import type { AccountRow } from '@/types/api';

import { AccountingEmptyState } from './AccountingEmptyState';
import { COA_CLASS_LABELS } from './accountingFormat';
import { AccountingPageShell } from './AccountingPageShell';
import { accountingStyles as styles } from './accountingStyles';

/** Aligné desktop : édition libre du plan désactivée. */
const ALLOW_CHART_OF_ACCOUNTS_EDIT = false;

export function AccountingChartScreen({ extraHeader }: { extraHeader?: ReactNode }) {
  const { companyId, canView, canManage, ready } = useAccountingScope();
  const canEditChart = canManage && ALLOW_CHART_OF_ACCOUNTS_EDIT;
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [classFilter, setClassFilter] = useState<number | 'all'>('all');
  const [showInactive, setShowInactive] = useState(false);

  const load = useCallback(async () => {
    if (!canView || companyId == null) return;
    try {
      setError(null);
      setAccounts(await getAccountingAccounts(companyId));
    } catch (err) {
      setAccounts([]);
      setError(formatApiError(err, 'Impossible de charger le plan comptable'));
    }
  }, [canView, companyId]);

  useFocusEffect(
    useCallback(() => {
      if (!ready) return;
      void load();
    }, [load, ready]),
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts.filter((a) => {
      if (!showInactive && !a.isActive) return false;
      if (classFilter !== 'all' && a.classNumber !== classFilter) return false;
      if (!q) return true;
      return (
        a.code.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        (a.systemKey ?? '').toLowerCase().includes(q)
      );
    });
  }, [accounts, query, classFilter, showInactive]);

  async function onEnsure() {
    if (companyId == null) return;
    setBusy(true);
    setMessage(null);
    try {
      const list = await ensureAccountingChart(companyId);
      setAccounts(list);
      setMessage(`${list.length} comptes synchronisés`);
    } catch (err) {
      setError(formatApiError(err, 'Erreur plan comptable'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AccountingPageShell extraHeader={extraHeader}>
      <RefreshableScroll
        refreshing={refreshing}
        onRefresh={async () => {
          setRefreshing(true);
          await load();
          setRefreshing(false);
        }}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {message ? <Text style={styles.ok}>{message}</Text> : null}
        <Text style={styles.section}>Plan comptable</Text>
        <Text style={styles.meta}>
          {accounts.filter((a) => a.isActive).length} actifs · {filtered.length} affiché(s)
        </Text>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Code ou intitulé…"
          placeholderTextColor={BrandColors.textMuted}
          autoCapitalize="none"
        />
        <View style={styles.chipRow}>
          <Pressable
            onPress={() => setClassFilter('all')}
            style={[styles.chip, classFilter === 'all' && styles.chipActive]}>
            <Text style={[styles.chipText, classFilter === 'all' && styles.chipTextActive]}>Toutes</Text>
          </Pressable>
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <Pressable
              key={n}
              onPress={() => setClassFilter(n)}
              style={[styles.chip, classFilter === n && styles.chipActive]}>
              <Text style={[styles.chipText, classFilter === n && styles.chipTextActive]}>Cl. {n}</Text>
            </Pressable>
          ))}
        </View>
        {classFilter !== 'all' ? (
          <Text style={styles.meta}>
            Classe {classFilter} · {COA_CLASS_LABELS[classFilter]}
          </Text>
        ) : null}
        <Pressable onPress={() => setShowInactive((v) => !v)}>
          <Text style={styles.meta}>{showInactive ? 'Masquer les inactifs' : 'Afficher les inactifs'}</Text>
        </Pressable>
        {canManage ? (
          <Pressable
            style={[styles.secondaryBtn, busy && styles.disabled]}
            disabled={busy}
            onPress={() => void onEnsure()}>
            {busy ? (
              <ActivityIndicator color={BrandColors.primary} />
            ) : (
              <Text style={styles.secondaryBtnText}>Synchroniser le plan</Text>
            )}
          </Pressable>
        ) : null}
        {!canEditChart ? (
          <Text style={styles.meta}>Édition du plan désactivée (comptes gérés côté serveur).</Text>
        ) : null}

        <View style={styles.tableHead}>
          <Text style={[styles.tableHeadText, styles.colCode]}>N°</Text>
          <Text style={[styles.tableHeadText, { flex: 1 }]}>Intitulé</Text>
          <Text style={[styles.tableHeadText, { width: 28, textAlign: 'right' }]}>Cl.</Text>
        </View>
        {filtered.length === 0 ? (
          <AccountingEmptyState>Aucun compte pour ce filtre.</AccountingEmptyState>
        ) : (
          filtered.map((account, index) => (
            <View key={account.id} style={[styles.denseRow, index % 2 === 1 && styles.denseRowAlt]}>
              <Text style={styles.colCode}>{account.code}</Text>
              <Text style={styles.colName} numberOfLines={2}>
                {account.name}
                {account.isActive ? '' : ' · inactif'}
              </Text>
              <Text style={[styles.meta, { width: 28, textAlign: 'right' }]}>{account.classNumber}</Text>
            </View>
          ))
        )}
      </RefreshableScroll>
    </AccountingPageShell>
  );
}
