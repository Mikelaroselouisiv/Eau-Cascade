import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { RegisterSessionBar } from '@/components/pos/RegisterSessionBar';
import { RefreshableScroll } from '@/components/RefreshableScroll';
import { Screen } from '@/components/Screen';
import { BrandColors } from '@/constants/brand';
import { EXPENSE_LABEL_OPTIONS, EXPENSE_LABEL_OTHER } from '@/constants/expenseLabels';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useCompanyScope } from '@/hooks/useCompanyScope';
import {
  createFinanceEntry,
  listRegisterSessionExpenses,
  type RegisterSessionExpenseRow,
} from '@/services/api';
import type { RegisterSessionContext, RegisterSessionDetail } from '@/types/api';
import { formatMoney, formatDateTime } from '@/utils/datetime';
import { isPlantCashier, resolvedDepartmentIds } from '@/utils/user-scope';

export function PosExpensesScreen() {
  const { user } = useAuth();
  const { companyId: scopedCompanyId } = useCompanyScope();
  const allowed = isPlantCashier(user);
  const assignedDeptIds = resolvedDepartmentIds(user);
  const departmentId = (user?.productionDepartmentIds ?? [])[0] ?? assignedDeptIds[0];
  const companyId =
    typeof user?.companyId === 'number' ? user.companyId : (scopedCompanyId ?? undefined);

  const [session, setSession] = useState<RegisterSessionDetail | null>(null);
  const [mineElsewhere, setMineElsewhere] = useState<RegisterSessionDetail | null>(null);
  const [occupancy, setOccupancy] = useState<RegisterSessionDetail | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [label, setLabel] = useState('');
  const [descOther, setDescOther] = useState('');
  const [detail, setDetail] = useState('');
  const [amount, setAmount] = useState('');
  const [rows, setRows] = useState<RegisterSessionExpenseRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const sessionOpen = session != null;
  const effectiveCompanyId = session?.department.company.id ?? companyId;

  const loadRows = useCallback(async () => {
    if (!session) {
      setRows([]);
      return;
    }
    try {
      setRows(await listRegisterSessionExpenses(session.id));
    } catch {
      setRows([]);
    }
  }, [session]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useFocusEffect(
    useCallback(() => {
      setRefreshKey((k) => k + 1);
    }, []),
  );

  const handleContextChange = useCallback((ctx: RegisterSessionContext) => {
    setSession(ctx.local);
    setMineElsewhere(ctx.mineElsewhere);
    setOccupancy(ctx.occupancy);
  }, []);

  async function submit() {
    if (!sessionOpen || effectiveCompanyId == null) {
      setStatus('Caisse fermée');
      return;
    }
    const description = label === EXPENSE_LABEL_OTHER ? descOther.trim() : label.trim();
    const value = Number(amount.replace(',', '.'));
    if (!description || !Number.isFinite(value) || value <= 0) {
      setStatus('Libellé et montant requis');
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      await createFinanceEntry({
        type: 'EXPENSE',
        amount: value,
        description,
        detail: detail.trim() || undefined,
        companyId: effectiveCompanyId,
      });
      setLabel('');
      setDescOther('');
      setDetail('');
      setAmount('');
      setStatus('Dépense enregistrée');
      await loadRows();
    } catch {
      setStatus('Enregistrement impossible');
    } finally {
      setBusy(false);
    }
  }

  if (!allowed) {
    return (
      <Screen>
        <View style={styles.blocked}>
          <Text style={styles.blockedText}>Accès refusé.</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen keyboard>
      <RefreshableScroll
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          setRefreshKey((k) => k + 1);
          void loadRows().finally(() => setRefreshing(false));
        }}>
        <View style={styles.body}>
          <RegisterSessionBar
            companyId={effectiveCompanyId}
            departmentId={session?.departmentId ?? departmentId}
            session={session}
            mineElsewhere={mineElsewhere}
            occupancy={occupancy}
            refreshKey={refreshKey}
            onContextChange={handleContextChange}
            onStatus={setStatus}
          />
          {status ? <Text style={styles.status}>{status}</Text> : null}
          {!sessionOpen ? (
            <Text style={styles.meta}>Caisse fermée</Text>
          ) : (
            <>
              <Text style={styles.fieldLabel}>Libellé</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chips}>
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
              {label === EXPENSE_LABEL_OTHER ? (
                <TextInput
                  style={styles.input}
                  placeholder="Préciser"
                  placeholderTextColor={BrandColors.textMuted}
                  value={descOther}
                  onChangeText={setDescOther}
                />
              ) : null}
              <TextInput
                style={styles.input}
                placeholder="Détail"
                placeholderTextColor={BrandColors.textMuted}
                value={detail}
                onChangeText={setDetail}
              />
              <TextInput
                style={styles.input}
                placeholder="Montant"
                placeholderTextColor={BrandColors.textMuted}
                keyboardType="decimal-pad"
                value={amount}
                onChangeText={setAmount}
              />
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
              {rows.length === 0 ? (
                <Text style={styles.meta}>Aucune dépense</Text>
              ) : (
                rows.map((row) => (
                  <View key={row.id} style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{row.description}</Text>
                      {row.detail ? <Text style={styles.meta}>{row.detail}</Text> : null}
                      <Text style={styles.meta}>{formatDateTime(row.createdAt)}</Text>
                    </View>
                    <Text style={styles.rowAmt}>{formatMoney(row.amount)}</Text>
                  </View>
                ))
              )}
            </>
          )}
        </View>
      </RefreshableScroll>
    </Screen>
  );
}

const styles = StyleSheet.create({
  blocked: { flex: 1, justifyContent: 'center', padding: Spacing.five },
  blockedText: { textAlign: 'center', color: BrandColors.textMuted },
  body: { padding: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.six },
  status: { color: BrandColors.primaryHover, fontWeight: '600' },
  meta: { fontSize: 13, color: BrandColors.textMuted },
  fieldLabel: { fontWeight: '600', color: BrandColors.textMuted, fontSize: 13, marginTop: 4 },
  chips: { flexGrow: 0 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    marginRight: 8,
    backgroundColor: BrandColors.surface,
  },
  chipActive: { backgroundColor: BrandColors.primary, borderColor: BrandColors.primary },
  chipText: { fontWeight: '600', color: BrandColors.text, fontSize: 12 },
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
  primaryBtn: {
    backgroundColor: BrandColors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.55 },
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: BrandColors.border,
  },
  rowTitle: { fontWeight: '600', color: BrandColors.text },
  rowAmt: { fontWeight: '700', color: BrandColors.text },
});
