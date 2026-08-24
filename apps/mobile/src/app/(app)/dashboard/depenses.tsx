import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { MoneyText } from '@/components/MoneyText';
import { KpiCard } from '@/components/monitor/KpiCard';
import { PeriodChips } from '@/components/monitor/PeriodChips';
import { RefreshableScroll } from '@/components/RefreshableScroll';
import { Screen } from '@/components/Screen';
import { BrandColors } from '@/constants/brand';
import { EXPENSE_LABEL_OPTIONS } from '@/constants/expenseLabels';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useCompanyScope } from '@/hooks/useCompanyScope';
import {
  createFinanceEntry,
  deleteFinanceLedgerRow,
  getDashboardSummaryRange,
  getFinanceLedger,
} from '@/services/api';
import type { DashboardBalanceSnapshot, FinanceLedgerRow } from '@/types/api';
import {
  businessTodayYmd,
  formatDateTime,
  periodDateRange,
  type PeriodKey,
} from '@/utils/datetime';

type LedgerNature = 'all' | 'purchase' | 'sale' | 'expense';

function expenseParts(row: FinanceLedgerRow): { label: string; detail: string | null } {
  if (row.detail?.trim()) return { label: row.description, detail: row.detail.trim() };
  if (row.kind !== 'EXPENSE') return { label: row.description, detail: null };
  const label = EXPENSE_LABEL_OPTIONS.find((option) =>
    row.description.startsWith(`${option} — `),
  );
  if (!label) return { label: row.description, detail: null };
  return { label, detail: row.description.slice(label.length + 3).trim() || null };
}

