import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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
import { formatApiError } from '@/services/api-errors';
import type {
  CompanyListItem,
  Department,
  PackagingUnit,
  Product,
  ProductFamily,
  ProductNature,
} from '@/types/api';
import { formatMoney } from '@/utils/datetime';
import { defaultSaleUnitForProduct, defaultUnitPrice, stockPackagingLabel } from '@/utils/packaging';
import { formatQuantity } from '@/utils/quantity';

const DEFAULT_CARD_COLOR = '#7a5230';
const COLOR_PRESETS = ['#7a5230', '#a67c52', '#8b6914', '#6b4423', '#c4a574', '#b42318'];

type TierDraft = { minQty: string; unitPrice: string };

function parseTiers(tiers: TierDraft[]):
  | { ok: true; value: Array<{ minQuantity: number; unitPrice: number }> }
  | { ok: false; error: string } {
  const parsed = tiers
    .map((t) => ({
      minQuantity: Number(String(t.minQty).replace(',', '.')),
      unitPrice: Number(String(t.unitPrice).replace(',', '.')),
    }))
    .filter(
      (t) =>
        Number.isFinite(t.minQuantity) &&
        t.minQuantity > 0 &&
        Number.isFinite(t.unitPrice) &&
        t.unitPrice >= 0,
    );
  const seen = new Set<number>();
  for (const t of parsed) {
    if (seen.has(t.minQuantity)) {
      return { ok: false, error: 'Paliers : quantité minimale en double' };
    }
    seen.add(t.minQuantity);
  }
  return { ok: true, value: parsed };
}

