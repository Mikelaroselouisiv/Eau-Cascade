import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { MoneyText } from '@/components/MoneyText';
import { KpiCard } from '@/components/monitor/KpiCard';
import { RefreshableScroll } from '@/components/RefreshableScroll';
import { Screen } from '@/components/Screen';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useCompanyScope } from '@/hooks/useCompanyScope';
import {
  createBankTransaction,
  getBankSummary,
  listBankTransactions,
  listBanks,
} from '@/services/api';
import type { BankAccountRow, BankSummary, BankTransactionRow } from '@/types/api';
import { formatDateTime } from '@/utils/datetime';

export default function BanqueScreen() {
  const { can, canPerm } = useAuth();
  const { companyId, ready } = useCompanyScope();
  const canManage = can(['ADMIN', 'MANAGER']) || canPerm('banks.manage');
  const [summary, setSummary] = useState<BankSummary | null>(null);
  const [accounts, setAccounts] = useState<BankAccountRow[]>([]);
  const [txs, setTxs] = useState<BankTransactionRow[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [type, setType] = useState<'DEPOSIT' | 'WITHDRAWAL'>('DEPOSIT');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (companyId == null) return;
    try {
      const [sum, banks, txRes] = await Promise.all([
        getBankSummary(companyId),
        listBanks({ companyId }),
        listBankTransactions({ companyId, take: 25 }),
      ]);
      setSummary(sum);
      const flat = banks.flatMap((b) =>
        b.accounts.map((a) => ({ ...a, bankName: b.name })),
      );
      setAccounts(flat);
      setSelectedAccountId((prev) => prev ?? flat[0]?.id ?? null);
      setTxs(txRes.items);
    } catch {
      setSummary(null);
      setAccounts([]);
      setTxs([]);
    }
  }, [companyId]);

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

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId],
  );

  async function submitTx() {
    if (!canManage || selectedAccountId == null) return;
    const n = Number(amount.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0 || !description.trim()) {
      setStatus('Montant et description requis');
      return;
    }
    setSubmitting(true);
    setStatus(null);
    try {
      await createBankTransaction({
        bankAccountId: selectedAccountId,
        type,
        amount: n,
        description: description.trim(),
      });
      setAmount('');
      setDescription('');
      setStatus(type === 'DEPOSIT' ? 'Dépôt enregistré' : 'Retrait enregistré');
      await load();
    } catch {
      setStatus('Échec opération bancaire');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen keyboard>
      <RefreshableScroll refreshing={refreshing} onRefresh={onRefresh}>
        {summary ? (
          <View style={styles.kpiGrid}>
            <KpiCard label="Capital" value={summary.totalCapital} money />
            <KpiCard
              label="Comptes"
              value={String(summary.accountsCount)}
              hint={`${summary.banksCount} banque(s)`}
            />
          </View>
        ) : null}

        <Text style={styles.section}>Soldes</Text>
        {accounts.length === 0 ? (
          <Text style={styles.empty}>Aucun compte</Text>
        ) : (
          accounts.map((a) => (
            <Pressable
              key={a.id}
              onPress={() => setSelectedAccountId(a.id)}
              style={[styles.row, selectedAccountId === a.id && styles.rowActive]}>
              <View style={styles.rowInfo}>
                <Text style={styles.rowTitle}>
                  {a.bankName ? `${a.bankName} · ` : ''}
                  {a.name}
                </Text>
                <Text style={styles.rowMeta}>{a.accountNumber ?? 'Sans n°'}</Text>
              </View>
              <MoneyText value={a.balance} style={styles.rowValue} />
            </Pressable>
          ))
        )}

        {canManage && selectedAccount ? (
          <>
            <Text style={styles.section}>Mouvement — {selectedAccount.name}</Text>
            <View style={styles.typeRow}>
              {(['DEPOSIT', 'WITHDRAWAL'] as const).map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setType(t)}
                  style={[styles.typeChip, type === t && styles.typeChipActive]}>
                  <Text style={[styles.typeChipText, type === t && styles.typeChipTextActive]}>
                    {t === 'DEPOSIT' ? 'Dépôt' : 'Retrait'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={styles.input}
              placeholder="Montant"
              placeholderTextColor={BrandColors.textMuted}
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
            />
            <TextInput
              style={styles.input}
              placeholder="Description"
              placeholderTextColor={BrandColors.textMuted}
              value={description}
              onChangeText={setDescription}
            />
            <Pressable
              style={[styles.btn, submitting && styles.btnDisabled]}
              disabled={submitting}
              onPress={() => void submitTx()}>
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnText}>Valider</Text>
              )}
            </Pressable>
            {status ? <Text style={styles.status}>{status}</Text> : null}
          </>
        ) : null}

        <Text style={styles.section}>Historique</Text>
        {txs.length === 0 ? (
          <Text style={styles.empty}>Aucune transaction</Text>
        ) : (
          txs.map((tx) => (
            <View key={tx.id} style={styles.row}>
              <View style={styles.rowInfo}>
                <Text style={styles.rowTitle} numberOfLines={2}>
                  {tx.description}
                </Text>
                <Text style={styles.rowMeta}>
                  {tx.type === 'DEPOSIT' ? 'Dépôt' : 'Retrait'} · {tx.bankAccount.bank.name} ·{' '}
                  {formatDateTime(tx.occurredAt)}
                </Text>
              </View>
              <MoneyText
                value={tx.amount}
                style={[
                  styles.rowValue,
                  { color: tx.type === 'DEPOSIT' ? BrandColors.ok : BrandColors.danger },
                ]}
              />
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
  rowActive: { borderColor: BrandColors.primary, backgroundColor: BrandColors.primarySoft },
  rowInfo: { flex: 1, gap: 2 },
  rowTitle: { fontWeight: '600', color: BrandColors.text },
  rowMeta: { fontSize: 12, color: BrandColors.textMuted },
  rowValue: { fontWeight: '700', color: BrandColors.text },
  typeRow: { flexDirection: 'row', gap: Spacing.two },
  typeChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    alignItems: 'center',
  },
  typeChipActive: { backgroundColor: BrandColors.primary, borderColor: BrandColors.primary },
  typeChipText: { fontWeight: '600', color: BrandColors.text },
  typeChipTextActive: { color: '#fff' },
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
  btn: {
    backgroundColor: BrandColors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontWeight: '700' },
  status: { color: BrandColors.primaryHover, fontWeight: '600' },
});
