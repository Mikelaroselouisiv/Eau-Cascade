import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { KpiCard } from '@/components/monitor/KpiCard';
import { RefreshableScroll } from '@/components/RefreshableScroll';
import { BrandColors } from '@/constants/brand';
import { useAccountingScope } from '@/context/AccountingScopeContext';
import { createSupplierPayment, getAccountingSuppliers, listBanks } from '@/services/api';
import { formatApiError } from '@/services/api-errors';
import type { AccountingSuppliersOverview, BankAccountRow } from '@/types/api';
import { businessTodayYmd, formatMoney, ymdFromIso } from '@/utils/datetime';

import { AccountingEmptyState } from './AccountingEmptyState';
import { AccountingPageShell } from './AccountingPageShell';
import { accountingStyles as styles } from './accountingStyles';

export function AccountingSuppliersScreen({ extraHeader }: { extraHeader?: ReactNode }) {
  const { companyId, canWrite, openYear, canView, ready } = useAccountingScope();
  const [overview, setOverview] = useState<AccountingSuppliersOverview | null>(null);
  const [bankAccounts, setBankAccounts] = useState<BankAccountRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [supplier, setSupplier] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'CASH' | 'BANK'>('CASH');
  const [bankId, setBankId] = useState<number | null>(null);
  const [paidOn, setPaidOn] = useState(businessTodayYmd);

  const load = useCallback(async () => {
    if (!canView || companyId == null) return;
    try {
      setError(null);
      const [sup, banks] = await Promise.all([
        getAccountingSuppliers(companyId),
        listBanks({ companyId }),
      ]);
      setOverview(sup);
      setBankAccounts(
        banks.flatMap((b) =>
          b.accounts.filter((a) => a.isActive).map((a) => ({ ...a, bankName: b.name })),
        ),
      );
    } catch (err) {
      setOverview(null);
      setError(formatApiError(err, 'Impossible de charger les fournisseurs'));
    }
  }, [canView, companyId]);

  useFocusEffect(
    useCallback(() => {
      if (!ready) return;
      void load();
    }, [load, ready]),
  );

  const names = overview?.supplierNames ?? [];

  async function submit() {
    if (!companyId) return;
    const n = Number(amount.replace(',', '.'));
    if (!supplier.trim() || !Number.isFinite(n) || n < 0.01) {
      setStatus('Fournisseur et montant sont requis');
      return;
    }
    if (method === 'BANK' && bankId == null) {
      setStatus('Choisissez un compte bancaire');
      return;
    }
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      await createSupplierPayment({
        companyId,
        supplierName: supplier.trim(),
        amount: n,
        method,
        bankAccountId: method === 'BANK' ? bankId ?? undefined : undefined,
        paidOn,
      });
      setAmount('');
      setStatus('Paiement enregistré');
      await load();
    } catch (err) {
      setError(formatApiError(err, 'Paiement refusé'));
    } finally {
      setBusy(false);
    }
  }

  const payments = overview?.payments ?? [];

  return (
    <AccountingPageShell extraHeader={extraHeader} keyboard={canWrite}>
      <RefreshableScroll
        refreshing={refreshing}
        onRefresh={async () => {
          setRefreshing(true);
          await load();
          setRefreshing(false);
        }}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.section}>Dettes fournisseurs</Text>
        <View style={styles.kpiGrid}>
          <KpiCard label="À payer" value={overview?.suppliersPayable ?? 0} money />
        </View>

        {canWrite && openYear ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Paiement</Text>
            <Text style={styles.fieldLabel}>Fournisseur</Text>
            <TextInput
              style={styles.input}
              value={supplier}
              onChangeText={setSupplier}
              placeholder="Nom"
              placeholderTextColor={BrandColors.textMuted}
            />
            {names.length > 0 ? (
              <View style={styles.chipRow}>
                {names.slice(0, 12).map((name) => (
                  <Pressable
                    key={name}
                    onPress={() => setSupplier(name)}
                    style={[styles.chip, supplier === name && styles.chipActive]}>
                    <Text style={[styles.chipText, supplier === name && styles.chipTextActive]}>
                      {name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <Text style={styles.fieldLabel}>Montant</Text>
            <TextInput
              style={styles.input}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={BrandColors.textMuted}
            />
            <Text style={styles.fieldLabel}>Mode</Text>
            <View style={styles.chipRow}>
              <Pressable
                onPress={() => setMethod('CASH')}
                style={[styles.chip, method === 'CASH' && styles.chipActive]}>
                <Text style={[styles.chipText, method === 'CASH' && styles.chipTextActive]}>Caisse</Text>
              </Pressable>
              <Pressable
                onPress={() => setMethod('BANK')}
                style={[styles.chip, method === 'BANK' && styles.chipActive]}>
                <Text style={[styles.chipText, method === 'BANK' && styles.chipTextActive]}>Banque</Text>
              </Pressable>
            </View>
            {method === 'BANK' ? (
              <View style={styles.chipRow}>
                {bankAccounts.map((account) => (
                  <Pressable
                    key={account.id}
                    onPress={() => setBankId(account.id)}
                    style={[styles.chip, bankId === account.id && styles.chipActive]}>
                    <Text style={[styles.chipText, bankId === account.id && styles.chipTextActive]}>
                      {account.bankName ? `${account.bankName} · ` : ''}
                      {account.name}
                    </Text>
                  </Pressable>
                ))}
                {bankAccounts.length === 0 ? (
                  <Text style={styles.meta}>Aucun compte bancaire actif.</Text>
                ) : null}
              </View>
            ) : null}
            <Text style={styles.fieldLabel}>Date</Text>
            <TextInput
              style={styles.input}
              value={paidOn}
              onChangeText={setPaidOn}
              placeholder="AAAA-MM-JJ"
              placeholderTextColor={BrandColors.textMuted}
            />
            <Pressable
              style={[styles.primaryBtn, busy && styles.disabled]}
              disabled={busy}
              onPress={() => void submit()}>
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Enregistrer le paiement</Text>
              )}
            </Pressable>
            {status ? <Text style={styles.ok}>{status}</Text> : null}
          </View>
        ) : (
          <AccountingEmptyState>
            {!openYear ? 'Ouvrez un exercice pour payer un fournisseur.' : 'Paiement réservé aux comptes accounting.write.'}
          </AccountingEmptyState>
        )}

        <Text style={styles.section}>Historique</Text>
        {payments.length === 0 ? (
          <AccountingEmptyState>Aucun paiement fournisseur.</AccountingEmptyState>
        ) : (
          payments.map((p) => (
            <View key={p.id} style={styles.denseRow}>
              <Text style={styles.colDate}>{ymdFromIso(p.paidAt)}</Text>
              <Text style={styles.colName} numberOfLines={2}>
                {p.supplierName}
                {'\n'}
                {p.method === 'BANK'
                  ? `Banque${p.bankAccount ? ` · ${p.bankAccount.bank.name}` : ''}`
                  : 'Caisse'}
              </Text>
              <Text style={styles.colAmt}>{formatMoney(p.amount)}</Text>
            </View>
          ))
        )}
      </RefreshableScroll>
    </AccountingPageShell>
  );
}
