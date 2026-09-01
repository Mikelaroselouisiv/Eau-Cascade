import { useCallback, useMemo, useState } from 'react';
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

import { KpiCard } from '@/components/monitor/KpiCard';
import { ModalShell } from '@/components/ModalShell';
import { RefreshableScroll } from '@/components/RefreshableScroll';
import { Screen } from '@/components/Screen';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useCompanyScope } from '@/hooks/useCompanyScope';
import {
  createDonation,
  createDonationBeneficiary,
  getDepartments,
  getDonationBeneficiary,
  getDonationSummary,
  getProducts,
  listDonationBeneficiaries,
} from '@/services/api';
import { formatApiError } from '@/services/api-errors';
import type {
  Department,
  DonationBeneficiaryDetail,
  DonationBeneficiaryListItem,
  DonationSummary,
  Product,
} from '@/types/api';
import { formatDateTime } from '@/utils/datetime';
import { formatQuantity } from '@/utils/quantity';
import { defaultAssignedPlantDepartmentId, departmentsForUser } from '@/utils/user-scope';

export function DonationBeneficiariesScreen() {
  const { canPerm, user } = useAuth();
  const { companyId, ready } = useCompanyScope();
  const allowed = canPerm('donation.view');
  const canManage = canPerm('donation.manage');

  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [summary, setSummary] = useState<DonationSummary | null>(null);
  const [rows, setRows] = useState<DonationBeneficiaryListItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detail, setDetail] = useState<DonationBeneficiaryDetail | null>(null);
  const [createVisible, setCreateVisible] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [creating, setCreating] = useState(false);
  const [createStatus, setCreateStatus] = useState<string | null>(null);

  const [donateVisible, setDonateVisible] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [donateDeptId, setDonateDeptId] = useState<number | ''>('');
  const [products, setProducts] = useState<Product[]>([]);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [donateBusy, setDonateBusy] = useState(false);
  const [donateStatus, setDonateStatus] = useState<string | null>(null);

  const donateItems = useMemo(
    () =>
      products
        .map((p) => ({ productId: p.id, quantity: Number(String(qty[p.id] ?? '').replace(',', '.')) }))
        .filter((i) => Number.isFinite(i.quantity) && i.quantity > 0),
    [products, qty],
  );

  const load = useCallback(async () => {
    if (!allowed || companyId == null) return;
    try {
      setError(null);
      const [sum, list] = await Promise.all([
        getDonationSummary(companyId),
        listDonationBeneficiaries({ companyId, q: query || undefined }),
      ]);
      setSummary(sum);
      setRows(list);
    } catch {
      setSummary(null);
      setRows([]);
      setError('Impossible de charger les dons');
    }
  }, [allowed, companyId, query]);

  useFocusEffect(
    useCallback(() => {
      if (!ready) return;
      void load();
    }, [load, ready]),
  );

  async function openDetail(row: DonationBeneficiaryListItem) {
    try {
      setDetail(await getDonationBeneficiary(row.id));
    } catch {
      setError('Impossible d’ouvrir la fiche');
    }
  }

  async function submitCreate() {
    if (!canManage || companyId == null) return;
    const name = newName.trim();
    if (!name) {
      setCreateStatus('Nom requis');
      return;
    }
    setCreating(true);
    setCreateStatus(null);
    try {
      const created = await createDonationBeneficiary({
        companyId,
        name,
        phone: newPhone.trim() || undefined,
      });
      setCreateVisible(false);
      setNewName('');
      setNewPhone('');
      await load();
      await openDetail(created);
    } catch (err) {
      setCreateStatus(formatApiError(err, 'Enregistrement impossible'));
    } finally {
      setCreating(false);
    }
  }

  async function openDonate() {
    if (!detail || companyId == null) return;
    setDonateStatus(null);
    setQty({});
    setDonateVisible(true);
    try {
      const depts = departmentsForUser(await getDepartments(companyId), user);
      setDepartments(depts);
      const first = defaultAssignedPlantDepartmentId(depts, user, detail.departmentId);
      setDonateDeptId(first);
      if (typeof first === 'number') {
        const list = await getProducts(first);
        setProducts(list.filter((p) => p.nature !== 'RAW_MATERIAL'));
      } else {
        setProducts([]);
      }
    } catch {
      setDepartments([]);
      setProducts([]);
    }
  }

  async function onSelectDept(id: number) {
    setDonateDeptId(id);
    setQty({});
    try {
      const list = await getProducts(id);
      setProducts(list.filter((p) => p.nature !== 'RAW_MATERIAL'));
    } catch {
      setProducts([]);
    }
  }

  async function submitDonation() {
    if (!detail || donateDeptId === '' || !donateItems.length) {
      setDonateStatus('Indiquez une quantité.');
      return;
    }
    setDonateBusy(true);
    setDonateStatus(null);
    try {
      await createDonation({
        beneficiaryId: detail.id,
        departmentId: donateDeptId,
        items: donateItems,
      });
      setDonateVisible(false);
      setDetail(await getDonationBeneficiary(detail.id));
      await load();
    } catch (err) {
      setDonateStatus(formatApiError(err, 'Don impossible'));
    } finally {
      setDonateBusy(false);
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

  if (ready && companyId == null) {
    return (
      <Screen>
        <View style={styles.blocked}>
          <Text style={styles.blockedText}>Aucune entreprise.</Text>
        </View>
      </Screen>
    );
  }

  if (companyId == null) {
    return (
      <Screen>
        <View style={styles.blocked}>
          <ActivityIndicator color={BrandColors.accent} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <RefreshableScroll
        refreshing={refreshing}
        onRefresh={async () => {
          setRefreshing(true);
          await load();
          setRefreshing(false);
        }}>
        <View style={styles.body}>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.kpiRow}>
            <KpiCard label="Bénéficiaires" value={String(summary?.beneficiariesTotal ?? 0)} />
            <KpiCard label="Dons" value={String(summary?.donationsTotal ?? 0)} />
            <KpiCard label="Quantité" value={formatQuantity(summary?.quantityTotal ?? 0)} />
          </View>
          <View style={styles.searchRow}>
            <TextInput
              style={styles.input}
              value={q}
              onChangeText={setQ}
              placeholder="Nom ou téléphone"
              placeholderTextColor={BrandColors.textMuted}
              onSubmitEditing={() => setQuery(q.trim())}
            />
            <Pressable style={styles.searchBtn} onPress={() => setQuery(q.trim())}>
              <Text style={styles.searchBtnText}>OK</Text>
            </Pressable>
          </View>
          {canManage ? (
            <Pressable style={styles.primaryBtn} onPress={() => setCreateVisible(true)}>
              <Text style={styles.primaryBtnText}>Nouveau bénéficiaire</Text>
            </Pressable>
          ) : null}
          {rows.length === 0 ? <Text style={styles.meta}>Aucun bénéficiaire</Text> : null}
          {rows.map((b) => (
            <Pressable key={b.id} style={styles.row} onPress={() => void openDetail(b)}>
              <Text style={styles.rowName}>{b.name}</Text>
              <Text style={styles.meta}>
                {b.donationsCount} don{b.donationsCount > 1 ? 's' : ''}
              </Text>
            </Pressable>
          ))}
        </View>
      </RefreshableScroll>

      <ModalShell
        visible={detail != null}
        onRequestClose={() => setDetail(null)}
        body={
          detail ? (
            <ScrollView contentContainerStyle={styles.modalBody}>
              <Text style={styles.rowName}>{detail.name}</Text>
              <Text style={styles.meta}>{detail.phone || '—'}</Text>
              <Text style={styles.meta}>
                {detail.donationsCount} don{detail.donationsCount > 1 ? 's' : ''} ·{' '}
                {formatQuantity(detail.quantityTotal)}
              </Text>
              {canManage && detail.isActive ? (
                <Pressable style={styles.primaryBtn} onPress={() => void openDonate()}>
                  <Text style={styles.primaryBtnText}>Enregistrer un don</Text>
                </Pressable>
              ) : null}
              {detail.donations.map((d) => (
                <View key={d.id} style={styles.historyCard}>
                  <Text style={styles.rowName}>
                    {formatDateTime(d.createdAt)} · {d.department?.name}
                  </Text>
                  {d.items.map((it) => (
                    <Text key={it.id} style={styles.meta}>
                      {it.product?.name} · {formatQuantity(it.quantity)}
                    </Text>
                  ))}
                </View>
              ))}
            </ScrollView>
          ) : null
        }
        footer={
          <View style={styles.footer}>
            <Pressable style={styles.secondaryBtn} onPress={() => setDetail(null)}>
              <Text style={styles.secondaryBtnText}>Fermer</Text>
            </Pressable>
          </View>
        }>
        <View style={styles.modalTop}>
          <Text style={styles.modalTopTitle}>Fiche don</Text>
          <Pressable onPress={() => setDetail(null)} hitSlop={12}>
            <Text style={styles.modalClose}>Fermer</Text>
          </Pressable>
        </View>
      </ModalShell>

      <ModalShell
        visible={createVisible}
        onRequestClose={() => setCreateVisible(false)}
        body={
          <View style={styles.modalBody}>
            <TextInput
              style={styles.input}
              value={newName}
              onChangeText={setNewName}
              placeholder="Nom"
              placeholderTextColor={BrandColors.textMuted}
            />
            <TextInput
              style={styles.input}
              value={newPhone}
              onChangeText={setNewPhone}
              placeholder="Téléphone"
              placeholderTextColor={BrandColors.textMuted}
              keyboardType="phone-pad"
            />
            {createStatus ? <Text style={styles.error}>{createStatus}</Text> : null}
          </View>
        }
        footer={
          <View style={styles.footer}>
            <Pressable
              style={[styles.primaryBtn, creating && styles.disabled]}
              disabled={creating}
              onPress={() => void submitCreate()}>
              <Text style={styles.primaryBtnText}>{creating ? '…' : 'Enregistrer'}</Text>
            </Pressable>
          </View>
        }>
        <View style={styles.modalTop}>
          <Text style={styles.modalTopTitle}>Nouveau bénéficiaire</Text>
          <Pressable onPress={() => setCreateVisible(false)} hitSlop={12}>
            <Text style={styles.modalClose}>Fermer</Text>
          </Pressable>
        </View>
      </ModalShell>

      <ModalShell
        visible={donateVisible}
        onRequestClose={() => setDonateVisible(false)}
        body={
          <ScrollView contentContainerStyle={styles.modalBody}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {departments.map((d) => (
                <Pressable
                  key={d.id}
                  onPress={() => void onSelectDept(d.id)}
                  style={[styles.chip, donateDeptId === d.id && styles.chipActive]}>
                  <Text style={[styles.chipText, donateDeptId === d.id && styles.chipTextActive]}>
                    {d.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            {products.map((p) => (
              <View key={p.id} style={styles.qtyRow}>
                <Text style={styles.qtyName}>{p.name}</Text>
                <TextInput
                  style={styles.qtyInput}
                  keyboardType="decimal-pad"
                  value={qty[p.id] ?? ''}
                  onChangeText={(v) => setQty((prev) => ({ ...prev, [p.id]: v }))}
                />
              </View>
            ))}
            {donateStatus ? <Text style={styles.error}>{donateStatus}</Text> : null}
          </ScrollView>
        }
        footer={
          <View style={styles.footer}>
            <Pressable
              style={[styles.primaryBtn, donateBusy && styles.disabled]}
              disabled={donateBusy}
              onPress={() => void submitDonation()}>
              <Text style={styles.primaryBtnText}>{donateBusy ? '…' : 'Valider'}</Text>
            </Pressable>
          </View>
        }>
        <View style={styles.modalTop}>
          <Text style={styles.modalTopTitle}>Don</Text>
          <Pressable onPress={() => setDonateVisible(false)} hitSlop={12}>
            <Text style={styles.modalClose}>Fermer</Text>
          </Pressable>
        </View>
      </ModalShell>
    </Screen>
  );
}

const styles = StyleSheet.create({
  blocked: { flex: 1, justifyContent: 'center', padding: Spacing.five },
  blockedText: { textAlign: 'center', color: BrandColors.textMuted },
  body: { padding: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.six },
  kpiRow: { flexDirection: 'row', gap: Spacing.two },
  searchRow: { flexDirection: 'row', gap: Spacing.two },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    fontSize: 16,
    color: BrandColors.text,
    backgroundColor: BrandColors.surface,
  },
  searchBtn: {
    backgroundColor: BrandColors.primary,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
  },
  searchBtnText: { color: '#fff', fontWeight: '700' },
  primaryBtn: {
    backgroundColor: BrandColors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.55 },
  row: {
    backgroundColor: BrandColors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: Spacing.three,
    gap: 4,
  },
  rowName: { fontWeight: '700', color: BrandColors.text, fontSize: 16 },
  meta: { color: BrandColors.textMuted },
  error: { color: BrandColors.danger, fontWeight: '600' },
  modalBody: { padding: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.six },
  historyCard: {
    borderWidth: 1,
    borderColor: BrandColors.border,
    borderRadius: 12,
    padding: Spacing.three,
    gap: 4,
    backgroundColor: BrandColors.surface,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    marginRight: Spacing.two,
  },
  chipActive: { backgroundColor: BrandColors.primary, borderColor: BrandColors.primary },
  chipText: { fontWeight: '600', color: BrandColors.text },
  chipTextActive: { color: '#fff' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  qtyName: { flex: 1, color: BrandColors.text, fontWeight: '600' },
  qtyInput: {
    width: 90,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 8,
    paddingHorizontal: Spacing.two,
    paddingVertical: 8,
    color: BrandColors.text,
    backgroundColor: BrandColors.surface,
    textAlign: 'right',
  },
  footer: { padding: Spacing.three, gap: Spacing.two },
  secondaryBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
  },
  secondaryBtnText: { fontWeight: '700', color: BrandColors.text },
  modalTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  modalTopTitle: { fontSize: 18, fontWeight: '700', color: BrandColors.text },
  modalClose: { color: BrandColors.primary, fontWeight: '600' },
});
