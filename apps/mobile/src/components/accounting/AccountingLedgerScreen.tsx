import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { ModalShell } from '@/components/ModalShell';
import { RefreshableScroll } from '@/components/RefreshableScroll';
import { Spacing } from '@/constants/theme';
import { useAccountingScope } from '@/context/AccountingScopeContext';
import { getGeneralLedger, getTrialBalance } from '@/services/api';
import { formatApiError } from '@/services/api-errors';
import type { AccountBalanceRow, GeneralLedgerReport } from '@/types/api';
import { formatMoney, ymdFromIso } from '@/utils/datetime';

import { AccountingEmptyState } from './AccountingEmptyState';
import { formatMoneyIfPositive, journalRef } from './accountingFormat';
import { AccountingPageShell } from './AccountingPageShell';
import { accountingStyles as styles } from './accountingStyles';

export function AccountingLedgerScreen({ extraHeader }: { extraHeader?: ReactNode }) {
  const { companyId, selectedYear, appliedDateFrom, appliedDateTo, canView, ready } =
    useAccountingScope();
  const [rows, setRows] = useState<AccountBalanceRow[]>([]);
  const [label, setLabel] = useState('');
  const [balanced, setBalanced] = useState<boolean | null>(null);
  const [debitTotal, setDebitTotal] = useState(0);
  const [creditTotal, setCreditTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [detail, setDetail] = useState<GeneralLedgerReport | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canView || companyId == null) return;
    if (!selectedYear?.id) {
      setRows([]);
      setLabel('');
      setLoaded(true);
      setError(null);
      return;
    }
    try {
      setError(null);
      const trial = await getTrialBalance({
        companyId,
        fiscalYearId: selectedYear.id,
          dateFrom: appliedDateFrom || undefined,
          dateTo: appliedDateTo || undefined,
      });
      setRows(trial.rows);
      setLabel(`${trial.fiscalYear.label} · ${trial.dateFrom} → ${trial.dateTo}`);
      setBalanced(trial.balanced ?? null);
      setDebitTotal(trial.balanceTotals?.debit ?? trial.totals.debit);
      setCreditTotal(trial.balanceTotals?.credit ?? trial.totals.credit);
      setLoaded(true);
    } catch (err) {
      setRows([]);
      setLoaded(true);
      setError(formatApiError(err, 'Impossible de charger le grand livre'));
    }
  }, [canView, companyId, selectedYear?.id, appliedDateFrom, appliedDateTo]);

  useFocusEffect(
    useCallback(() => {
      if (!ready) return;
      void load();
    }, [load, ready]),
  );

  const debitRows = useMemo(() => rows.filter((r) => r.balanceSide === 'debit'), [rows]);
  const creditRows = useMemo(() => rows.filter((r) => r.balanceSide === 'credit'), [rows]);

  async function openAccount(accountId: number) {
    if (companyId == null) return;
    setDetailBusy(true);
    setDetail(null);
    setDetailError(null);
    try {
      setDetail(
        await getGeneralLedger({
          companyId,
          accountId,
          fiscalYearId: selectedYear?.id,
          dateFrom: appliedDateFrom || undefined,
          dateTo: appliedDateTo || undefined,
        }),
      );
    } catch (err) {
      setDetailError(formatApiError(err, 'Impossible de charger le compte'));
    } finally {
      setDetailBusy(false);
    }
  }

  function AccountBlock({
    title,
    list,
    empty,
  }: {
    title: string;
    list: AccountBalanceRow[];
    empty: string;
  }) {
    return (
      <View>
        <Text style={styles.section}>{title}</Text>
        {list.length === 0 ? (
          <AccountingEmptyState>{empty}</AccountingEmptyState>
        ) : (
          list.map((row, index) => (
            <Pressable
              key={row.accountId}
              onPress={() => void openAccount(row.accountId)}
              style={[styles.denseRow, index % 2 === 1 && styles.denseRowAlt]}>
              <Text style={styles.colCode}>{row.code}</Text>
              <Text style={styles.colName} numberOfLines={2}>
                {row.name}
              </Text>
              <Text style={styles.colAmt}>{formatMoney(row.balance)}</Text>
            </Pressable>
          ))
        )}
      </View>
    );
  }

  return (
    <AccountingPageShell extraHeader={extraHeader} showDates>
      <RefreshableScroll
        refreshing={refreshing}
        onRefresh={async () => {
          setRefreshing(true);
          await load();
          setRefreshing(false);
        }}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!selectedYear && loaded ? (
          <AccountingEmptyState>Aucun exercice sélectionné.</AccountingEmptyState>
        ) : null}
        {label ? <Text style={styles.meta}>{label}</Text> : null}
        {balanced != null ? (
          <Text style={balanced ? styles.ok : styles.totalsWarn}>
            {balanced ? 'Équilibré' : 'À contrôler'}
          </Text>
        ) : null}
        <AccountBlock
          title="Soldes débiteurs"
          list={debitRows}
          empty="Aucun solde débiteur sur la période."
        />
        <AccountBlock
          title="Soldes créditeurs"
          list={creditRows}
          empty="Aucun solde créditeur sur la période."
        />
        {rows.length > 0 ? (
          <View style={styles.totalsBar}>
            <Text style={styles.meta}>D {formatMoney(debitTotal)}</Text>
            <Text style={styles.meta}>C {formatMoney(creditTotal)}</Text>
            <Text style={styles.meta}>Écart {formatMoney(Math.abs(debitTotal - creditTotal))}</Text>
          </View>
        ) : null}
        {!error && !loaded ? <Text style={styles.empty}>Chargement…</Text> : null}
      </RefreshableScroll>

      <ModalShell
        visible={detail != null || detailBusy || detailError != null}
        onRequestClose={() => {
          setDetail(null);
          setDetailError(null);
        }}
        body={
          detailBusy ? (
            <AccountingEmptyState>Chargement du compte…</AccountingEmptyState>
          ) : detailError ? (
            <Text style={[styles.error, { padding: Spacing.three }]}>{detailError}</Text>
          ) : detail ? (
            <RefreshableScroll refreshing={false} onRefresh={() => undefined}>
              {detail.movements.length === 0 ? (
                <AccountingEmptyState>Aucune écriture sur ce compte.</AccountingEmptyState>
              ) : (
                detail.movements.map((m) => (
                  <View key={`${m.entryId}-${m.entryDate}-${m.debit}-${m.credit}`} style={styles.denseRow}>
                    <Text style={styles.colDate}>{ymdFromIso(m.entryDate)}</Text>
                    <Text style={styles.colMuted} numberOfLines={2}>
                      {journalRef(m.journalCode, m.entryNumber)} · {m.label || m.description}
                    </Text>
                    <Text style={styles.colAmt}>{formatMoneyIfPositive(m.debit)}</Text>
                    <Text style={styles.colAmt}>{formatMoneyIfPositive(m.credit)}</Text>
                  </View>
                ))
              )}
              <Text style={[styles.cardTitle, { padding: Spacing.three }]}>
                Solde {formatMoney(detail.closingBalance)}
              </Text>
            </RefreshableScroll>
          ) : null
        }>
        <View style={{ paddingHorizontal: Spacing.three, paddingBottom: Spacing.two, gap: 8 }}>
          <View style={styles.row}>
            <Text style={styles.cardTitle} numberOfLines={2}>
              {detail ? `${detail.account.code} · ${detail.account.name}` : 'Compte'}
            </Text>
            <Pressable
              onPress={() => {
                setDetail(null);
                setDetailError(null);
              }}>
              <Text style={styles.meta}>Fermer</Text>
            </Pressable>
          </View>
        </View>
      </ModalShell>
    </AccountingPageShell>
  );
}
