import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from 'react-native';

import { RefreshableScroll } from '@/components/RefreshableScroll';
import { BrandColors } from '@/constants/brand';
import { useAccountingScope } from '@/context/AccountingScopeContext';
import { createFixedAsset, getFixedAssets, listBanks, runDepreciation } from '@/services/api';
import { formatApiError } from '@/services/api-errors';
import type { BankAccountRow, FixedAssetRow } from '@/types/api';
import { businessTodayYmd, formatMoney, ymdFromIso } from '@/utils/datetime';

import { AccountingEmptyState } from './AccountingEmptyState';
import { AccountingPageShell } from './AccountingPageShell';
import { accountingStyles as styles } from './accountingStyles';

export function AccountingAssetsScreen({ extraHeader }: { extraHeader?: ReactNode }) {
  const { companyId, canWrite, canManage, openYear, canView, ready } = useAccountingScope();
  const [assets, setAssets] = useState<FixedAssetRow[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccountRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [acqDate, setAcqDate] = useState(businessTodayYmd);
  const [cost, setCost] = useState('');
  const [residual, setResidual] = useState('0');
  const [months, setMonths] = useState('60');
  const [paidFrom, setPaidFrom] = useState<'CASH' | 'BANK' | 'SUPPLIER'>('CASH');
  const [bankId, setBankId] = useState<number | null>(null);
  const [deprPeriod, setDeprPeriod] = useState(() => businessTodayYmd().slice(0, 7));

  const load = useCallback(async () => {
    if (!canView || companyId == null) return;
    try {
      setError(null);
      const [list, banks] = await Promise.all([getFixedAssets(companyId), listBanks({ companyId })]);
      setAssets(list);
      setBankAccounts(
        banks.flatMap((b) =>
          b.accounts.filter((a) => a.isActive).map((a) => ({ ...a, bankName: b.name })),
        ),
      );
    } catch (err) {
      setAssets([]);
      setError(formatApiError(err, 'Impossible de charger les immobilisations'));
    }
  }, [canView, companyId]);

  useFocusEffect(
    useCallback(() => {
      if (!ready) return;
      void load();
    }, [load, ready]),
  );

  async function submit() {
    if (!companyId) return;
    const n = Number(cost.replace(',', '.'));
    if (name.trim().length < 2 || !Number.isFinite(n) || n < 0.01) {
      setStatus('Désignation et coût d’acquisition sont requis');
      return;
    }
    if (paidFrom === 'BANK' && bankId == null) {
      setStatus('Choisissez un compte bancaire');
      return;
    }
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      await createFixedAsset({
        companyId,
        name: name.trim(),
        acquisitionDate: acqDate,
        acquisitionCost: n,
        residualValue: Number(residual.replace(',', '.')) || 0,
        usefulLifeMonths: Number(months) || 1,
        paidFrom,
        bankAccountId: paidFrom === 'BANK' ? bankId ?? undefined : undefined,
      });
      setName('');
      setCost('');
      setStatus('Immobilisation enregistrée');
      await load();
    } catch (err) {
      setError(formatApiError(err, 'Immobilisation refusée'));
    } finally {
      setBusy(false);
    }
  }

  function onDepreciate() {
    if (companyId == null) return;
    Alert.alert('Amortissements', `Passer les amortissements pour ${deprPeriod} ?`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Passer le mois',
        onPress: () => {
          void (async () => {
            setBusy(true);
            setError(null);
            try {
              const res = await runDepreciation({ companyId, period: deprPeriod });
              const posted = res.results.filter((r) => r.status === 'posted').length;
              setStatus(`${posted} dotation(s) passée(s) pour ${res.period}.`);
              await load();
            } catch (err) {
              setError(formatApiError(err, 'Amortissement impossible'));
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  }

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
        {status ? <Text style={styles.ok}>{status}</Text> : null}
        <Text style={styles.section}>Nouvelle immobilisation</Text>
        {!canWrite || !openYear ? (
          <AccountingEmptyState>
            {!openYear
              ? 'Ouvrez un exercice pour enregistrer une immobilisation.'
              : 'Création réservée aux comptes accounting.write.'}
          </AccountingEmptyState>
        ) : (
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Désignation</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Ex. Camionnette"
              placeholderTextColor={BrandColors.textMuted}
            />
            <Text style={styles.fieldLabel}>Date d’acquisition</Text>
            <TextInput
              style={styles.input}
              value={acqDate}
              onChangeText={setAcqDate}
              placeholder="AAAA-MM-JJ"
              placeholderTextColor={BrandColors.textMuted}
            />
            <Text style={styles.fieldLabel}>Coût</Text>
            <TextInput
              style={styles.input}
              value={cost}
              onChangeText={setCost}
              keyboardType="decimal-pad"
              placeholderTextColor={BrandColors.textMuted}
            />
            <Text style={styles.fieldLabel}>Valeur résiduelle</Text>
            <TextInput
              style={styles.input}
              value={residual}
              onChangeText={setResidual}
              keyboardType="decimal-pad"
              placeholderTextColor={BrandColors.textMuted}
            />
            <Text style={styles.fieldLabel}>Durée (mois)</Text>
            <TextInput
              style={styles.input}
              value={months}
              onChangeText={setMonths}
              keyboardType="number-pad"
              placeholderTextColor={BrandColors.textMuted}
            />
            <Text style={styles.fieldLabel}>Financé par</Text>
            <View style={styles.chipRow}>
              {(['CASH', 'BANK', 'SUPPLIER'] as const).map((mode) => (
                <Pressable
                  key={mode}
                  onPress={() => setPaidFrom(mode)}
                  style={[styles.chip, paidFrom === mode && styles.chipActive]}>
                  <Text style={[styles.chipText, paidFrom === mode && styles.chipTextActive]}>
                    {mode === 'CASH' ? 'Caisse' : mode === 'BANK' ? 'Banque' : 'Fournisseur'}
                  </Text>
                </Pressable>
              ))}
            </View>
            {paidFrom === 'BANK' ? (
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
              </View>
            ) : null}
            <Pressable
              style={[styles.primaryBtn, busy && styles.disabled]}
              disabled={busy}
              onPress={() => void submit()}>
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Enregistrer</Text>
              )}
            </Pressable>
          </View>
        )}

        <Text style={styles.section}>Amortissements</Text>
        <TextInput
          style={styles.input}
          value={deprPeriod}
          onChangeText={setDeprPeriod}
          placeholder="AAAA-MM"
          placeholderTextColor={BrandColors.textMuted}
        />
        {canManage ? (
          <Pressable
            style={[styles.secondaryBtn, (busy || !openYear) && styles.disabled]}
            disabled={busy || !openYear}
            onPress={onDepreciate}>
            <Text style={styles.secondaryBtnText}>Passer le mois</Text>
          </Pressable>
        ) : (
          <AccountingEmptyState>Amortissement réservé aux comptes accounting.manage.</AccountingEmptyState>
        )}

        <Text style={styles.section}>Registre</Text>
        {assets.length === 0 ? (
          <AccountingEmptyState>Aucune immobilisation.</AccountingEmptyState>
        ) : (
          assets.map((asset) => (
            <View key={asset.id} style={styles.card}>
              <Text style={styles.cardTitle}>{asset.name}</Text>
              <Text style={styles.meta}>
                Acquis {ymdFromIso(asset.acquisitionDate)} · {formatMoney(asset.acquisitionCost)}
              </Text>
              <View style={styles.denseRow}>
                <Text style={styles.colMuted}>Mensuel</Text>
                <Text style={styles.colAmt}>{formatMoney(asset.monthlyDepreciation)}</Text>
              </View>
              <View style={styles.denseRow}>
                <Text style={styles.colMuted}>Cumul amort.</Text>
                <Text style={styles.colAmt}>{formatMoney(asset.accumulatedDepreciation)}</Text>
              </View>
              <View style={styles.denseRow}>
                <Text style={styles.colMuted}>VNC</Text>
                <Text style={styles.colAmt}>{formatMoney(asset.netBookValue)}</Text>
              </View>
              <Text style={styles.meta}>
                Dernière dotation : {asset.lastDepreciationPeriod || 'aucune'}
              </Text>
            </View>
          ))
        )}
      </RefreshableScroll>
    </AccountingPageShell>
  );
}
