import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from 'react-native';

import { RefreshableScroll } from '@/components/RefreshableScroll';
import { BrandColors } from '@/constants/brand';
import { useAccountingScope } from '@/context/AccountingScopeContext';
import { createManualJournalEntry, getAccountingAccounts } from '@/services/api';
import { formatApiError } from '@/services/api-errors';
import type { AccountRow } from '@/types/api';
import { businessTodayYmd, formatMoney } from '@/utils/datetime';

import { AccountPickerModal } from './AccountPickerModal';
import { AccountingEmptyState } from './AccountingEmptyState';
import { AccountingPageShell } from './AccountingPageShell';
import { accountingStyles as styles } from './accountingStyles';

type ManualLine = { accountCode: string; debit: string; credit: string };

function emptyLines(): ManualLine[] {
  return [
    { accountCode: '', debit: '', credit: '' },
    { accountCode: '', debit: '', credit: '' },
  ];
}

export function AccountingSaisieScreen() {
  const router = useRouter();
  const { companyId, canWrite, openYear, ready, selectedYear } = useAccountingScope();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [entryDate, setEntryDate] = useState(businessTodayYmd);
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<ManualLine[]>(emptyLines);
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const activeAccounts = useMemo(() => accounts.filter((a) => a.isActive), [accounts]);

  const load = useCallback(async () => {
    if (!canWrite || companyId == null) return;
    try {
      setLoadError(null);
      setAccounts(await getAccountingAccounts(companyId));
    } catch (err) {
      setLoadError(formatApiError(err, 'Impossible de charger le plan comptable'));
    }
  }, [canWrite, companyId]);

  useFocusEffect(
    useCallback(() => {
      if (!ready) return;
      void load();
    }, [load, ready]),
  );

  const totals = useMemo(() => {
    return lines.reduce(
      (acc, line) => {
        acc.debit += Number(line.debit.replace(',', '.')) || 0;
        acc.credit += Number(line.credit.replace(',', '.')) || 0;
        return acc;
      },
      { debit: 0, credit: 0 },
    );
  }, [lines]);

  function accountLabel(code: string) {
    const found = activeAccounts.find((a) => a.code === code);
    return found ? `${found.code} · ${found.name}` : '';
  }

  function updateLine(index: number, patch: Partial<ManualLine>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  async function submit() {
    if (!companyId) return;
    const payloadLines = lines
      .filter((l) => l.accountCode.trim())
      .map((l) => ({
        accountCode: l.accountCode.trim(),
        debit: l.debit ? Number(l.debit.replace(',', '.')) : 0,
        credit: l.credit ? Number(l.credit.replace(',', '.')) : 0,
      }));
    if (description.trim().length < 2) {
      setError('Libellé requis (2 caractères minimum)');
      return;
    }
    if (payloadLines.length < 2) {
      setError('Au moins deux lignes avec un compte sont requises');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createManualJournalEntry({
        companyId,
        entryDate,
        journalCode: 'OD',
        description: description.trim(),
        lines: payloadLines,
      });
      setDescription('');
      setLines(emptyLines());
      Alert.alert('Écriture OD enregistrée', 'L’écriture a été postée au journal.', [
        { text: 'Rester ici' },
        {
          text: 'Voir au journal',
          onPress: () => router.push('/(app)/accounting/consulter?view=journal' as never),
        },
      ]);
    } catch (err) {
      setError(formatApiError(err, 'Écriture refusée'));
    } finally {
      setBusy(false);
    }
  }

  if (!canWrite) {
    return (
      <AccountingPageShell>
        <AccountingEmptyState>Saisie OD réservée aux comptes accounting.write.</AccountingEmptyState>
      </AccountingPageShell>
    );
  }

  if (!openYear) {
    return (
      <AccountingPageShell>
        <AccountingEmptyState>
          Exercice non ouvert. Ouvrez un exercice dans Plus → Exercices avant de saisir une OD.
        </AccountingEmptyState>
      </AccountingPageShell>
    );
  }

  const unbalanced = Math.abs(totals.debit - totals.credit) > 0.009;

  return (
    <AccountingPageShell keyboard>
      <RefreshableScroll
        refreshing={refreshing}
        onRefresh={async () => {
          setRefreshing(true);
          await load();
          setRefreshing(false);
        }}>
        {loadError ? <Text style={styles.error}>{loadError}</Text> : null}
        <Text style={styles.section}>Saisie OD</Text>
        <Text style={styles.meta}>
          {openYear.label}
          {selectedYear && selectedYear.id !== openYear.id
            ? ' · l’écriture sera postée sur l’exercice ouvert'
            : ''}
        </Text>

        <Text style={styles.fieldLabel}>Date</Text>
        <TextInput
          style={styles.input}
          value={entryDate}
          onChangeText={setEntryDate}
          placeholder="AAAA-MM-JJ"
          placeholderTextColor={BrandColors.textMuted}
        />
        <Text style={styles.fieldLabel}>Libellé</Text>
        <TextInput
          style={styles.input}
          value={description}
          onChangeText={setDescription}
          placeholder="Description de l’écriture"
          placeholderTextColor={BrandColors.textMuted}
        />

        <View style={styles.tableHead}>
          <Text style={[styles.tableHeadText, { flex: 1 }]}>Compte</Text>
          <Text style={[styles.tableHeadText, styles.colAmt]}>Débit</Text>
          <Text style={[styles.tableHeadText, styles.colAmt]}>Crédit</Text>
        </View>
        {lines.map((line, index) => (
          <View key={index} style={[styles.card, { padding: 10 }]}>
            <Pressable style={styles.pickerBtn} onPress={() => setPickerIndex(index)}>
              <Text style={line.accountCode ? styles.pickerBtnText : styles.pickerPlaceholder}>
                {accountLabel(line.accountCode) || 'Rechercher un compte…'}
              </Text>
            </Pressable>
            <View style={styles.row}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Débit"
                placeholderTextColor={BrandColors.textMuted}
                keyboardType="decimal-pad"
                value={line.debit}
                onChangeText={(debit) => updateLine(index, { debit, credit: debit ? '' : line.credit })}
              />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Crédit"
                placeholderTextColor={BrandColors.textMuted}
                keyboardType="decimal-pad"
                value={line.credit}
                onChangeText={(credit) =>
                  updateLine(index, { credit, debit: credit ? '' : line.debit })
                }
              />
            </View>
          </View>
        ))}

        <View style={styles.totalsBar}>
          <Text style={styles.meta}>D {formatMoney(totals.debit)}</Text>
          <Text style={styles.meta}>C {formatMoney(totals.credit)}</Text>
          <Text style={unbalanced ? styles.totalsWarn : styles.ok}>
            {unbalanced ? 'Non équilibré' : 'Équilibré'}
          </Text>
        </View>

        <Pressable
          style={styles.secondaryBtn}
          onPress={() =>
            setLines((prev) => [...prev, { accountCode: '', debit: '', credit: '' }])
          }>
          <Text style={styles.secondaryBtnText}>+ Ligne</Text>
        </Pressable>
        <Pressable
          style={[styles.primaryBtn, busy && styles.disabled]}
          disabled={busy}
          onPress={() => void submit()}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Enregistrer l’écriture</Text>}
        </Pressable>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </RefreshableScroll>

      <AccountPickerModal
        visible={pickerIndex != null}
        accounts={activeAccounts}
        onClose={() => setPickerIndex(null)}
        onSelect={(account) => {
          if (pickerIndex != null) updateLine(pickerIndex, { accountCode: account.code });
        }}
      />
    </AccountingPageShell>
  );
}
