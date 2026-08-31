import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ChipScroll } from '@/components/ChipScroll';
import { ModalShell } from '@/components/ModalShell';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import {
  createDepartment,
  createRegister,
  deleteDepartment,
  getDepartments,
  getProducts,
  listRegisters,
  updateDepartment,
} from '@/services/api';
import { formatApiError } from '@/services/api-errors';
import type { Department, DepartmentKind, Product, RegisterListItem } from '@/types/api';
import { formatQuantity } from '@/utils/quantity';
import { formatRegisterCode } from '@/utils/registerDisplay';

type Props = {
  companyId: number;
  onChanged?: () => void;
};

const KIND_OPTIONS: { id: DepartmentKind; label: string }[] = [
  { id: 'DISTRIBUTION', label: 'Distribution' },
  { id: 'PRODUCTION_DISTRIBUTION', label: 'Production et distribution' },
];

function kindLabel(kind?: DepartmentKind | null) {
  return kind === 'PRODUCTION_DISTRIBUTION' ? 'Production' : 'Distribution';
}

export function CompanyDepartmentsPanel({ companyId, onChanged }: Props) {
  const { can, canPerm } = useAuth();
  const canEdit = canPerm('departments.manage');
  const canDelete = can(['ADMIN']);

  const [items, setItems] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<DepartmentKind>('DISTRIBUTION');
  const [offersHomeDelivery, setOffersHomeDelivery] = useState(false);

  const [editDept, setEditDept] = useState<Department | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [deptProducts, setDeptProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [registersByDept, setRegistersByDept] = useState<Record<number, RegisterListItem[]>>({});
  const [newRegisterCode, setNewRegisterCode] = useState<Record<number, string>>({});
  const [registerBusyDept, setRegisterBusyDept] = useState<number | null>(null);

  const loadDeptRegisters = useCallback(
    async (deptId: number) => {
      try {
        const regs = await listRegisters({ companyId, departmentId: deptId });
        setRegistersByDept((prev) => ({
          ...prev,
          [deptId]: regs.filter((r) => r.departmentId === deptId),
        }));
      } catch {
        setRegistersByDept((prev) => ({ ...prev, [deptId]: [] }));
      }
    },
    [companyId],
  );

  const loadDepts = useCallback(async () => {
    setLoading(true);
    try {
      const depts = await getDepartments(companyId);
      setItems(depts);
      await Promise.all(depts.map((d) => loadDeptRegisters(d.id)));
    } catch (err) {
      setItems([]);
      setRegistersByDept({});
      setError(formatApiError(err, 'Impossible de charger les départements'));
    } finally {
      setLoading(false);
    }
  }, [companyId, loadDeptRegisters]);

  useEffect(() => {
    void loadDepts();
  }, [loadDepts]);

  function selectKind(next: DepartmentKind, setter: (k: DepartmentKind) => void, setHome: (v: boolean) => void) {
    setter(next);
    if (next !== 'PRODUCTION_DISTRIBUTION') setHome(false);
  }

  async function addDepartment() {
    if (!canEdit) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Nom requis');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createDepartment({
        companyId,
        name: trimmed,
        description: description.trim() || undefined,
        kind,
        offersHomeDelivery: kind === 'PRODUCTION_DISTRIBUTION' ? offersHomeDelivery : false,
      });
      setName('');
      setDescription('');
      setKind('DISTRIBUTION');
      setOffersHomeDelivery(false);
      await loadDepts();
      onChanged?.();
    } catch (err) {
      setError(formatApiError(err, 'Impossible d’ajouter le département'));
    } finally {
      setBusy(false);
    }
  }

  async function toggleProducts(deptId: number) {
    if (expandedId === deptId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(deptId);
    setLoadingProducts(true);
    try {
      setDeptProducts(await getProducts(deptId));
    } catch {
      setDeptProducts([]);
    } finally {
      setLoadingProducts(false);
    }
  }

  async function addRegister(deptId: number) {
    if (!canEdit) return;
    const code = (newRegisterCode[deptId] ?? '').trim();
    if (!code) return;
    setRegisterBusyDept(deptId);
    setError(null);
    try {
      await createRegister({ companyId, departmentId: deptId, code });
      setNewRegisterCode((prev) => ({ ...prev, [deptId]: '' }));
      await loadDeptRegisters(deptId);
    } catch (err) {
      setError(formatApiError(err, 'Impossible de créer la caisse'));
    } finally {
      setRegisterBusyDept(null);
    }
  }

  function confirmDelete(d: Department) {
    Alert.alert('Supprimer', `Supprimer « ${d.name} » ?`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () => {
          void deleteDepartment(d.id)
            .then(async () => {
              await loadDepts();
              onChanged?.();
            })
            .catch((err) => setError(formatApiError(err, 'Suppression impossible')));
        },
      },
    ]);
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.section}>Départements</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {canEdit ? (
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Nom *"
            placeholderTextColor={BrandColors.textMuted}
            value={name}
            onChangeText={setName}
          />
          <TextInput
            style={styles.input}
            placeholder="Description"
            placeholderTextColor={BrandColors.textMuted}
            value={description}
            onChangeText={setDescription}
          />
          <ChipScroll>
            {KIND_OPTIONS.map((opt) => (
              <Pressable
                key={opt.id}
                onPress={() => selectKind(opt.id, setKind, setOffersHomeDelivery)}
                style={[styles.chip, kind === opt.id && styles.chipActive]}>
                <Text style={[styles.chipText, kind === opt.id && styles.chipTextActive]}>{opt.label}</Text>
              </Pressable>
            ))}
          </ChipScroll>
          {kind === 'PRODUCTION_DISTRIBUTION' ? (
            <Pressable onPress={() => setOffersHomeDelivery((v) => !v)} style={styles.checkRow}>
              <Text style={styles.meta}>{offersHomeDelivery ? '☑' : '☐'} Livraisons à domicile</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={[styles.primaryBtn, busy && styles.disabled]}
            disabled={busy}
            onPress={() => void addDepartment()}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Ajouter</Text>}
          </Pressable>
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator color={BrandColors.primary} style={{ marginVertical: 12 }} />
      ) : items.length === 0 ? (
        <Text style={styles.meta}>Aucun département</Text>
      ) : (
        items.map((d) => (
          <View key={d.id} style={styles.card}>
            <Text style={styles.cardTitle}>{d.name}</Text>
            <Text style={styles.meta}>
              {[
                kindLabel(d.kind),
                d.kind === 'PRODUCTION_DISTRIBUTION' && d.offersHomeDelivery ? 'Livraisons à domicile' : null,
                d.description?.trim() || null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            <View style={styles.rowActions}>
              <Pressable onPress={() => void toggleProducts(d.id)}>
                <Text style={styles.link}>{expandedId === d.id ? 'Fermer produits' : 'Produits'}</Text>
              </Pressable>
              {canEdit ? (
                <Pressable onPress={() => setEditDept(d)}>
                  <Text style={styles.link}>Modifier</Text>
                </Pressable>
              ) : null}
              {canDelete ? (
                <Pressable onPress={() => confirmDelete(d)}>
                  <Text style={styles.danger}>Supprimer</Text>
                </Pressable>
              ) : null}
            </View>

            <Text style={styles.bodyTitle}>Caisses</Text>
            {(registersByDept[d.id] ?? []).length === 0 ? (
              <Text style={styles.meta}>Aucune caisse</Text>
            ) : (
              (registersByDept[d.id] ?? []).map((r) => (
                <Text key={r.id} style={styles.meta}>
                  Caisse {formatRegisterCode(r.code)}
                </Text>
              ))
            )}
            {canEdit ? (
              <View style={styles.deptRow}>
                <TextInput
                  style={[styles.input, styles.flex]}
                  placeholder="N° / nom de caisse"
                  placeholderTextColor={BrandColors.textMuted}
                  value={newRegisterCode[d.id] ?? ''}
                  onChangeText={(v) => setNewRegisterCode((prev) => ({ ...prev, [d.id]: v }))}
                />
                <Pressable
                  disabled={registerBusyDept === d.id}
                  onPress={() => void addRegister(d.id)}>
                  <Text style={styles.link}>{registerBusyDept === d.id ? '…' : 'Ajouter'}</Text>
                </Pressable>
              </View>
            ) : null}

            {expandedId === d.id ? (
              <View style={styles.products}>
                <Text style={styles.bodyTitle}>Produits</Text>
                {loadingProducts ? (
                  <ActivityIndicator color={BrandColors.primary} />
                ) : deptProducts.length === 0 ? (
                  <Text style={styles.meta}>Aucun produit</Text>
                ) : (
                  deptProducts.map((p) => (
                    <Text key={p.id} style={styles.meta}>
                      {p.name} · {formatQuantity(Number(p.stock))}
                    </Text>
                  ))
                )}
              </View>
            ) : null}
          </View>
        ))
      )}

      {editDept ? (
        <DepartmentEditModal
          key={editDept.id}
          department={editDept}
          onClose={() => setEditDept(null)}
          onSaved={async () => {
            await loadDepts();
            onChanged?.();
          }}
        />
      ) : null}
    </View>
  );
}

function DepartmentEditModal({
  department,
  onClose,
  onSaved,
}: {
  department: Department;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(department.name);
  const [description, setDescription] = useState(department.description ?? '');
  const [kind, setKind] = useState<DepartmentKind>(department.kind ?? 'DISTRIBUTION');
  const [offersHomeDelivery, setOffersHomeDelivery] = useState(department.offersHomeDelivery === true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) {
      setErr('Nom requis');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await updateDepartment(department.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        kind,
        offersHomeDelivery: kind === 'PRODUCTION_DISTRIBUTION' ? offersHomeDelivery : false,
      });
      await onSaved();
      onClose();
    } catch (e) {
      setErr(formatApiError(e, 'Enregistrement impossible'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell
      visible
      onRequestClose={onClose}
      body={
        <View style={styles.modalBody}>
          {err ? <Text style={styles.error}>{err}</Text> : null}
          <TextInput
            style={styles.input}
            placeholder="Nom *"
            placeholderTextColor={BrandColors.textMuted}
            value={name}
            onChangeText={setName}
          />
          <TextInput
            style={styles.input}
            placeholder="Description"
            placeholderTextColor={BrandColors.textMuted}
            value={description}
            onChangeText={setDescription}
          />
          <ChipScroll>
            {KIND_OPTIONS.map((opt) => (
              <Pressable
                key={opt.id}
                onPress={() => {
                  setKind(opt.id);
                  if (opt.id !== 'PRODUCTION_DISTRIBUTION') setOffersHomeDelivery(false);
                }}
                style={[styles.chip, kind === opt.id && styles.chipActive]}>
                <Text style={[styles.chipText, kind === opt.id && styles.chipTextActive]}>{opt.label}</Text>
              </Pressable>
            ))}
          </ChipScroll>
          {kind === 'PRODUCTION_DISTRIBUTION' ? (
            <Pressable onPress={() => setOffersHomeDelivery((v) => !v)} style={styles.checkRow}>
              <Text style={styles.meta}>{offersHomeDelivery ? '☑' : '☐'} Livraisons à domicile</Text>
            </Pressable>
          ) : null}
        </View>
      }
      footer={
        <View style={styles.footer}>
          <Pressable style={[styles.primaryBtn, saving && styles.disabled]} disabled={saving} onPress={() => void submit()}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Enregistrer</Text>}
          </Pressable>
        </View>
      }>
      <View style={styles.modalTop}>
        <Text style={styles.modalTopTitle}>Modifier le département</Text>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.link}>Fermer</Text>
        </Pressable>
      </View>
    </ModalShell>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two, marginTop: Spacing.two },
  section: { fontWeight: '700', color: BrandColors.text, marginTop: Spacing.two },
  form: { gap: Spacing.two },
  error: { color: BrandColors.danger, fontWeight: '600' },
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
  chip: {
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: BrandColors.surface,
    marginRight: 8,
  },
  chipActive: { backgroundColor: BrandColors.primary, borderColor: BrandColors.primary },
  chipText: { fontWeight: '600', color: BrandColors.text, fontSize: 13 },
  chipTextActive: { color: '#fff' },
  checkRow: { paddingVertical: 4 },
  meta: { fontSize: 12, color: BrandColors.textMuted },
  primaryBtn: {
    backgroundColor: BrandColors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.55 },
  card: {
    backgroundColor: BrandColors.surfaceSoft,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: Spacing.three,
    gap: 6,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: BrandColors.text },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 4 },
  link: { color: BrandColors.primary, fontWeight: '700' },
  danger: { color: BrandColors.danger, fontWeight: '600' },
  bodyTitle: { fontWeight: '700', color: BrandColors.text, marginTop: 8 },
  deptRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1 },
  products: { gap: 4, marginTop: 4 },
  modalBody: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.four, gap: Spacing.two },
  footer: { padding: Spacing.three, backgroundColor: BrandColors.bg },
  modalTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  modalTopTitle: { fontSize: 18, fontWeight: '700', color: BrandColors.text },
});