function parseNonNeg(raw: string, label: string): { ok: true; value: number } | { ok: false; error: string } {
  const n = Number(String(raw).replace(',', '.').trim() || '0');
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: `${label} invalide` };
  return { ok: true, value: n };
}

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
  const canManage = canPerm('products.manage');
  const allowed = canPerm('products.view') || canPerm('products.manage');
  const isAdmin = can(['ADMIN']);
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
  const [editCompanyId, setEditCompanyId] = useState<number | ''>('');
  const [editDepts, setEditDepts] = useState<Department[]>([]);
  const [editDeptId, setEditDeptId] = useState<number | ''>('');
  const [editPackaging, setEditPackaging] = useState<PackagingUnit[]>([]);
  const [editPackId, setEditPackId] = useState<number | ''>('');
  const [editLabelOverride, setEditLabelOverride] = useState('');
  const [editName, setEditName] = useState('');
  const [editSku, setEditSku] = useState('');
  const [editBarcode, setEditBarcode] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editTiers, setEditTiers] = useState<TierDraft[]>([]);
  const [editCost, setEditCost] = useState('0');
  const [editStock, setEditStock] = useState('0');
  const [editStockMin, setEditStockMin] = useState('0');
  const [editColor, setEditColor] = useState(DEFAULT_CARD_COLOR);
  const [editFamilies, setEditFamilies] = useState<ProductFamily[]>([]);
  const [editFamilyId, setEditFamilyId] = useState<number | ''>('');
  const [editNature, setEditNature] = useState<ProductNature>('FINISHED_GOOD');
  const [editIsService, setEditIsService] = useState(false);
  const [editTrackStock, setEditTrackStock] = useState(true);

  const [showCreate, setShowCreate] = useState(false);
  const [createCompanyId, setCreateCompanyId] = useState<number | ''>('');
  const [createDepts, setCreateDepts] = useState<Department[]>([]);
  const [createDeptId, setCreateDeptId] = useState<number | ''>('');
  const [packaging, setPackaging] = useState<PackagingUnit[]>([]);
  const [packId, setPackId] = useState<number | ''>('');
  const [createLabelOverride, setCreateLabelOverride] = useState('');
  const [createName, setCreateName] = useState('');
  const [createSku, setCreateSku] = useState('');
  const [createBarcode, setCreateBarcode] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createPrice, setCreatePrice] = useState('');
  const [createTiers, setCreateTiers] = useState<TierDraft[]>([]);
  const [createCost, setCreateCost] = useState('0');
  const [createStock, setCreateStock] = useState('0');
  const [createStockMin, setCreateStockMin] = useState('0');
  const [createColor, setCreateColor] = useState(DEFAULT_CARD_COLOR);
  const [createFamilies, setCreateFamilies] = useState<ProductFamily[]>([]);
  const [createFamilyId, setCreateFamilyId] = useState<number | ''>('');
  const [createNature, setCreateNature] = useState<ProductNature>('FINISHED_GOOD');
  const [createIsService, setCreateIsService] = useState(false);
  const [createTrackStock, setCreateTrackStock] = useState(true);

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

  useEffect(() => {
    if (!edit) return;
    if (editCompanyId === '') {
      setEditDepts([]);
      setEditDeptId('');
      setEditFamilies([]);
      setEditFamilyId('');
      return;
    }
    void getDepartments(editCompanyId).then((d) => {
      setEditDepts(d);
      setEditDeptId((prev) => (prev !== '' && d.some((x) => x.id === prev) ? prev : ''));
    });
    void getProductFamilies(editCompanyId)
      .then((rows) => {
        setEditFamilies(rows);
        setEditFamilyId((previous) =>
          previous !== '' && rows.some((family) => family.id === previous) ? previous : '',
        );
      })
      .catch(() => {
        setEditFamilies([]);
        setEditFamilyId('');
      });
  }, [edit, editCompanyId]);

  useEffect(() => {
    if (!edit) return;
    if (editDeptId === '') {
      setEditPackaging([]);
      setEditPackId('');
      return;
    }
    void getPackagingUnits(editDeptId).then((pk) => {
      setEditPackaging(pk);
      setEditPackId((prev) => (prev !== '' && pk.some((u) => u.id === prev) ? prev : (pk[0]?.id ?? '')));
    });
  }, [edit, editDeptId]);

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
    const su = defaultSaleUnitForProduct(p);
    setEdit(p);
    const productCompanyId = p.companyId ?? p.company?.id ?? '';
    setEditCompanyId(productCompanyId);
    setEditDeptId(p.department?.id ?? '');
    setEditPackId(su?.packagingUnitId ?? '');
    setEditLabelOverride(su?.labelOverride ?? '');
    setEditName(p.name);
    setEditSku(p.sku ?? '');
    setEditBarcode(p.barcode ?? '');
    setEditDescription(p.description ?? '');
    const price = defaultUnitPrice(p);
    setEditPrice(price != null ? String(price) : '');
    setEditTiers(
      su?.volumePrices?.map((v) => ({
        minQty: String(v.minQuantity),
        unitPrice: String(v.unitPrice),
      })) ?? [],
    );
    setEditCost(String(p.cost ?? 0));
    setEditStock(String(p.stock ?? 0));
    setEditStockMin(String(p.stockMin ?? 0));
    setEditColor(p.cardColor?.trim() || DEFAULT_CARD_COLOR);
    setEditFamilyId(p.productFamilyId ?? p.productFamily?.id ?? '');
    const nature = p.nature === 'RAW_MATERIAL' ? 'RAW_MATERIAL' : 'FINISHED_GOOD';
    setEditNature(nature);
    setEditIsService(nature === 'RAW_MATERIAL' ? false : Boolean(p.isService));
    setEditTrackStock(nature === 'RAW_MATERIAL' ? true : p.trackStock !== false);
    setStatus(null);
  }

  async function submitEdit() {
    if (!edit) return;
    const name = editName.trim();
    if (!name) {
      setStatus('Nom requis');
      return;
    }
    if (editCompanyId === '') {
      setStatus('Entreprise requise');
      return;
    }
    const price = parseNonNeg(editPrice, 'Prix unitaire');
    if (!price.ok) {
      setStatus(price.error);
      return;
    }
    const stock = parseNonNeg(editStock, 'Stock');
    if (!stock.ok) {
      setStatus(stock.error);
      return;
    }
    const stockMin = parseNonNeg(editStockMin, 'Stock minimum');
    if (!stockMin.ok) {
      setStatus(stockMin.error);
      return;
    }
    const cost = parseNonNeg(editCost, 'Coût');
    if (isAdmin && !cost.ok) {
      setStatus(cost.error);
      return;
    }
    const tiers = parseTiers(editTiers);
    if (!tiers.ok) {
      setStatus(tiers.error);
      return;
    }
    if (editDeptId !== '' && editPackId === '') {
      setStatus('Conditionnement requis');
      return;
    }
    setBusy(true);
    try {
      await updateProduct(edit.id, {
        name,
        cardColor: editColor,
        companyId: editCompanyId,
        sku: editSku.trim() || undefined,
        barcode: editBarcode.trim() || undefined,
        description: editDescription.trim() || undefined,
        ...(isAdmin && cost.ok ? { cost: cost.value } : {}),
        stock: stock.value,
        stockMin: stockMin.value,
        departmentId: editDeptId === '' ? null : editDeptId,
        productFamilyId: editFamilyId === '' ? null : editFamilyId,
        nature: editNature,
        trackStock: editNature === 'RAW_MATERIAL' ? true : editTrackStock,
        isService: editNature === 'RAW_MATERIAL' ? false : editIsService,
        salePrice: price.value,
        volumePrices: tiers.value,
        ...(editDeptId !== '' && editPackId !== ''
          ? {
              packagingUnitId: editPackId,
              labelOverride: editLabelOverride.trim() || null,
            }
          : {}),
      });
      setEdit(null);
      setStatus('Produit mis à jour');
      await load();
    } catch (err) {
      setStatus(formatApiError(err, 'Mise à jour impossible'));
    } finally {
      setBusy(false);
    }
  }

  async function submitCreate() {
    const name = createName.trim();
    if (createCompanyId === '' || createDeptId === '' || packId === '') {
      setStatus('Entreprise, département et conditionnement requis');
      return;
    }
    if (!name) {
      setStatus('Nom requis');
      return;
    }
    const price = parseNonNeg(createPrice, 'Prix unitaire');
    if (!price.ok) {
      setStatus(price.error);
      return;
    }
    const stock = parseNonNeg(createStock, 'Stock');
    if (!stock.ok) {
      setStatus(stock.error);
      return;
    }
    const stockMin = parseNonNeg(createStockMin, 'Stock minimum');
    if (!stockMin.ok) {
      setStatus(stockMin.error);
      return;
    }
    const cost = parseNonNeg(createCost, 'Coût');
    if (isAdmin && !cost.ok) {
      setStatus(cost.error);
      return;
    }
    const tiers = parseTiers(createTiers);
    if (!tiers.ok) {
      setStatus(tiers.error);
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
        sku: createSku.trim() || undefined,
        barcode: createBarcode.trim() || undefined,
        description: createDescription.trim() || undefined,
        nature: createNature,
        isService: createNature === 'RAW_MATERIAL' ? false : createIsService,
        trackStock: createNature === 'RAW_MATERIAL' ? true : createTrackStock,
        ...(isAdmin && cost.ok ? { cost: cost.value } : {}),
        stock: stock.value,
        stockMin: stockMin.value,
        saleUnits: [
          {
            packagingUnitId: packId,
            salePrice: price.value,
            isDefault: true,
            labelOverride: createLabelOverride.trim() || undefined,
            volumePrices: tiers.value,
          },
        ],
      });
      setCreateName('');
      setCreateSku('');
      setCreateBarcode('');
      setCreateDescription('');
      setCreatePrice('');
      setCreateTiers([]);
      setCreateLabelOverride('');
      setCreateCost('0');
      setCreateStock('0');
      setCreateStockMin('0');
      setCreateColor(DEFAULT_CARD_COLOR);
      setCreateFamilyId('');
      setCreateIsService(false);
      setCreateTrackStock(true);
      setShowCreate(false);
      setStatus('Produit créé');
      await load();
    } catch (err) {
      setStatus(formatApiError(err, 'Création impossible'));
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
                  {p.nature === 'RAW_MATERIAL' ? ' (matière première)' : ''}
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
            <ChipRow>
              {companies.map((c) => (
                <Chip
                  key={c.id}
                  label={c.name}
                  active={createCompanyId === c.id}
                  onPress={() => setCreateCompanyId(c.id)}
                />
              ))}
            </ChipRow>
            <Text style={styles.fieldLabel}>Département</Text>
            {createDepts.length === 0 ? (
              <Text style={styles.meta}>Aucun département</Text>
            ) : (
              <ChipRow>
                {createDepts.map((d) => (
                  <Chip
                    key={d.id}
                    label={d.name}
                    active={createDeptId === d.id}
                    onPress={() => setCreateDeptId(d.id)}
                  />
                ))}
              </ChipRow>
            )}
            <Text style={styles.fieldLabel}>Conditionnement</Text>
            {packaging.length === 0 ? (
              <Text style={styles.meta}>Aucun conditionnement</Text>
            ) : (
              <ChipRow>
                {packaging.map((u) => (
                  <Chip
                    key={u.id}
                    label={`${u.label} (${u.code})`}
                    active={packId === u.id}
                    onPress={() => setPackId(u.id)}
                  />
                ))}
              </ChipRow>
            )}
            <TextInput
              style={styles.input}
              placeholder="Libellé caisse"
              placeholderTextColor={BrandColors.textMuted}
              value={createLabelOverride}
              onChangeText={setCreateLabelOverride}
            />
            <Text style={styles.fieldLabel}>Type</Text>
            <ChipRow>
              <Chip
                label="Produit fini"
                active={createNature === 'FINISHED_GOOD'}
                onPress={() => setCreateNature('FINISHED_GOOD')}
              />
              <Chip
                label="Matière première"
                active={createNature === 'RAW_MATERIAL'}
                onPress={() => {
                  setCreateNature('RAW_MATERIAL');
                  setCreateIsService(false);
                  setCreateTrackStock(true);
                }}
              />
            </ChipRow>
            {createNature !== 'RAW_MATERIAL' ? (
              <>
                <Text style={styles.fieldLabel}>Service</Text>
                <YesNoChips value={createIsService} onChange={setCreateIsService} />
                <Text style={styles.fieldLabel}>Suivre le stock</Text>
                <YesNoChips value={createTrackStock} onChange={setCreateTrackStock} />
              </>
            ) : null}
            <Text style={styles.fieldLabel}>Famille de produits</Text>
            <ChipRow>
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
            </ChipRow>
            <TextInput
              style={styles.input}
              placeholder="Nom"
              placeholderTextColor={BrandColors.textMuted}
              value={createName}
              onChangeText={setCreateName}
            />
            <TextInput
              style={styles.input}
              placeholder="SKU"
              placeholderTextColor={BrandColors.textMuted}
              value={createSku}
              onChangeText={setCreateSku}
              autoCapitalize="characters"
            />
            <TextInput
              style={styles.input}
              placeholder="Code-barres"
              placeholderTextColor={BrandColors.textMuted}
              value={createBarcode}
              onChangeText={setCreateBarcode}
            />
            <TextInput
              style={[styles.input, styles.multiline]}
              placeholder="Description"
              placeholderTextColor={BrandColors.textMuted}
              value={createDescription}
              onChangeText={setCreateDescription}
              multiline
            />
            {isAdmin ? (
              <TextInput
                style={styles.input}
                placeholder="Coût"
                placeholderTextColor={BrandColors.textMuted}
                keyboardType="decimal-pad"
                value={createCost}
                onChangeText={setCreateCost}
              />
            ) : null}
            <TextInput
              style={styles.input}
              placeholder="Prix unitaire"
              placeholderTextColor={BrandColors.textMuted}
              keyboardType="decimal-pad"
              value={createPrice}
              onChangeText={setCreatePrice}
            />
            <Text style={styles.fieldLabel}>Paliers</Text>
            <PriceTiersEditor tiers={createTiers} onChange={setCreateTiers} />
            <View style={styles.fieldRow}>
              <TextInput
                style={[styles.input, styles.fieldGrow]}
                placeholder="Stock"
                placeholderTextColor={BrandColors.textMuted}
                keyboardType="decimal-pad"
                value={createStock}
                onChangeText={setCreateStock}
              />
              <TextInput
                style={[styles.input, styles.fieldGrow]}
                placeholder="Stock min"
                placeholderTextColor={BrandColors.textMuted}
                keyboardType="decimal-pad"
                value={createStockMin}
                onChangeText={setCreateStockMin}
              />
            </View>
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
            {status ? <Text style={styles.error}>{status}</Text> : null}
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
            <Text style={styles.fieldLabel}>Entreprise</Text>
            <ChipRow>
              {companies.map((c) => (
                <Chip
                  key={c.id}
                  label={c.name}
                  active={editCompanyId === c.id}
                  onPress={() => setEditCompanyId(c.id)}
                />
              ))}
            </ChipRow>
            <TextInput
              style={styles.input}
              placeholder="Nom"
              placeholderTextColor={BrandColors.textMuted}
              value={editName}
              onChangeText={setEditName}
            />
            <TextInput
              style={styles.input}
              placeholder="SKU"
              placeholderTextColor={BrandColors.textMuted}
              value={editSku}
              onChangeText={setEditSku}
              autoCapitalize="characters"
            />
            <TextInput
              style={styles.input}
              placeholder="Code-barres"
              placeholderTextColor={BrandColors.textMuted}
              value={editBarcode}
              onChangeText={setEditBarcode}
            />
            <TextInput
              style={[styles.input, styles.multiline]}
              placeholder="Description"
              placeholderTextColor={BrandColors.textMuted}
              value={editDescription}
              onChangeText={setEditDescription}
              multiline
            />
            <Text style={styles.fieldLabel}>Département</Text>
            <ChipRow>
              <Chip label="Aucun" active={editDeptId === ''} onPress={() => setEditDeptId('')} />
              {editDepts.map((d) => (
                <Chip
                  key={d.id}
                  label={d.name}
                  active={editDeptId === d.id}
                  onPress={() => setEditDeptId(d.id)}
                />
              ))}
            </ChipRow>
            <Text style={styles.fieldLabel}>Conditionnement</Text>
            {editDeptId === '' ? (
              <Text style={styles.meta}>—</Text>
            ) : editPackaging.length === 0 ? (
              <Text style={styles.meta}>Aucun conditionnement</Text>
            ) : (
              <ChipRow>
                {editPackaging.map((u) => (
                  <Chip
                    key={u.id}
                    label={`${u.label} (${u.code})`}
                    active={editPackId === u.id}
                    onPress={() => setEditPackId(u.id)}
                  />
                ))}
              </ChipRow>
            )}
            <TextInput
              style={styles.input}
              placeholder="Libellé caisse"
              placeholderTextColor={BrandColors.textMuted}
              value={editLabelOverride}
              onChangeText={setEditLabelOverride}
              editable={editDeptId !== ''}
            />
            {isAdmin ? (
              <TextInput
                style={styles.input}
                placeholder="Coût"
                placeholderTextColor={BrandColors.textMuted}
                keyboardType="decimal-pad"
                value={editCost}
                onChangeText={setEditCost}
              />
            ) : null}
            <TextInput
              style={styles.input}
              placeholder="Prix unitaire"
              placeholderTextColor={BrandColors.textMuted}
              keyboardType="decimal-pad"
              value={editPrice}
              onChangeText={setEditPrice}
            />
            <Text style={styles.fieldLabel}>Paliers</Text>
            <PriceTiersEditor tiers={editTiers} onChange={setEditTiers} />
            <View style={styles.fieldRow}>
              <TextInput
                style={[styles.input, styles.fieldGrow]}
                placeholder="Stock"
                placeholderTextColor={BrandColors.textMuted}
                keyboardType="decimal-pad"
                value={editStock}
                onChangeText={setEditStock}
              />
              <TextInput
                style={[styles.input, styles.fieldGrow]}
                placeholder="Stock min"
                placeholderTextColor={BrandColors.textMuted}
                keyboardType="decimal-pad"
                value={editStockMin}
                onChangeText={setEditStockMin}
              />
            </View>
            <Text style={styles.fieldLabel}>Type</Text>
            <ChipRow>
              <Chip
                label="Produit fini"
                active={editNature === 'FINISHED_GOOD'}
                onPress={() => setEditNature('FINISHED_GOOD')}
              />
              <Chip
                label="Matière première"
                active={editNature === 'RAW_MATERIAL'}
                onPress={() => {
                  setEditNature('RAW_MATERIAL');
                  setEditIsService(false);
                  setEditTrackStock(true);
                }}
              />
            </ChipRow>
            {editNature !== 'RAW_MATERIAL' ? (
              <>
                <Text style={styles.fieldLabel}>Service</Text>
                <YesNoChips value={editIsService} onChange={setEditIsService} />
                <Text style={styles.fieldLabel}>Suivre le stock</Text>
                <YesNoChips value={editTrackStock} onChange={setEditTrackStock} />
              </>
            ) : null}
            <Text style={styles.fieldLabel}>Famille de produits</Text>
            <ChipRow>
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
            </ChipRow>
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
          </ScrollView>
        }
        footer={
          <View style={styles.footer}>
            {status ? <Text style={styles.error}>{status}</Text> : null}
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

function YesNoChips({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <ChipRow>
      <Chip label="Oui" active={value} onPress={() => onChange(true)} />
      <Chip label="Non" active={!value} onPress={() => onChange(false)} />
    </ChipRow>
  );
}

function PriceTiersEditor({
  tiers,
  onChange,
}: {
  tiers: TierDraft[];
  onChange: (next: TierDraft[]) => void;
}) {
  return (
    <View style={styles.tiersBlock}>
      {tiers.map((row, idx) => (
        <View key={idx} style={styles.tierRow}>
          <TextInput
            style={[styles.input, styles.tierInput]}
            placeholder="Qté min"
            placeholderTextColor={BrandColors.textMuted}
            keyboardType="decimal-pad"
            value={row.minQty}
            onChangeText={(minQty) => {
              const next = [...tiers];
              next[idx] = { ...next[idx], minQty };
              onChange(next);
            }}
          />
          <TextInput
            style={[styles.input, styles.tierInput]}
            placeholder="Prix palier"
            placeholderTextColor={BrandColors.textMuted}
            keyboardType="decimal-pad"
            value={row.unitPrice}
            onChangeText={(unitPrice) => {
              const next = [...tiers];
              next[idx] = { ...next[idx], unitPrice };
              onChange(next);
            }}
          />
          <Pressable onPress={() => onChange(tiers.filter((_, i) => i !== idx))} hitSlop={8}>
            <Text style={styles.danger}>Retirer</Text>
          </Pressable>
        </View>
      ))}
      <Pressable onPress={() => onChange([...tiers, { minQty: '', unitPrice: '' }])} hitSlop={8}>
        <Text style={styles.link}>+ Palier</Text>
      </Pressable>
    </View>
  );
}

function ChipRow({ children }: { children: ReactNode }) {
  return (
    <View style={styles.chipRow}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRowInner}>
        {children}
      </ScrollView>
    </View>
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
  modalBody: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.four, gap: Spacing.three },
  footer: { padding: Spacing.three, backgroundColor: BrandColors.bg, gap: 8 },
  fieldLabel: { fontWeight: '600', color: BrandColors.textMuted, fontSize: 13, marginTop: 4 },
  chipRow: { minHeight: 44 },
  chipRowInner: { alignItems: 'center', paddingVertical: 2, gap: 8 },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  colorDot: { width: 32, height: 32, borderRadius: 16 },
  colorDotActive: { borderWidth: 3, borderColor: BrandColors.text },
  fieldRow: { flexDirection: 'row', gap: 10 },
  fieldGrow: { flex: 1 },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  tiersBlock: { gap: 10 },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tierInput: { flex: 1, paddingVertical: 10 },
});
