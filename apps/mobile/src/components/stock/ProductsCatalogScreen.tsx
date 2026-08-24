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
  createProduct,
  deleteProduct,
  getCompanies,
  getDepartments,
  getPackagingUnits,
  getProductFamilies,
  getProducts,
  updateProduct,
} from '@/services/api';
import type {
  CompanyListItem,
  Department,
  PackagingUnit,
  Product,
  ProductFamily,
} from '@/types/api';
import { formatMoney } from '@/utils/datetime';
import { defaultUnitPrice, stockPackagingLabel } from '@/utils/packaging';
import { formatQuantity } from '@/utils/quantity';

const DEFAULT_CARD_COLOR = '#7a5230';
const COLOR_PRESETS = ['#7a5230', '#a67c52', '#8b6914', '#6b4423', '#c4a574', '#b42318'];

function compareProducts(a: Product, b: Product): number {
  const ca = (a.company?.name ?? '').localeCompare(b.company?.name ?? '', 'fr', {
    sensitivity: 'base',
  });
  if (ca !== 0) return ca;
  const da = (a.department?.name ?? '').localeCompare(b.department?.name ?? '', 'fr', {
    sensitivity: 'base',
  });
  if (da !== 0) return da;
  return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
}

export function ProductsCatalogScreen() {
  const { user, can, canPerm } = useAuth();
  const canManage = canPerm('products.manage') || can(['ADMIN', 'MANAGER', 'STOCK_MANAGER']);
  const allowed =
    can(['ADMIN', 'MANAGER', 'STOCK_MANAGER']) ||
    canPerm('products.view') ||
    canPerm('products.manage');
  const sessionCompanyId = typeof user?.companyId === 'number' ? user.companyId : undefined;

  const [companies, setCompanies] = useState<CompanyListItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [filterCompanyId, setFilterCompanyId] = useState<number | ''>('');
  const [filterDeptId, setFilterDeptId] = useState<number | ''>('');
  const [filterDepts, setFilterDepts] = useState<Department[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const [edit, setEdit] = useState<Product | null>(null);
  const [editName, setEditName] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editColor, setEditColor] = useState(DEFAULT_CARD_COLOR);
  const [editFamilies, setEditFamilies] = useState<ProductFamily[]>([]);
  const [editFamilyId, setEditFamilyId] = useState<number | ''>('');

  const [showCreate, setShowCreate] = useState(false);
  const [createCompanyId, setCreateCompanyId] = useState<number | ''>('');
  const [createDepts, setCreateDepts] = useState<Department[]>([]);
  const [createDeptId, setCreateDeptId] = useState<number | ''>('');
  const [packaging, setPackaging] = useState<PackagingUnit[]>([]);
  const [packId, setPackId] = useState<number | ''>('');
  const [createName, setCreateName] = useState('');
  const [createPrice, setCreatePrice] = useState('');
  const [createColor, setCreateColor] = useState(DEFAULT_CARD_COLOR);
  const [createFamilies, setCreateFamilies] = useState<ProductFamily[]>([]);
  const [createFamilyId, setCreateFamilyId] = useState<number | ''>('');

  const load = useCallback(async () => {
    if (!allowed) return;
    try {
      setError(null);
      const [co, prods] = await Promise.all([getCompanies(), getProducts()]);
      setCompanies(co);
      setProducts(prods);
      const preferred = sessionCompanyId ?? co[0]?.id;
      if (preferred != null) {
        setCreateCompanyId((prev) => (prev !== '' ? prev : preferred));
      }
    } catch {
      setError('Impossible de charger le catalogue');
    }
  }, [allowed, sessionCompanyId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    if (filterCompanyId === '') {
      setFilterDepts([]);
      setFilterDeptId('');
      return;
    }
    void getDepartments(filterCompanyId).then((d) => {
      setFilterDepts(d);
      setFilterDeptId((prev) => (prev !== '' && d.some((x) => x.id === prev) ? prev : ''));
    });
  }, [filterCompanyId]);

  useEffect(() => {
    if (createCompanyId === '') {
      setCreateDepts([]);
      setCreateDeptId('');
      setCreateFamilies([]);
      setCreateFamilyId('');
      return;
    }
    void getDepartments(createCompanyId).then((d) => {
      setCreateDepts(d);
      setCreateDeptId((prev) => {
        if (prev !== '' && d.some((x) => x.id === prev)) return prev;
        return d[0]?.id ?? '';
      });
    });
    void getProductFamilies(createCompanyId)
      .then((rows) => {
        setCreateFamilies(rows);
        setCreateFamilyId((previous) =>
          previous !== '' && rows.some((family) => family.id === previous) ? previous : '',
        );
      })
      .catch(() => {
        setCreateFamilies([]);
        setCreateFamilyId('');
      });
  }, [createCompanyId]);

  useEffect(() => {
    if (createDeptId === '') {
      setPackaging([]);
      setPackId('');
      return;
    }
    void getPackagingUnits(createDeptId).then((pk) => {
      setPackaging(pk);
      setPackId((prev) => (prev !== '' && pk.some((u) => u.id === prev) ? prev : (pk[0]?.id ?? '')));
    });
  }, [createDeptId]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    let list = products;
    if (filterCompanyId !== '') {
      list = list.filter((p) => (p.companyId ?? p.company?.id) === filterCompanyId);
    }
    if (filterDeptId !== '') {
      list = list.filter((p) => p.department?.id === filterDeptId);
    }
    if (query) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          (p.sku ?? '').toLowerCase().includes(query),
      );
    }
    return [...list].sort(compareProducts);
  }, [products, filterCompanyId, filterDeptId, q]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function openEdit(p: Product) {
    setEdit(p);
    setEditName(p.name);
    const price = defaultUnitPrice(p);
    setEditPrice(price != null ? String(price) : '');
    setEditColor(p.cardColor?.trim() || DEFAULT_CARD_COLOR);
    setEditFamilyId(p.productFamilyId ?? p.productFamily?.id ?? '');
    const productCompanyId = p.companyId ?? p.company?.id;
    if (productCompanyId != null) {
      void getProductFamilies(productCompanyId)
        .then(setEditFamilies)
        .catch(() => setEditFamilies([]));
    } else {
      setEditFamilies([]);
    }
    setStatus(null);
  }

  async function submitEdit() {
    if (!edit) return;
    const name = editName.trim();
    const price = Number(editPrice.replace(',', '.'));
    if (!name) {
      setStatus('Nom requis');
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setStatus('Prix invalide');
      return;
    }
    setBusy(true);
    try {
      await updateProduct(edit.id, {
        name,
        salePrice: price,
        cardColor: editColor,
        productFamilyId: editFamilyId === '' ? null : editFamilyId,
      });
      setEdit(null);
      setStatus('Produit mis à jour');
      await load();
    } catch {
      setStatus('Mise à jour impossible');
    } finally {
      setBusy(false);
    }
  }

  async function submitCreate() {
    const name = createName.trim();
    const price = Number(createPrice.replace(',', '.'));
    if (createCompanyId === '' || createDeptId === '' || packId === '') {
      setStatus('Entreprise, département et conditionnement requis');
      return;
    }
    if (!name || !Number.isFinite(price) || price < 0) {
      setStatus('Nom / prix invalides');
      return;
    }
    setBusy(true);
    try {
      await createProduct({
        name,
        cardColor: createColor,
        companyId: createCompanyId,
        departmentId: createDeptId,
        productFamilyId: createFamilyId === '' ? null : createFamilyId,
        trackStock: true,
        saleUnits: [{ packagingUnitId: packId, salePrice: price, isDefault: true }],
      });
      setCreateName('');
      setCreatePrice('');
      setCreateColor(DEFAULT_CARD_COLOR);
      setCreateFamilyId('');
      setShowCreate(false);
      setStatus('Produit créé');
      await load();
    } catch {
      setStatus('Création impossible');
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete(p: Product) {
    Alert.alert('Supprimer', `Supprimer « ${p.name} » ?`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteProduct(p.id);
              if (edit?.id === p.id) setEdit(null);
              setStatus('Produit supprimé');
              await load();
            } catch {
              setStatus('Suppression impossible');
            }
          })();
        },
      },
    ]);
  }

  if (!allowed) {
    return (
      <Screen>
        <View style={styles.blocked}>
          <Text style={styles.blockedText}>Catalogue réservé aux rôles stock / gestion.</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen keyboard={showCreate || edit != null}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {status ? <Text style={styles.status}>{status}</Text> : null}

      <FlatList
        data={filtered}
        keyExtractor={(p) => String(p.id)}
        contentContainerStyle={styles.list}
        refreshing={refreshing}
        onRefresh={() => void onRefresh()}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <TextInput
              style={styles.input}
              placeholder="Rechercher produit / SKU…"
              placeholderTextColor={BrandColors.textMuted}
              value={q}
              onChangeText={setQ}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
              <Chip
                label="Toutes ent."
                active={filterCompanyId === ''}
                onPress={() => setFilterCompanyId('')}
              />
              {companies.map((c) => (
                <Chip
                  key={c.id}
                  label={c.name}
                  active={filterCompanyId === c.id}
                  onPress={() => setFilterCompanyId(c.id)}
                />
              ))}
            </ScrollView>
            {filterCompanyId !== '' ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
                <Chip
                  label="Tous dépts"
                  active={filterDeptId === ''}
                  onPress={() => setFilterDeptId('')}
                />
                {filterDepts.map((d) => (
                  <Chip
                    key={d.id}
                    label={d.name}
                    active={filterDeptId === d.id}
                    onPress={() => setFilterDeptId(d.id)}
                  />
                ))}
              </ScrollView>
            ) : null}
            {canManage ? (
              <Pressable
                style={styles.primaryBtn}
                onPress={() => {
                  setStatus(null);
                  setShowCreate(true);
                }}>
                <Text style={styles.primaryBtnText}>+ Produit</Text>
              </Pressable>
            ) : null}
            <Text style={styles.section}>
              {filtered.length} produit(s)
              {filtered.length !== products.length ? ` / ${products.length}` : ''}
            </Text>
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>Aucun produit</Text>}
        renderItem={({ item: p }) => {
          const price = defaultUnitPrice(p);
          return (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <View
                  style={[
                    styles.swatch,
                    { backgroundColor: p.cardColor?.trim() || DEFAULT_CARD_COLOR },
                  ]}
                />
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {p.name}
                  {p.isService ? ' (service)' : ''}
                </Text>
              </View>
              <Text style={styles.meta}>
                {p.company?.name ?? '—'} · {p.department?.name ?? '—'} · {stockPackagingLabel(p)}
              </Text>
              {p.productFamily?.name ? (
                <Text style={styles.meta}>Famille : {p.productFamily.name}</Text>
              ) : null}
              <Text style={styles.meta}>SKU {p.sku ?? '—'}</Text>
              <Text style={styles.amounts}>
                {price != null ? formatMoney(price) : '—'} · Stock {formatQuantity(p.stock)}
              </Text>
              <View style={styles.rowActions}>
                {canManage ? (
                  <Pressable onPress={() => openEdit(p)}>
                    <Text style={styles.link}>Modifier</Text>
                  </Pressable>
                ) : (
                  <View />
                )}
                {canManage ? (
                  <Pressable onPress={() => confirmDelete(p)}>
                    <Text style={styles.danger}>Supprimer</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          );
        }}
      />

      <ModalShell
        visible={showCreate}
        onRequestClose={() => setShowCreate(false)}
        body={
          <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Text style={styles.fieldLabel}>Entreprise</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
              {companies.map((c) => (
                <Chip
                  key={c.id}
                  label={c.name}
                  active={createCompanyId === c.id}
                  onPress={() => setCreateCompanyId(c.id)}
                />
              ))}
            </ScrollView>
            <Text style={styles.fieldLabel}>Département</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
              {createDepts.map((d) => (
                <Chip
                  key={d.id}
                  label={d.name}
                  active={createDeptId === d.id}
                  onPress={() => setCreateDeptId(d.id)}
                />
              ))}
            </ScrollView>
            <Text style={styles.fieldLabel}>Conditionnement</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
              {packaging.map((u) => (
                <Chip
                  key={u.id}
                  label={`${u.label} (${u.code})`}
                  active={packId === u.id}
                  onPress={() => setPackId(u.id)}
                />
              ))}
            </ScrollView>
            <Text style={styles.fieldLabel}>Famille de produits</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
              <Chip
                label="Aucune"
                active={createFamilyId === ''}
                onPress={() => setCreateFamilyId('')}
              />
              {createFamilies.map((family) => (
                <Chip
                  key={family.id}
                  label={family.name}
                  active={createFamilyId === family.id}
                  onPress={() => setCreateFamilyId(family.id)}
                />
              ))}
            </ScrollView>
            <TextInput
              style={styles.input}
              placeholder="Nom"
              placeholderTextColor={BrandColors.textMuted}
              value={createName}
              onChangeText={setCreateName}
            />
            <TextInput
              style={styles.input}
              placeholder="Prix unitaire"
              placeholderTextColor={BrandColors.textMuted}
              keyboardType="decimal-pad"
              value={createPrice}
              onChangeText={setCreatePrice}
            />
            <Text style={styles.fieldLabel}>Couleur caisse</Text>
            <View style={styles.colorRow}>
              {COLOR_PRESETS.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setCreateColor(c)}
                  style={[
                    styles.colorDot,
                    { backgroundColor: c },
                    createColor === c && styles.colorDotActive,
                  ]}
                />
              ))}
            </View>
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
          <Text style={styles.modalTopTitle}>Nouveau produit</Text>
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
            <TextInput
              style={styles.input}
              placeholder="Nom"
              placeholderTextColor={BrandColors.textMuted}
              value={editName}
              onChangeText={setEditName}
            />
            <TextInput
              style={styles.input}
              placeholder="Prix unitaire"
              placeholderTextColor={BrandColors.textMuted}
              keyboardType="decimal-pad"
              value={editPrice}
              onChangeText={setEditPrice}
            />
            <Text style={styles.fieldLabel}>Famille de produits</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
              <Chip
                label="Aucune"
                active={editFamilyId === ''}
                onPress={() => setEditFamilyId('')}
              />
              {editFamilies.map((family) => (
                <Chip
                  key={family.id}
                  label={family.name}
                  active={editFamilyId === family.id}
                  onPress={() => setEditFamilyId(family.id)}
                />
              ))}
            </ScrollView>
            <Text style={styles.fieldLabel}>Couleur caisse</Text>
            <View style={styles.colorRow}>
              {COLOR_PRESETS.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setEditColor(c)}
                  style={[
                    styles.colorDot,
                    { backgroundColor: c },
                    editColor === c && styles.colorDotActive,
                  ]}
                />
              ))}
            </View>
            {edit ? (
              <Text style={styles.meta}>
                Stock actuel : {formatQuantity(edit.stock)} {stockPackagingLabel(edit)}
              </Text>
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
  error: {
    color: BrandColors.danger,
    fontWeight: '600',
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.two,
  },
  status: {
    color: BrandColors.primaryHover,
    fontWeight: '600',
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.two,
  },
  list: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six },
  headerBlock: { gap: Spacing.two, marginBottom: Spacing.two },
  section: { fontSize: 15, fontWeight: '700', color: BrandColors.text },
  empty: { color: BrandColors.textMuted, textAlign: 'center', marginTop: Spacing.four },
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
    maxWidth: 200,
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
    gap: 4,
    marginBottom: Spacing.two,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  swatch: { width: 16, height: 16, borderRadius: 4 },
  cardTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: BrandColors.text },
  meta: { fontSize: 12, color: BrandColors.textMuted },
  amounts: { fontSize: 14, fontWeight: '600', color: BrandColors.text },
  rowActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
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
  modalBody: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.four, gap: Spacing.two },
  footer: { padding: Spacing.three, backgroundColor: BrandColors.bg },
  fieldLabel: { fontWeight: '600', color: BrandColors.textMuted, fontSize: 13 },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  colorDot: { width: 32, height: 32, borderRadius: 16 },
  colorDotActive: { borderWidth: 3, borderColor: BrandColors.text },
});
