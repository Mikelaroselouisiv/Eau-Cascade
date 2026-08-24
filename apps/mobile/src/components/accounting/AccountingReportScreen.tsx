import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Text, View } from 'react-native';

import { KpiCard } from '@/components/monitor/KpiCard';
import { RefreshableScroll } from '@/components/RefreshableScroll';
import { useAccountingScope } from '@/context/AccountingScopeContext';
import { getBalanceSheet, getIncomeStatement, getTrialBalance } from '@/services/api';
import { formatApiError } from '@/services/api-errors';
import type { AccountBalanceRow } from '@/types/api';
import { formatMoney } from '@/utils/datetime';

import { AccountingEmptyState } from './AccountingEmptyState';
import { AccountingPageShell } from './AccountingPageShell';
import { accountingStyles as styles } from './accountingStyles';

type ReportKind = 'balance' | 'bilan' | 'resultat';

function DenseBalanceRows({ rows, empty }: { rows: AccountBalanceRow[]; empty: string }) {
  if (rows.length === 0) return <AccountingEmptyState>{empty}</AccountingEmptyState>;
  return (
    <>
      <View style={styles.tableHead}>
        <Text style={[styles.tableHeadText, styles.colCode]}>N°</Text>
        <Text style={[styles.tableHeadText, { flex: 1 }]}>Libellé</Text>
        <Text style={[styles.tableHeadText, styles.colAmt]}>Solde</Text>
      </View>
      {rows.map((row, index) => (
        <View key={row.accountId} style={[styles.denseRow, index % 2 === 1 && styles.denseRowAlt]}>
          <Text style={styles.colCode}>{row.code}</Text>
          <Text style={styles.colName} numberOfLines={2}>
            {row.name}
          </Text>
          <Text style={styles.colAmt}>{formatMoney(row.balance)}</Text>
        </View>
      ))}
    </>
  );
}

export function AccountingReportScreen({
  kind,
  extraHeader,
}: {
  kind: ReportKind;
  extraHeader?: ReactNode;
}) {
  const { companyId, selectedYear, appliedDateFrom, appliedDateTo, canView, ready } =
    useAccountingScope();
  const [title, setTitle] = useState('');
  const [kpis, setKpis] = useState<Array<{ label: string; value: string | number; money?: boolean }>>(
    [],
  );
  const [sections, setSections] = useState<Array<{ title: string; rows: AccountBalanceRow[]; empty: string }>>(
    [],
  );
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!canView || companyId == null) return;
    if (!selectedYear?.id) {
      setTitle('');
      setKpis([]);
      setSections([]);
      setError(null);
      setLoaded(true);
      return;
    }
    try {
      setError(null);
      const fiscalYearId = selectedYear.id;
      if (kind === 'balance') {
        const report = await getTrialBalance({
          companyId,
          fiscalYearId,
          dateFrom: appliedDateFrom || undefined,
          dateTo: appliedDateTo || undefined,
        });
        setTitle(`Balance · ${report.fiscalYear.label}`);
        setKpis([
          { label: 'Total débit', value: report.totals.debit, money: true },
          { label: 'Total crédit', value: report.totals.credit, money: true },
        ]);
        setSections([
          { title: 'Comptes', rows: report.rows, empty: 'Aucun compte avec mouvement sur la période.' },
        ]);
        setLoaded(true);
        return;
      }
      if (kind === 'bilan') {
        const report = await getBalanceSheet({
          companyId,
          fiscalYearId,
          dateTo: appliedDateTo || undefined,
        });
        setTitle(`Bilan · ${report.fiscalYear.label}`);
        setKpis([
          { label: 'Actif', value: report.totalActif, money: true },
          { label: 'Passif', value: report.totalPassif, money: true },
          { label: 'Résultat', value: report.resultatEnCours, money: true },
        ]);
        setSections([
          { title: 'Actif', rows: report.actif, empty: 'Aucun compte d’actif avec solde.' },
          { title: 'Passif', rows: report.passif, empty: 'Aucun compte de passif avec solde.' },
        ]);
        setLoaded(true);
        return;
      }
      const report = await getIncomeStatement({
        companyId,
        fiscalYearId,
        dateFrom: appliedDateFrom || undefined,
        dateTo: appliedDateTo || undefined,
      });
      setTitle(`Résultat · ${report.fiscalYear.label}`);
      setKpis([
        { label: 'Charges', value: report.totalCharges, money: true },
        { label: 'Produits', value: report.totalProduits, money: true },
        { label: report.resultatLabel || 'Résultat', value: report.resultat, money: true },
      ]);
      setSections([
        { title: 'Charges', rows: report.charges, empty: 'Aucune charge sur la période.' },
        { title: 'Produits', rows: report.produits, empty: 'Aucun produit sur la période.' },
      ]);
      setLoaded(true);
    } catch (err) {
      setTitle('');
      setKpis([]);
      setSections([]);
      setLoaded(true);
      setError(formatApiError(err, 'Impossible de charger le rapport'));
    }
  }, [canView, companyId, kind, selectedYear?.id, appliedDateFrom, appliedDateTo]);

  useFocusEffect(
    useCallback(() => {
      if (!ready) return;
      void load();
    }, [load, ready]),
  );

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
        {title ? <Text style={styles.section}>{title}</Text> : null}
        {kpis.length ? (
          <View style={styles.kpiGrid}>
            {kpis.map((kpi) => (
              <KpiCard key={kpi.label} label={kpi.label} value={kpi.value} money={kpi.money} />
            ))}
          </View>
        ) : null}
        {sections.map((section) => (
          <View key={section.title}>
            <Text style={styles.section}>{section.title}</Text>
            <DenseBalanceRows rows={section.rows} empty={section.empty} />
          </View>
        ))}
        {!error && !loaded ? <Text style={styles.empty}>Chargement…</Text> : null}
      </RefreshableScroll>
    </AccountingPageShell>
  );
}