export default function DepensesScreen() {
  const { can, canPerm } = useAuth();
  const { companyId, ready } = useCompanyScope();
  const isAdmin = can(['ADMIN']);
  const canViewFinance = isAdmin || canPerm('finance.view') || canPerm('finance.write');
  const canWriteFinance =
    isAdmin || canPerm('finance.write') || canPerm('finance.expense');
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [snapshot, setSnapshot] = useState<DashboardBalanceSnapshot | null>(null);
  const [ledger, setLedger] = useState<FinanceLedgerRow[]>([]);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [nature, setNature] = useState<LedgerNature>(isAdmin ? 'all' : 'expense');
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [detail, setDetail] = useState('');
  const [entryDate, setEntryDate] = useState(businessTodayYmd);
  const [submitting, setSubmitting] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (companyId == null) return;
    const { dateFrom, dateTo } = periodDateRange(period);
    try {
      const [snap, led] = await Promise.all([
        getDashboardSummaryRange({ companyId, dateFrom, dateTo }),
        getFinanceLedger({ companyId, dateFrom, dateTo, nature, take: 40 }),
      ]);
      setSnapshot(snap);
      setLedger(led.items);
      setLedgerTotal(led.total);
    } catch {
      setSnapshot(null);
      setLedger([]);
      setLedgerTotal(0);
    }
  }, [companyId, nature, period]);

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

  async function submitExpense() {
    const n = Number(amount.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0 || !label || !detail.trim()) {
      setStatus('Libellé, détail et montant sont requis');
      return;
    }
    setSubmitting(true);
    setStatus(null);
    try {
      await createFinanceEntry({
        type: 'EXPENSE',
        amount: n,
        description: label,
        detail: detail.trim(),
        companyId: companyId ?? undefined,
        entryDate: entryDate.trim() || undefined,
      });
      setAmount('');
      setLabel('');
      setDetail('');
      setEntryDate(businessTodayYmd());
      setStatus('Dépense enregistrée');
      await load();
    } catch {
      setStatus('Échec enregistrement');
    } finally {
      setSubmitting(false);
    }
  }

  async function loadMore() {
    if (loadingMore || ledger.length >= ledgerTotal || companyId == null) return;
    setLoadingMore(true);
    const { dateFrom, dateTo } = periodDateRange(period);
    try {
      const next = await getFinanceLedger({
        companyId,
        dateFrom,
        dateTo,
        nature,
        skip: ledger.length,
        take: 40,
      });
      setLedger((current) => [...current, ...next.items]);
      setLedgerTotal(next.total);
    } finally {
      setLoadingMore(false);
    }
  }

  function confirmDelete(row: FinanceLedgerRow) {
    if (!isAdmin || companyId == null) return;
    const parts = expenseParts(row);
    Alert.alert(
      'Supprimer cette écriture ?',
      `${parts.label}${parts.detail ? ` — ${parts.detail}` : ''}`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () => {
            setDeletingId(row.id);
            void deleteFinanceLedgerRow({ ledgerRowId: row.id, companyId })
              .then(load)
              .catch(() => setStatus('Suppression impossible'))
              .finally(() => setDeletingId(null));
          },
        },
      ],
    );
  }

  return (
    <Screen keyboard>
      <RefreshableScroll refreshing={refreshing} onRefresh={onRefresh}>
        <PeriodChips value={period} onChange={setPeriod} />
        {canViewFinance && snapshot ? (
          <View style={styles.kpiGrid}>
            {isAdmin ? (
              <KpiCard label="Achats" value={snapshot.purchases} money />
            ) : null}
            <KpiCard label="Dépenses" value={snapshot.manualExpenses} money tone="warn" />
          </View>
        ) : null}

        {canWriteFinance ? (
          <View style={styles.formCard}>
            <Text style={styles.section}>Nouvelle dépense manuelle</Text>
            {!canViewFinance ? (
              <Text style={styles.fieldLabel}>
                Saisie seule — le journal financier n’est pas visible pour ce compte.
              </Text>
            ) : null}
            <Text style={styles.fieldLabel}>Libellé *</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}>
              {EXPENSE_LABEL_OPTIONS.map((option) => (
                <Pressable
                  key={option}
                  style={[styles.chip, label === option && styles.chipActive]}
                  onPress={() => setLabel(option)}>
                  <Text style={[styles.chipText, label === option && styles.chipTextActive]}>
                    {option}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <Text style={styles.fieldLabel}>Détail *</Text>
            <TextInput
              style={[styles.input, styles.detailInput]}
              placeholder="Ex. salaire de Marie, carburant camion, facture #…"
              placeholderTextColor={BrandColors.textMuted}
              multiline
              value={detail}
              onChangeText={setDetail}
            />
            <View style={styles.formRow}>
              <View style={styles.formColumn}>
                <Text style={styles.fieldLabel}>Montant (HTG) *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0.00"
                  placeholderTextColor={BrandColors.textMuted}
                  keyboardType="decimal-pad"
                  value={amount}
                  onChangeText={setAmount}
                />
              </View>
              <View style={styles.formColumn}>
                <Text style={styles.fieldLabel}>Date</Text>
                <TextInput
                  style={styles.input}
                  placeholder="AAAA-MM-JJ"
                  placeholderTextColor={BrandColors.textMuted}
                  value={entryDate}
                  onChangeText={setEntryDate}
                  autoCapitalize="none"
                />
              </View>
            </View>
            <Pressable
              style={[styles.btn, submitting && styles.btnDisabled]}
              disabled={submitting}
              onPress={() => void submitExpense()}>
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnText}>Enregistrer la dépense</Text>
              )}
            </Pressable>
            {status ? <Text style={styles.status}>{status}</Text> : null}
          </View>
        ) : null}

        <Text style={styles.section}>Journal</Text>
        {isAdmin ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}>
            {(
              [
                ['all', 'Tout'],
                ['expense', 'Dépenses'],
                ['purchase', 'Achats'],
                ['sale', 'Ventes'],
              ] as const
            ).map(([value, text]) => (
              <Pressable
                key={value}
                style={[styles.chip, nature === value && styles.chipActive]}
                onPress={() => setNature(value)}>
                <Text style={[styles.chipText, nature === value && styles.chipTextActive]}>
                  {text}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        {ledger.length === 0 ? (
          <Text style={styles.empty}>Aucune écriture</Text>
        ) : (
          ledger.map((row) => {
            const parts = expenseParts(row);
            return (
            <View key={row.id} style={styles.row}>
              <View style={styles.rowInfo}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {parts.label}
                </Text>
                {parts.detail ? (
                  <Text style={styles.rowDetail} numberOfLines={2}>
                    {parts.detail}
                  </Text>
                ) : null}
                <Text style={styles.rowMeta}>
                  {row.kind} · {row.user?.fullName || row.user?.phone || 'Système'} ·{' '}
                  {formatDateTime(row.occurredAt)}
                </Text>
              </View>
              <View style={styles.rowAside}>
                <MoneyText value={row.amount} style={styles.rowValue} />
                {isAdmin ? (
                  <Pressable
                    disabled={deletingId === row.id}
                    onPress={() => confirmDelete(row)}
                    hitSlop={8}>
                    <Text style={styles.deleteText}>
                      {deletingId === row.id ? '…' : 'Supprimer'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
            );
          })
        )}
        {ledger.length < ledgerTotal ? (
          <Pressable
            style={[styles.moreBtn, loadingMore && styles.btnDisabled]}
            disabled={loadingMore}
            onPress={() => void loadMore()}>
            {loadingMore ? (
              <ActivityIndicator color={BrandColors.primary} />
            ) : (
              <Text style={styles.moreText}>Afficher plus ({ledgerTotal - ledger.length})</Text>
            )}
          </Pressable>
        ) : null}
      </RefreshableScroll>
    </Screen>
  );
}

const styles = StyleSheet.create({
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  section: { marginTop: Spacing.two, fontSize: 15, fontWeight: '700', color: BrandColors.text },
  formCard: {
    gap: Spacing.two,
    padding: Spacing.three,
    backgroundColor: BrandColors.surface,
    borderWidth: 1,
    borderColor: BrandColors.border,
    borderRadius: 14,
  },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: BrandColors.textMuted },
  chips: { gap: Spacing.two, paddingVertical: 2 },
  chip: {
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: BrandColors.surface,
  },
  chipActive: { backgroundColor: BrandColors.primary, borderColor: BrandColors.primary },
  chipText: { fontSize: 12, fontWeight: '700', color: BrandColors.text },
  chipTextActive: { color: '#fff' },
  input: {
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    fontSize: 16,
    color: BrandColors.text,
    backgroundColor: BrandColors.surface,
  },
  detailInput: { minHeight: 76, textAlignVertical: 'top' },
  formRow: { flexDirection: 'row', gap: Spacing.two },
  formColumn: { flex: 1, gap: 6 },
  btn: {
    backgroundColor: BrandColors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontWeight: '700' },
  status: { color: BrandColors.primaryHover, fontWeight: '600' },
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
  rowDetail: { fontSize: 13, lineHeight: 18, color: BrandColors.text },
  rowMeta: { fontSize: 12, color: BrandColors.textMuted },
  rowAside: { alignItems: 'flex-end', gap: 8 },
  rowValue: { fontWeight: '700', color: BrandColors.text },
  deleteText: { fontSize: 11, fontWeight: '700', color: BrandColors.danger },
  moreBtn: {
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BrandColors.primary,
    borderRadius: 12,
    paddingVertical: 12,
  },
  moreText: { color: BrandColors.primary, fontWeight: '700' },
});
