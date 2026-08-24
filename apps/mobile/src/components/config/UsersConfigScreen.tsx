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
  createUser,
  deleteUser,
  getDepartments,
  getUsers,
  listRoles,
  updateUser,
} from '@/services/api';
import type { AppRoleRow, Department, SessionUser } from '@/types/api';
import { formatRoleLabel } from '@/utils/roleLabels';

export function UsersConfigScreen() {
  const { can, canPerm } = useAuth();
  const allowed = can(['ADMIN']) || canPerm('users.manage');

  const [users, setUsers] = useState<SessionUser[]>([]);
  const [roles, setRoles] = useState<AppRoleRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('CASHIER');
  const [deptId, setDeptId] = useState<number | ''>('');

  const [edit, setEdit] = useState<SessionUser | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editRole, setEditRole] = useState('CASHIER');
  const [editDeptId, setEditDeptId] = useState<number | ''>('');
  const [editPassword, setEditPassword] = useState('');

  const load = useCallback(async () => {
    if (!allowed) return;
    try {
      setError(null);
      const [u, r, d] = await Promise.all([
        getUsers(),
        listRoles().catch(() => [] as AppRoleRow[]),
        getDepartments(),
      ]);
      setUsers(u);
      setRoles(r.filter((x) => x.isActive));
      setDepartments(d);
    } catch {
      setError('Impossible de charger les utilisateurs');
    }
  }, [allowed]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  function roleLabel(code: string) {
    return formatRoleLabel(code, roles.find((r) => r.code === code)?.label);
  }

  function deptLabel(id: number | null | undefined) {
    if (id == null) return '—';
    return departments.find((d) => d.id === id)?.name ?? `#${id}`;
  }

  async function submitCreate() {
    if (role !== 'ADMIN' && deptId === '') {
      setStatus('Département requis (sauf ADMIN)');
      return;
    }
    if (password !== passwordConfirm) {
      setStatus('Mots de passe différents');
      return;
    }
    if (password.length < 6) {
      setStatus('Mot de passe trop court (min. 6)');
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      await createUser({
        phone: phone.trim(),
        password,
        role,
        fullName: fullName.trim() || undefined,
        departmentId: role === 'ADMIN' ? undefined : Number(deptId),
      });
      setShowCreate(false);
      setPhone('');
      setPassword('');
      setPasswordConfirm('');
      setFullName('');
      setRole('CASHIER');
      setDeptId('');
      setStatus('Utilisateur créé');
      await load();
    } catch {
      setStatus('Création impossible');
    } finally {
      setBusy(false);
    }
  }

  function openEdit(u: SessionUser) {
    setEdit(u);
    setEditName(u.fullName ?? '');
    setEditPhone(u.phone);
    setEditRole(u.role);
    setEditDeptId(u.departmentId ?? '');
    setEditPassword('');
    setStatus(null);
  }

  async function submitEdit() {
    if (!edit) return;
    if (editRole !== 'ADMIN' && editDeptId === '') {
      setStatus('Département requis (sauf ADMIN)');
      return;
    }
    setBusy(true);
    try {
      await updateUser(edit.id, {
        phone: editPhone.trim(),
        fullName: editName.trim(),
        role: editRole,
        departmentId: editRole === 'ADMIN' ? null : Number(editDeptId),
        ...(editPassword.trim() ? { password: editPassword.trim() } : {}),
      });
      setEdit(null);
      setStatus('Utilisateur mis à jour');
      await load();
    } catch {
      setStatus('Mise à jour impossible');
    } finally {
      setBusy(false);
    }
  }

  if (!allowed) {
    return (
      <Screen>
        <View style={styles.blocked}>
          <Text style={styles.blockedText}>Utilisateurs réservés aux administrateurs.</Text>
        </View>
      </Screen>
    );
  }

  const roleOptions = roles.length
    ? roles.map((r) => r.code)
    : ['ADMIN', 'MANAGER', 'CASHIER', 'STOCK_MANAGER', 'ACCOUNTANT', 'LIVREUR'];

  return (
    <Screen keyboard={showCreate || edit != null}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {status && !showCreate && !edit ? <Text style={styles.status}>{status}</Text> : null}

      <FlatList
        data={users}
        keyExtractor={(u) => String(u.id)}
        contentContainerStyle={styles.list}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          void load().finally(() => setRefreshing(false));
        }}
        ListHeaderComponent={
          <Pressable
            style={styles.primaryBtn}
            onPress={() => {
              setStatus(null);
              setShowCreate(true);
            }}>
            <Text style={styles.primaryBtnText}>+ Utilisateur</Text>
          </Pressable>
        }
        ListEmptyComponent={<Text style={styles.empty}>Aucun utilisateur</Text>}
        renderItem={({ item: u }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{u.fullName?.trim() || u.phone}</Text>
            <Text style={styles.meta}>
              {u.phone} · {roleLabel(u.role)} · {deptLabel(u.departmentId)}
            </Text>
            <Text style={styles.meta}>{u.isActive === false ? 'Inactif' : 'Actif'}</Text>
            <View style={styles.rowActions}>
              <Pressable
                onPress={() => {
                  void updateUser(u.id, { isActive: !(u.isActive !== false) }).then(() => load());
                }}>
                <Text style={styles.link}>{u.isActive === false ? 'Activer' : 'Désactiver'}</Text>
              </Pressable>
              <Pressable onPress={() => openEdit(u)}>
                <Text style={styles.link}>Modifier</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  Alert.alert('Supprimer', 'Supprimer cet utilisateur ?', [
                    { text: 'Annuler', style: 'cancel' },
                    {
                      text: 'Supprimer',
                      style: 'destructive',
                      onPress: () => {
                        void deleteUser(u.id)
                          .then(async () => {
                            setStatus('Utilisateur supprimé');
                            await load();
                          })
                          .catch(() => setStatus('Suppression impossible'));
                      },
                    },
                  ]);
                }}>
                <Text style={styles.danger}>Supprimer</Text>
              </Pressable>
            </View>
          </View>
        )}
      />

      <ModalShell
        visible={showCreate}
        onRequestClose={() => setShowCreate(false)}
        body={
          <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
            {status ? <Text style={styles.status}>{status}</Text> : null}
            <TextInput
              style={styles.input}
              placeholder="Téléphone *"
              placeholderTextColor={BrandColors.textMuted}
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
            />
            <TextInput
              style={styles.input}
              placeholder="Nom affiché"
              placeholderTextColor={BrandColors.textMuted}
              value={fullName}
              onChangeText={setFullName}
            />
            <TextInput
              style={styles.input}
              placeholder="Mot de passe *"
              placeholderTextColor={BrandColors.textMuted}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
            <TextInput
              style={styles.input}
              placeholder="Confirmer mot de passe *"
              placeholderTextColor={BrandColors.textMuted}
              secureTextEntry
              value={passwordConfirm}
              onChangeText={setPasswordConfirm}
            />
            <Text style={styles.fieldLabel}>Rôle</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
              {roleOptions.map((code) => (
                <Chip
                  key={code}
                  label={roleLabel(code)}
                  active={role === code}
                  onPress={() => setRole(code)}
                />
              ))}
            </ScrollView>
            {role !== 'ADMIN' ? (
              <>
                <Text style={styles.fieldLabel}>Département</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
                  {departments.map((d) => (
                    <Chip
                      key={d.id}
                      label={d.name}
                      active={deptId === d.id}
                      onPress={() => setDeptId(d.id)}
                    />
                  ))}
                </ScrollView>
              </>
            ) : null}
          </ScrollView>
        }
        footer={
          <View style={styles.footer}>
            <Pressable
              style={[styles.primaryBtn, busy && styles.disabled]}
              disabled={busy}
              onPress={() => void submitCreate()}>
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Créer</Text>
              )}
            </Pressable>
          </View>
        }>
        <View style={styles.modalTop}>
          <Text style={styles.modalTopTitle}>Nouvel utilisateur</Text>
          <Pressable onPress={() => setShowCreate(false)} hitSlop={12}>
            <Text style={styles.modalClose}>Fermer</Text>
          </Pressable>
        </View>
      </ModalShell>

      <ModalShell
        visible={edit != null}
        onRequestClose={() => setEdit(null)}
        body={
          <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
            {status ? <Text style={styles.status}>{status}</Text> : null}
            <TextInput
              style={styles.input}
              placeholder="Téléphone"
              placeholderTextColor={BrandColors.textMuted}
              keyboardType="phone-pad"
              value={editPhone}
              onChangeText={setEditPhone}
            />
            <TextInput
              style={styles.input}
              placeholder="Nom affiché"
              placeholderTextColor={BrandColors.textMuted}
              value={editName}
              onChangeText={setEditName}
            />
            <TextInput
              style={styles.input}
              placeholder="Nouveau mot de passe (optionnel)"
              placeholderTextColor={BrandColors.textMuted}
              secureTextEntry
              value={editPassword}
              onChangeText={setEditPassword}
            />
            <Text style={styles.fieldLabel}>Rôle</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
              {roleOptions.map((code) => (
                <Chip
                  key={code}
                  label={roleLabel(code)}
                  active={editRole === code}
                  onPress={() => setEditRole(code)}
                />
              ))}
            </ScrollView>
            {editRole !== 'ADMIN' ? (
              <>
                <Text style={styles.fieldLabel}>Département</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
                  {departments.map((d) => (
                    <Chip
                      key={d.id}
                      label={d.name}
                      active={editDeptId === d.id}
                      onPress={() => setEditDeptId(d.id)}
                    />
                  ))}
                </ScrollView>
              </>
            ) : null}
          </ScrollView>
        }
        footer={
          <View style={styles.footer}>
            <Pressable
              style={[styles.primaryBtn, busy && styles.disabled]}
              disabled={busy}
              onPress={() => void submitEdit()}>
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
  empty: { textAlign: 'center', color: BrandColors.textMuted, marginTop: Spacing.four },
  card: {
    backgroundColor: BrandColors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: Spacing.three,
    marginBottom: Spacing.two,
    gap: 4,
  },
  cardTitle: { fontWeight: '700', color: BrandColors.text, fontSize: 16 },
  meta: { fontSize: 12, color: BrandColors.textMuted },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 6 },
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
  fieldLabel: { fontWeight: '600', color: BrandColors.textMuted, fontSize: 13 },
  chips: { flexGrow: 0 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    marginRight: 8,
    backgroundColor: BrandColors.surface,
    maxWidth: 160,
  },
  chipActive: { backgroundColor: BrandColors.primary, borderColor: BrandColors.primary },
  chipText: { fontWeight: '600', color: BrandColors.text, fontSize: 13 },
  chipTextActive: { color: '#fff' },
});
