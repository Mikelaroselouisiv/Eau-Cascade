import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Screen } from '@/components/Screen';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import {
  createBank,
  createBankAccount,
  getCompanies,
  listBanks,
  updateBank,
  updateBankAccount,
} from '@/services/api';
import type { BankRow, CompanyListItem } from '@/types/api';
import { formatMoney } from '@/utils/datetime';

export function BanksConfigScreen() {
  const { can, canPerm } = useAuth();
  const canManage = can(['ADMIN', 'MANAGER']) || canPerm('banks.manage');
  const allowed = canManage || canPerm('banks.view');

  const [companies, setCompanies] = useState<CompanyListItem[]>([]);
  const [companyId, setCompanyId] = useState<number | ''>('');
  const [banks, setBanks] = useState<BankRow[]>([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const [bankName, setBankName] = useState('');
  const [bankNote, setBankNote] = useState('');
  const [accountBankId, setAccountBankId] = useState<number | ''>('');
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [openingBalance, setOpeningBalance] = useState('0');

  const load = useCallback(async () => {
    if (!allowed) return;
    try {
      setError(null);
      const co = await getCompanies();
      setCompanies(co);
      const cid =
        companyId !== '' && co.some((c) => c.id === companyId) ? companyId : (co[0]?.id ?? '');
      if (cid !== companyId) setCompanyId(cid);
      if (typeof cid === 'number') {
        setBanks(await listBanks({ companyId: cid, includeInactive }));
      }
    } catch {
      setError('Impossible de charger les banques');
    }
  }, [allowed, companyId, includeInactive]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function onCreateBank() {
    if (typeof companyId !== 'number' || !bankName.trim()) {
      setStatus('Nom de banque requis');
      return;
    }
    setBusy(true);
    try {
      await createBank({
        companyId,
        name: bankName.trim(),
        note: bankNote.trim() || undefined,
      });
      setBankName('');
      setBankNote('');
      setStatus('Banque créée');
      await load();
    } catch {
      setStatus('Création banque impossible');
    } finally {
      setBusy(false);
    }
  }

  async function onCreateAccount() {
    if (typeof accountBankId !== 'number' || !accountName.trim()) {
      setStatus('Banque et libellé requis');
      return;
    }
    setBusy(true);
    try {
      await createBankAccount({
        bankId: accountBankId,
        name: accountName.trim(),
        accountNumber: accountNumber.trim() || undefined,
        openingBalance: Number(openingBalance.replace(',', '.')) || 0,
      });
      setAccountName('');
      setAccountNumber('');
      setOpeningBalance('0');
      setStatus('Compte créé');
      await load();
    } catch {
      setStatus('Création compte impossible');
    } finally {
      setBusy(false);
    }
  }

  if (!allowed) {
    return (
      <Screen>
        <View style={styles.blocked}>
          <Text style={styles.blockedText}>Banques réservées à la gestion.</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen keyboard>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {status ? <Text style={styles.status}>{status}</Text> : null}

      <FlatList
        data={banks}
        keyExtractor={(b) => String(b.id)}
        contentContainerStyle={styles.list}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          void load().finally(() => setRefreshing(false));
        }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
              {companies.map((c) => (
                <Chip
                  key={c.id}
                  label={c.name}
                  active={companyId === c.id}
                  onPress={() => setCompanyId(c.id)}
                />
              ))}
            </ScrollView>
            <Pressable
              style={styles.toggle}
              onPress={() => setIncludeInactive((v) => !v)}>
              <Text style={styles.toggleText}>
                {includeInactive ? '✓ Inclure inactifs' : 'Inclure inactifs'}
              </Text>
            </Pressable>

            {canManage ? (
              <>
            <Text style={styles.section}>Nouvelle banque</Text>
            <TextInput
              style={styles.input}
              placeholder="Nom *"
              placeholderTextColor={BrandColors.textMuted}
              value={bankName}
              onChangeText={setBankName}
            />
            <TextInput
              style={styles.input}
              placeholder="Note"
              placeholderTextColor={BrandColors.textMuted}
              value={bankNote}
              onChangeText={setBankNote}
            />
            <Pressable
              style={[styles.primaryBtn, busy && styles.disabled]}
              disabled={busy}
              onPress={() => void onCreateBank()}>
              <Text style={styles.primaryBtnText}>Ajouter la banque</Text>
            </Pressable>

            <Text style={styles.section}>Nouveau compte</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
              {banks
                .filter((b) => b.isActive)
                .map((b) => (
                  <Chip
                    key={b.id}
                    label={b.name}
                    active={accountBankId === b.id}
                    onPress={() => setAccountBankId(b.id)}
                  />
                ))}
            </ScrollView>
            <TextInput
              style={styles.input}
              placeholder="Libellé du compte *"
              placeholderTextColor={BrandColors.textMuted}
              value={accountName}
              onChangeText={setAccountName}
            />
            <TextInput
              style={styles.input}
              placeholder="N° de compte"
              placeholderTextColor={BrandColors.textMuted}
              value={accountNumber}
              onChangeText={setAccountNumber}
            />
            <TextInput
              style={styles.input}
              placeholder="Solde d’ouverture"
              placeholderTextColor={BrandColors.textMuted}
              keyboardType="decimal-pad"
              value={openingBalance}
              onChangeText={setOpeningBalance}
            />
            <Pressable
              style={[styles.primaryBtn, busy && styles.disabled]}
              disabled={busy}
              onPress={() => void onCreateAccount()}>
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Ajouter le compte</Text>
              )}
            </Pressable>
              </>
            ) : null}

            <Text style={styles.section}>{banks.length} banque(s)</Text>
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>Aucune banque</Text>}
        renderItem={({ item: b }) => (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <Text style={styles.cardTitle}>
                {b.name}
                {!b.isActive ? ' (inactive)' : ''}
              </Text>
              <Pressable
                onPress={() => {
                  void updateBank(b.id, { isActive: !b.isActive }).then(() => load());
                }}>
                <Text style={styles.link}>{b.isActive ? 'Désactiver' : 'Activer'}</Text>
              </Pressable>
            </View>
            {b.note ? <Text style={styles.meta}>{b.note}</Text> : null}
            {(b.accounts ?? []).map((a) => (
              <View key={a.id} style={styles.accountRow}>
                <View style={styles.flex}>
                  <Text style={styles.accountName}>
                    {a.name}
                    {!a.isActive ? ' (inactif)' : ''}
                  </Text>
                  <Text style={styles.meta}>
                    {a.accountNumber || 'Sans n°'} · Solde {formatMoney(a.balance)}
                  </Text>
                </View>
                <Pressable
                  onPress={() => {
                    void updateBankAccount(a.id, { isActive: !a.isActive }).then(() => load());
                  }}>
                  <Text style={styles.link}>{a.isActive ? 'Off' : 'On'}</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
      />
    </Screen>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  blocked: { flex: 1, justifyContent: 'center', padding: Spacing.five },
  blockedText: { textAlign: 'center', color: BrandColors.textMuted },
  error: { color: BrandColors.danger, fontWeight: '600', paddingHorizontal: Spacing.three, marginTop: 8 },
  status: { color: BrandColors.primaryHover, fontWeight: '600', paddingHorizontal: Spacing.three, marginTop: 8 },
  list: { padding: Spacing.three, paddingBottom: Spacing.six },
  header: { gap: Spacing.two, marginBottom: Spacing.two },
  section: { fontWeight: '700', color: BrandColors.text, marginTop: 4 },
  empty: { textAlign: 'center', color: BrandColors.textMuted, marginTop: Spacing.four },
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
  chips: { flexGrow: 0 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    marginRight: 8,
    backgroundColor: BrandColors.surface,
    maxWidth: 180,
  },
  chipActive: { backgroundColor: BrandColors.primary, borderColor: BrandColors.primary },
  chipText: { fontWeight: '600', color: BrandColors.text, fontSize: 13 },
  chipTextActive: { color: '#fff' },
  toggle: { paddingVertical: 6 },
  toggleText: { color: BrandColors.textMuted, fontWeight: '600' },
  card: {
    backgroundColor: BrandColors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: Spacing.three,
    marginBottom: Spacing.two,
    gap: 8,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  cardTitle: { flex: 1, fontWeight: '700', color: BrandColors.text, fontSize: 16 },
  meta: { fontSize: 12, color: BrandColors.textMuted },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  accountName: { fontWeight: '600', color: BrandColors.text },
  flex: { flex: 1 },
  link: { color: BrandColors.primary, fontWeight: '700' },
  primaryBtn: {
    backgroundColor: BrandColors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.55 },
});
