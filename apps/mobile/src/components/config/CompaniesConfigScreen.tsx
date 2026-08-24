import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ModalShell } from '@/components/ModalShell';
import { Screen } from '@/components/Screen';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import {
  createCompany,
  createDepartment,
  deleteCompany,
  deleteDepartment,
  getCompanies,
  getDepartments,
  updateCompany,
  updateDepartment,
} from '@/services/api';
import type { CompanyListItem, Department } from '@/types/api';

export function CompaniesConfigScreen() {
  const { can, canPerm } = useAuth();
  const canCreate = can(['ADMIN']) || canPerm('company.manage');
  const canEdit =
    can(['ADMIN', 'MANAGER']) || canPerm('company.manage') || canPerm('config.manage');
  const canDelete = can(['ADMIN']) || canPerm('company.manage');
  const allowed = canEdit || canPerm('config.view');

  const [rows, setRows] = useState<CompanyListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const [modal, setModal] = useState<'create' | 'edit' | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [depts, setDepts] = useState<Department[]>([]);
  const [newDept, setNewDept] = useState('');
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const load = useCallback(async () => {
    if (!allowed) return;
    try {
      setError(null);
      setRows(await getCompanies());
    } catch {
      setError('Impossible de charger les entreprises');
    }
  }, [allowed]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  function openCreate() {
    setEditId(null);
    setName('');
    setAddress('');
    setCity('');
    setPhone('');
    setDepts([]);
    setNewDept('');
    setStatus(null);
    setModal('create');
  }

  async function openEdit(row: CompanyListItem) {
    setEditId(row.id);
    setName(row.name);
    setAddress(row.address ?? '');
    setCity(row.city ?? '');
    setPhone(row.phone ?? '');
    setNewDept('');
    setStatus(null);
    setModal('edit');
    try {
      setDepts(await getDepartments(row.id));
    } catch {
      setDepts([]);
    }
  }

  async function submitCompany() {
    if (!name.trim()) {
      setStatus('Raison sociale requise');
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const payload = {
        name: name.trim(),
        address: address.trim() || undefined,
        city: city.trim() || undefined,
        phone: phone.trim() || undefined,
        currency: 'HTG',
      };
      if (modal === 'create') {
        const created = await createCompany(payload);
        setEditId(created.id);
        setModal('edit');
        setStatus('Entreprise créée — ajoutez des départements');
        setDepts(await getDepartments(created.id));
      } else if (editId != null) {
        await updateCompany(editId, payload);
        setStatus('Entreprise enregistrée');
      }
      await load();
    } catch {
      setStatus(modal === 'create' ? 'Création impossible' : 'Enregistrement impossible');
    } finally {
      setBusy(false);
    }
  }

  async function addDepartment() {
    if (editId == null || !newDept.trim()) return;
    setBusy(true);
    try {
      await createDepartment({ companyId: editId, name: newDept.trim() });
      setNewDept('');
      setDepts(await getDepartments(editId));
      await load();
    } catch {
      setStatus('Création département impossible');
    } finally {
      setBusy(false);
    }
  }

  function startRename(d: Department) {
    setRenamingId(d.id);
    setRenameValue(d.name);
  }

  async function commitRename() {
    if (renamingId == null || editId == null || !renameValue.trim()) return;
    setBusy(true);
    try {
      await updateDepartment(renamingId, { name: renameValue.trim() });
      setRenamingId(null);
      setDepts(await getDepartments(editId));
    } catch {
      setStatus('Renommage impossible');
    } finally {
      setBusy(false);
    }
  }

  function confirmDeleteDept(d: Department) {
    if (editId == null) return;
    Alert.alert('Supprimer', `Supprimer le département « ${d.name} » ?`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () => {
          void deleteDepartment(d.id)
            .then(async () => {
              setDepts(await getDepartments(editId));
              await load();
            })
            .catch(() => setStatus('Suppression département impossible'));
        },
      },
    ]);
  }

  function confirmDeleteCompany(row: CompanyListItem) {
    Alert.alert('Supprimer', `Supprimer « ${row.name} » ?`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () => {
          void deleteCompany(row.id)
            .then(async () => {
              setStatus('Entreprise supprimée');
              await load();
            })
            .catch(() => setStatus('Suppression impossible'));
        },
      },
    ]);
  }

  if (!allowed) {
    return (
      <Screen>
        <View style={styles.blocked}>
          <Text style={styles.blockedText}>Configuration entreprise réservée à la gestion.</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen keyboard={modal != null}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {status && modal == null ? <Text style={styles.status}>{status}</Text> : null}

      <FlatList
        data={rows}
        keyExtractor={(r) => String(r.id)}
        contentContainerStyle={styles.list}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          void load().finally(() => setRefreshing(false));
        }}
        ListHeaderComponent={
          canCreate ? (
            <Pressable style={styles.primaryBtn} onPress={openCreate}>
              <Text style={styles.primaryBtnText}>+ Entreprise</Text>
            </Pressable>
          ) : null
        }
        ListEmptyComponent={<Text style={styles.empty}>Aucune entreprise</Text>}
        renderItem={({ item: row }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{row.name}</Text>
            <Text style={styles.meta}>
              {row.city || '—'} · {row._count?.departments ?? 0} dépt · {row._count?.products ?? 0}{' '}
              prod.
            </Text>
            <View style={styles.rowActions}>
              {canEdit ? (
                <Pressable onPress={() => void openEdit(row)}>
                  <Text style={styles.link}>Modifier</Text>
                </Pressable>
              ) : null}
              {canDelete ? (
                <Pressable onPress={() => confirmDeleteCompany(row)}>
                  <Text style={styles.danger}>Supprimer</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        )}
      />

      <ModalShell
        visible={modal != null}
        onRequestClose={() => setModal(null)}
        body={
          <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
            {status ? <Text style={styles.status}>{status}</Text> : null}
            <TextInput
              style={styles.input}
              placeholder="Raison sociale *"
              placeholderTextColor={BrandColors.textMuted}
              value={name}
              onChangeText={setName}
            />
            <TextInput
              style={styles.input}
              placeholder="Adresse"
              placeholderTextColor={BrandColors.textMuted}
              value={address}
              onChangeText={setAddress}
            />
            <TextInput
              style={styles.input}
              placeholder="Ville"
              placeholderTextColor={BrandColors.textMuted}
              value={city}
              onChangeText={setCity}
            />
            <TextInput
              style={styles.input}
              placeholder="Téléphone"
              placeholderTextColor={BrandColors.textMuted}
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
            />

            {editId != null ? (
              <>
                <Text style={styles.section}>Départements</Text>
                {depts.map((d) => (
                  <View key={d.id} style={styles.deptRow}>
                    {renamingId === d.id ? (
                      <>
                        <TextInput
                          style={[styles.input, styles.flex]}
                          value={renameValue}
                          onChangeText={setRenameValue}
                        />
                        <Pressable onPress={() => void commitRename()}>
                          <Text style={styles.link}>OK</Text>
                        </Pressable>
                      </>
                    ) : (
                      <>
                        <Text style={styles.flex}>{d.name}</Text>
                        <Pressable onPress={() => startRename(d)}>
                          <Text style={styles.link}>Renommer</Text>
                        </Pressable>
                        {canDelete ? (
                          <Pressable onPress={() => confirmDeleteDept(d)}>
                            <Text style={styles.danger}>×</Text>
                          </Pressable>
                        ) : null}
                      </>
                    )}
                  </View>
                ))}
                {canEdit ? (
                  <View style={styles.deptRow}>
                    <TextInput
                      style={[styles.input, styles.flex]}
                      placeholder="Nouveau département"
                      placeholderTextColor={BrandColors.textMuted}
                      value={newDept}
                      onChangeText={setNewDept}
                    />
                    <Pressable onPress={() => void addDepartment()} disabled={busy}>
                      <Text style={styles.link}>Ajouter</Text>
                    </Pressable>
                  </View>
                ) : null}
              </>
            ) : null}
          </ScrollView>
        }
        footer={
          <View style={styles.footer}>
            <Pressable
              style={[styles.primaryBtn, busy && styles.disabled]}
              disabled={busy}
              onPress={() => void submitCompany()}>
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>
                  {modal === 'create' ? 'Créer' : 'Enregistrer'}
                </Text>
              )}
            </Pressable>
          </View>
        }>
        <View style={styles.modalTop}>
          <Text style={styles.modalTopTitle}>
            {modal === 'create' ? 'Nouvelle entreprise' : 'Modifier'}
          </Text>
          <Pressable onPress={() => setModal(null)} hitSlop={12}>
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
  error: { color: BrandColors.danger, fontWeight: '600', paddingHorizontal: Spacing.three, marginTop: 8 },
  status: { color: BrandColors.primaryHover, fontWeight: '600', paddingHorizontal: Spacing.three, marginTop: 8 },
  list: { padding: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.six },
  empty: { textAlign: 'center', color: BrandColors.textMuted, marginTop: Spacing.four },
  card: {
    backgroundColor: BrandColors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: Spacing.three,
    gap: 4,
    marginBottom: Spacing.two,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: BrandColors.text },
  meta: { fontSize: 12, color: BrandColors.textMuted },
  rowActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  link: { color: BrandColors.primary, fontWeight: '700' },
  danger: { color: BrandColors.danger, fontWeight: '600' },
  primaryBtn: {
    backgroundColor: BrandColors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: Spacing.two,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.55 },
  modalTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  modalTopTitle: { fontSize: 18, fontWeight: '700', color: BrandColors.text },
  modalClose: { color: BrandColors.primary, fontWeight: '600' },
  modalBody: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.four, gap: Spacing.two },
  footer: { padding: Spacing.three, backgroundColor: BrandColors.bg },
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
  section: { fontWeight: '700', color: BrandColors.text, marginTop: Spacing.two },
  deptRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1 },
});
