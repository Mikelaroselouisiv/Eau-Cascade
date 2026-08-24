import { useCallback, useEffect, useState } from 'react';
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
  createRole,
  deleteRole,
  listPermissions,
  listRoles,
  updateRole,
} from '@/services/api';
import type { AppRoleRow, PermissionDefinition } from '@/types/api';
import { PERMISSION_GROUPS } from '@/utils/permissionGroups';

export function RolesConfigScreen() {
  const { can, canPerm } = useAuth();
  const allowed = can(['ADMIN']) || canPerm('roles.manage');

  const [roles, setRoles] = useState<AppRoleRow[]>([]);
  const [permissions, setPermissions] = useState<PermissionDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const [edit, setEdit] = useState<AppRoleRow | null>(null);
  const [editPerms, setEditPerms] = useState<string[]>([]);
  const [editLabel, setEditLabel] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPerms, setNewPerms] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!allowed) return;
    try {
      setError(null);
      setRoles((await listRoles()).filter((r) => r.isActive));
    } catch {
      setError('Impossible de charger les rôles');
    }
  }, [allowed]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    if (!allowed) return;
    void listPermissions()
      .then(setPermissions)
      .catch(() => setPermissions([]));
  }, [allowed]);

  function togglePerm(list: string[], code: string, setList: (v: string[]) => void) {
    if (code === '*') {
      setList(list.includes('*') ? [] : ['*']);
      return;
    }
    if (list.includes('*')) {
      setList(list.filter((p) => p !== '*'));
      return;
    }
    if (list.includes(code)) setList(list.filter((p) => p !== code));
    else setList([...list, code]);
  }

  function toggleGroup(list: string[], codes: string[], setList: (v: string[]) => void) {
    if (list.includes('*')) return;
    const usable = codes.filter((c) => c !== '*');
    const allOn = usable.length > 0 && usable.every((c) => list.includes(c));
    if (allOn) setList(list.filter((p) => !usable.includes(p)));
    else setList([...new Set([...list.filter((p) => p !== '*'), ...usable])]);
  }

  function groupedPermissions() {
    const byCode = new Map(permissions.map((p) => [p.code, p]));
    const used = new Set<string>();
    const sections: Array<{ id: string; label: string; items: PermissionDefinition[] }> = [];
    for (const group of PERMISSION_GROUPS) {
      const items = group.codes
        .map((code) => byCode.get(code))
        .filter((p): p is PermissionDefinition => !!p);
      for (const item of items) used.add(item.code);
      if (items.length) sections.push({ id: group.id, label: group.label, items });
    }
    const orphan = permissions.filter((p) => !used.has(p.code));
    if (orphan.length) sections.push({ id: 'other', label: 'Autres', items: orphan });
    return sections;
  }

  function renderPermissionPicker(list: string[], setList: (v: string[]) => void) {
    const hasStar = list.includes('*');
    return (
      <>
        <Pressable
          style={styles.toggle}
          onPress={() => setList(hasStar ? [] : ['*'])}>
          <Text style={styles.toggleText}>
            {hasStar ? '✓ Accès total (*)' : 'Accès total (*)'}
          </Text>
        </Pressable>
        {!hasStar
          ? groupedPermissions().map((section) => {
              const codes = section.items.map((p) => p.code).filter((c) => c !== '*');
              const allOn = codes.length > 0 && codes.every((c) => list.includes(c));
              return (
                <View key={section.id} style={styles.groupBlock}>
                  <View style={styles.groupHead}>
                    <Text style={styles.groupTitle}>{section.label}</Text>
                    {codes.length > 0 ? (
                      <Pressable onPress={() => toggleGroup(list, codes, setList)}>
                        <Text style={styles.groupToggle}>
                          {allOn ? '✓ Tout le groupe' : 'Tout le groupe'}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {section.items.map((p) => (
                    <Pressable
                      key={p.code}
                      style={styles.permRow}
                      onPress={() => togglePerm(list, p.code, setList)}>
                      <Text style={styles.permCheck}>{list.includes(p.code) ? '✓' : '○'}</Text>
                      <View style={styles.flex}>
                        <Text style={styles.permLabel}>{p.label}</Text>
                        <Text style={styles.meta}>{p.code}</Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              );
            })
          : null}
      </>
    );
  }

  async function saveEdit() {
    if (!edit) return;
    setBusy(true);
    try {
      await updateRole(edit.id, {
        label: editLabel.trim() || edit.label,
        permissions: editPerms,
      });
      setEdit(null);
      setStatus('Rôle mis à jour');
      await load();
    } catch {
      setStatus('Enregistrement impossible');
    } finally {
      setBusy(false);
    }
  }

  async function submitCreate() {
    if (!newCode.trim() || !newLabel.trim() || newPerms.length === 0) {
      setStatus('Code, libellé et au moins une autorisation');
      return;
    }
    setBusy(true);
    try {
      await createRole({
        code: newCode.trim().toUpperCase(),
        label: newLabel.trim(),
        description: newDesc.trim() || undefined,
        permissions: newPerms,
      });
      setShowCreate(false);
      setNewCode('');
      setNewLabel('');
      setNewDesc('');
      setNewPerms([]);
      setStatus('Rôle créé');
      await load();
    } catch {
      setStatus('Création impossible');
    } finally {
      setBusy(false);
    }
  }

  if (!allowed) {
    return (
      <Screen>
        <View style={styles.blocked}>
          <Text style={styles.blockedText}>Rôles réservés aux administrateurs.</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen keyboard={showCreate || edit != null}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {status && !showCreate && !edit ? <Text style={styles.status}>{status}</Text> : null}

      <FlatList
        data={roles}
        keyExtractor={(r) => String(r.id)}
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
            <Text style={styles.primaryBtnText}>+ Rôle</Text>
          </Pressable>
        }
        ListEmptyComponent={<Text style={styles.empty}>Aucun rôle</Text>}
        renderItem={({ item: r }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {r.label}
              {r.isSystem ? ' · système' : ''}
            </Text>
            <Text style={styles.meta}>
              {r.code} · {r.permissions.includes('*') ? 'Tout' : `${r.permissions.length} droit(s)`}
            </Text>
            <View style={styles.rowActions}>
              <Pressable
                onPress={() => {
                  setEdit(r);
                  setEditPerms([...r.permissions]);
                  setEditLabel(r.label);
                  setStatus(null);
                }}>
                <Text style={styles.link}>Modifier</Text>
              </Pressable>
              {!r.isSystem ? (
                <Pressable
                  onPress={() => {
                    Alert.alert('Supprimer', `Supprimer « ${r.label} » ?`, [
                      { text: 'Annuler', style: 'cancel' },
                      {
                        text: 'Supprimer',
                        style: 'destructive',
                        onPress: () => {
                          void deleteRole(r.id)
                            .then(async () => {
                              setStatus('Rôle supprimé');
                              await load();
                            })
                            .catch(() => setStatus('Suppression impossible'));
                        },
                      },
                    ]);
                  }}>
                  <Text style={styles.danger}>Supprimer</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        )}
      />

      <ModalShell
        visible={edit != null}
        onRequestClose={() => setEdit(null)}
        body={
          <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
            <TextInput
              style={styles.input}
              placeholder="Libellé"
              placeholderTextColor={BrandColors.textMuted}
              value={editLabel}
              onChangeText={setEditLabel}
            />
            {renderPermissionPicker(editPerms, setEditPerms)}
          </ScrollView>
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
          <Text style={styles.modalTopTitle}>Modifier rôle</Text>
          <Pressable onPress={() => setEdit(null)} hitSlop={12}>
            <Text style={styles.modalClose}>Fermer</Text>
          </Pressable>
        </View>
      </ModalShell>

      <ModalShell
        visible={showCreate}
        onRequestClose={() => setShowCreate(false)}
        body={
          <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
            {status ? <Text style={styles.statusIn}>{status}</Text> : null}
            <TextInput
              style={styles.input}
              placeholder="Code (ex. SUPERVISEUR)"
              placeholderTextColor={BrandColors.textMuted}
              autoCapitalize="characters"
              value={newCode}
              onChangeText={setNewCode}
            />
            <TextInput
              style={styles.input}
              placeholder="Libellé *"
              placeholderTextColor={BrandColors.textMuted}
              value={newLabel}
              onChangeText={setNewLabel}
            />
            <TextInput
              style={styles.input}
              placeholder="Description"
              placeholderTextColor={BrandColors.textMuted}
              value={newDesc}
              onChangeText={setNewDesc}
            />
            {renderPermissionPicker(newPerms, setNewPerms)}
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
          <Text style={styles.modalTopTitle}>Nouveau rôle</Text>
          <Pressable onPress={() => setShowCreate(false)} hitSlop={12}>
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
  statusIn: { color: BrandColors.primaryHover, fontWeight: '600' },
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
  rowActions: { flexDirection: 'row', gap: 16, marginTop: 6 },
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
  toggle: { paddingVertical: 8 },
  toggleText: { fontWeight: '700', color: BrandColors.text },
  groupBlock: {
    borderWidth: 1,
    borderColor: BrandColors.border,
    borderRadius: 12,
    padding: Spacing.two,
    gap: 4,
    backgroundColor: BrandColors.surface,
  },
  groupHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  groupTitle: { fontWeight: '800', color: BrandColors.text, fontSize: 14 },
  groupToggle: { color: BrandColors.primary, fontWeight: '700', fontSize: 12 },
  permRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 6 },
  permCheck: { width: 22, fontWeight: '700', color: BrandColors.primary, fontSize: 16 },
  permLabel: { fontWeight: '600', color: BrandColors.text },
  flex: { flex: 1 },
});
