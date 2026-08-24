import { useCallback, useEffect, useMemo, useState } from 'react';
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
  createPackagingUnit,
  deletePackagingUnit,
  getCompanies,
  getDepartments,
  getPackagingUnits,
  updatePackagingUnit,
} from '@/services/api';
import type { CompanyListItem, Department, PackagingUnit } from '@/types/api';

export function PackagingConfigScreen() {
  const { can, canPerm } = useAuth();
  const allowed =
    can(['ADMIN', 'MANAGER', 'STOCK_MANAGER']) || canPerm('packaging.manage');

  const [companies, setCompanies] = useState<CompanyListItem[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [companyId, setCompanyId] = useState<number | ''>('');
  const [departmentId, setDepartmentId] = useState<number | ''>('');
  const [items, setItems] = useState<PackagingUnit[]>([]);
  const [code, setCode] = useState('UNITE');
  const [label, setLabel] = useState('Unité');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<PackagingUnit | null>(null);
  const [editCode, setEditCode] = useState('');
  const [editLabel, setEditLabel] = useState('');

  const deptsForCompany = useMemo(
    () => (companyId === '' ? [] : departments.filter((d) => d.companyId === companyId)),
    [departments, companyId],
  );

  const loadMeta = useCallback(async () => {
    if (!allowed) return;
    try {
      setError(null);
      const [co, d] = await Promise.all([getCompanies(), getDepartments()]);
      setCompanies(co);
      setDepartments(d);
      setCompanyId((prev) => (prev !== '' && co.some((c) => c.id === prev) ? prev : (co[0]?.id ?? '')));
    } catch {
      setError('Impossible de charger entreprises / départements');
    }
  }, [allowed]);

  useFocusEffect(
    useCallback(() => {
      void loadMeta();
    }, [loadMeta]),
  );

  useEffect(() => {
    if (deptsForCompany.length === 0) {
      setDepartmentId('');
      return;
    }
    setDepartmentId((prev) =>
      prev !== '' && deptsForCompany.some((d) => d.id === prev) ? prev : deptsForCompany[0].id,
    );
  }, [deptsForCompany]);

  const loadUnits = useCallback(async () => {
    if (departmentId === '') {
      setItems([]);
      return;
    }
    try {
      setItems(await getPackagingUnits(departmentId));
    } catch {
      setItems([]);
    }
  }, [departmentId]);

  useEffect(() => {
    void loadUnits();
  }, [loadUnits]);

  async function add() {
    if (departmentId === '') {
      setStatus('Choisissez un département');
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      await createPackagingUnit({
        departmentId,
        code: code.trim().toUpperCase(),
        label: label.trim(),
      });
      setCode('');
      setLabel('');
      await loadUnits();
      setStatus('Conditionnement ajouté');
    } catch {
      setStatus('Code déjà utilisé ou invalide (MAJUSCULES_UNDERSCORES)');
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!edit) return;
    setBusy(true);
    try {
      await updatePackagingUnit(edit.id, {
        code: editCode.trim().toUpperCase(),
        label: editLabel.trim(),
      });
      setEdit(null);
      await loadUnits();
      setStatus('Conditionnement mis à jour');
    } catch {
      setStatus('Mise à jour impossible');
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete(u: PackagingUnit) {
    Alert.alert('Supprimer', `Supprimer « ${u.label} » (${u.code}) ?`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () => {
          void deletePackagingUnit(u.id)
            .then(async () => {
              await loadUnits();
              setStatus('Supprimé');
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
          <Text style={styles.blockedText}>Conditionnement réservé à la gestion.</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen keyboard={edit != null}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {status ? <Text style={styles.status}>{status}</Text> : null}

      <FlatList
        data={items}
        keyExtractor={(u) => String(u.id)}
        contentContainerStyle={styles.list}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          void loadMeta()
            .then(() => loadUnits())
            .finally(() => setRefreshing(false));
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
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
              {deptsForCompany.map((d) => (
                <Chip
                  key={d.id}
                  label={d.name}
                  active={departmentId === d.id}
                  onPress={() => setDepartmentId(d.id)}
                />
              ))}
            </ScrollView>
            <Text style={styles.section}>Nouveau</Text>
            <TextInput
              style={styles.input}
              placeholder="CODE"
              placeholderTextColor={BrandColors.textMuted}
              autoCapitalize="characters"
              value={code}
              onChangeText={setCode}
            />
            <TextInput
              style={styles.input}
              placeholder="Libellé"
              placeholderTextColor={BrandColors.textMuted}
              value={label}
              onChangeText={setLabel}
            />
            <Pressable
              style={[styles.primaryBtn, busy && styles.disabled]}
              disabled={busy}
              onPress={() => void add()}>
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Ajouter</Text>
              )}
            </Pressable>
            <Text style={styles.section}>{items.length} conditionnement(s)</Text>
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>Aucun conditionnement</Text>}
        renderItem={({ item: u }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {u.code} — {u.label}
            </Text>
            <View style={styles.rowActions}>
              <Pressable
                onPress={() => {
                  setEdit(u);
                  setEditCode(u.code);
                  setEditLabel(u.label);
                }}>
                <Text style={styles.link}>Modifier</Text>
              </Pressable>
              <Pressable onPress={() => confirmDelete(u)}>
                <Text style={styles.danger}>Supprimer</Text>
              </Pressable>
            </View>
          </View>
        )}
      />

      <ModalShell
        visible={edit != null}
        onRequestClose={() => setEdit(null)}
        body={
          <View style={styles.modalBody}>
            <TextInput
              style={styles.input}
              placeholder="CODE"
              placeholderTextColor={BrandColors.textMuted}
              autoCapitalize="characters"
              value={editCode}
              onChangeText={setEditCode}
            />
            <TextInput
              style={styles.input}
              placeholder="Libellé"
              placeholderTextColor={BrandColors.textMuted}
              value={editLabel}
              onChangeText={setEditLabel}
            />
          </View>
        }
        footer={
          <View style={styles.footer}>
            <Pressable
              style={[styles.primaryBtn, busy && styles.disabled]}
              disabled={busy}
              onPress={() => void saveEdit()}>
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Enregistrer</Text>
              )}
            </Pressable>
          </View>
        }>
        <View style={styles.modalTop}>
          <Text style={styles.modalTopTitle}>Modifier</Text>
          <Pressable onPress={() => setEdit(null)} hitSlop={12}>
            <Text style={styles.modalClose}>Fermer</Text>
          </Pressable>
        </View>
      </ModalShell>
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
  section: { fontWeight: '700', color: BrandColors.text },
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
  card: {
    backgroundColor: BrandColors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: Spacing.three,
    marginBottom: Spacing.two,
    gap: 6,
  },
  cardTitle: { fontWeight: '700', color: BrandColors.text },
  rowActions: { flexDirection: 'row', justifyContent: 'space-between' },
  link: { color: BrandColors.primary, fontWeight: '700' },
  danger: { color: BrandColors.danger, fontWeight: '600' },
  primaryBtn: {
    backgroundColor: BrandColors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
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
  modalBody: { paddingHorizontal: Spacing.three, gap: Spacing.two },
  footer: { padding: Spacing.three, backgroundColor: BrandColors.bg },
});
