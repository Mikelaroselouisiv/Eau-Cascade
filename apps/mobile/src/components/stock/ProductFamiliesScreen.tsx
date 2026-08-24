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
  createProductFamily,
  deleteProductFamily,
  getCompanies,
  getProductFamilies,
  getProducts,
  updateProductFamily,
} from '@/services/api';
import type { CompanyListItem, Product, ProductFamily } from '@/types/api';
import { formatMoney } from '@/utils/datetime';

type TierDraft = { minQuantity: string; unitPrice: string };

export function ProductFamiliesScreen() {
  const { user, can, canPerm } = useAuth();
  const sessionCompanyId = typeof user?.companyId === 'number' ? user.companyId : null;
  const allowed =
    can(['ADMIN', 'MANAGER', 'STOCK_MANAGER']) ||
    canPerm('products.view') ||
    canPerm('products.manage');
  const canManage = can(['ADMIN', 'MANAGER', 'STOCK_MANAGER']) || canPerm('products.manage');
  const [companies, setCompanies] = useState<CompanyListItem[]>([]);
  const [companyId, setCompanyId] = useState<number | null>(sessionCompanyId);
  const [products, setProducts] = useState<Product[]>([]);
  const [families, setFamilies] = useState<ProductFamily[]>([]);
  const [editing, setEditing] = useState<ProductFamily | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [name, setName] = useState('');
  const [tiers, setTiers] = useState<TierDraft[]>([
    { minQuantity: '5', unitPrice: '' },
  ]);
  const [selectedProductIds, setSelectedProductIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!allowed) return;
    try {
      const [companyRows, productRows] = await Promise.all([getCompanies(), getProducts()]);
      setCompanies(companyRows);
      setProducts(productRows);
      const selected =
        companyId ??
        sessionCompanyId ??
        companyRows[0]?.id ??
        null;
      if (selected != null) {
        setCompanyId(selected);
        setFamilies(await getProductFamilies(selected));
      } else {
        setFamilies([]);
      }
    } catch {
      setStatus('Impossible de charger les familles');
    }
  }, [allowed, companyId, sessionCompanyId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    if (companyId == null) return;
    void getProductFamilies(companyId)
      .then(setFamilies)
      .catch(() => setStatus('Impossible de charger les familles'));
  }, [companyId]);

  const companyProducts = useMemo(
    () =>
      products
        .filter((product) => product.companyId === companyId)
        .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })),
    [products, companyId],
  );

  function openCreate() {
    setEditing(null);
    setName('');
    setTiers([{ minQuantity: '5', unitPrice: '' }]);
    setSelectedProductIds([]);
    setStatus(null);
    setModalVisible(true);
  }

  function openEdit(family: ProductFamily) {
    setEditing(family);
    setName(family.name);
    setTiers(
      family.tiers.length > 0
        ? family.tiers.map((tier) => ({
            minQuantity: String(tier.minQuantity),
            unitPrice: String(tier.unitPrice),
          }))
        : [{ minQuantity: '5', unitPrice: '' }],
    );
    setSelectedProductIds((family.products ?? []).map((product) => product.id));
    setStatus(null);
    setModalVisible(true);
  }

  function parseTiers() {
    const rows = tiers.map((tier) => ({
      minQuantity: Number(tier.minQuantity.replace(',', '.')),
      unitPrice: Number(tier.unitPrice.replace(',', '.')),
    }));
    return rows.every(
      (tier) =>
        Number.isFinite(tier.minQuantity) &&
        tier.minQuantity > 0 &&
        Number.isFinite(tier.unitPrice) &&
        tier.unitPrice >= 0,
    )
      ? rows
      : null;
  }

  async function submit() {
    if (companyId == null || busy) return;
    const familyName = name.trim();
    const parsedTiers = parseTiers();
    if (!familyName || !parsedTiers?.length) {
      setStatus('Nom et paliers valides requis');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        name: familyName,
        tiers: parsedTiers,
        productIds: selectedProductIds,
      };
      if (editing) {
        await updateProductFamily(editing.id, payload);
      } else {
        await createProductFamily({ companyId, ...payload });
      }
      setModalVisible(false);
      setStatus(editing ? 'Famille mise à jour' : 'Famille créée');
      const [familyRows, productRows] = await Promise.all([
        getProductFamilies(companyId),
        getProducts(),
      ]);
      setFamilies(familyRows);
      setProducts(productRows);
    } catch {
      setStatus('Enregistrement impossible');
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete(family: ProductFamily) {
    Alert.alert(
      'Supprimer la famille',
      `Supprimer « ${family.name} » ? Les produits seront détachés.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteProductFamily(family.id);
                setStatus('Famille supprimée');
                if (companyId != null) setFamilies(await getProductFamilies(companyId));
              } catch {
                setStatus('Suppression impossible');
              }
            })();
          },
        },
      ],
    );
  }

  if (!allowed) {
    return (
      <Screen>
        <View style={styles.blocked}>
          <Text style={styles.muted}>Gestion des familles non autorisée.</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={families}
        keyExtractor={(family) => String(family.id)}
        contentContainerStyle={styles.list}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          void load().finally(() => setRefreshing(false));
        }}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.hint}>
              Les quantités de tous les produits d’une famille sont additionnées pour appliquer
              le même prix de palier à chaque ligne du panier.
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {companies.map((company) => (
                <Pressable
                  key={company.id}
                  style={[styles.chip, companyId === company.id && styles.chipActive]}
                  onPress={() => setCompanyId(company.id)}>
                  <Text
                    style={[
                      styles.chipText,
                      companyId === company.id && styles.chipTextActive,
                    ]}>
                    {company.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            {canManage ? (
              <Pressable style={styles.primaryBtn} onPress={openCreate}>
                <Text style={styles.primaryBtnText}>+ Famille</Text>
              </Pressable>
            ) : null}
            {status ? <Text style={styles.status}>{status}</Text> : null}
            <Text style={styles.section}>{families.length} famille(s)</Text>
          </View>
        }
        ListEmptyComponent={<Text style={styles.muted}>Aucune famille</Text>}
        renderItem={({ item: family }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{family.name}</Text>
            <Text style={styles.muted}>
              {family.tiers
                .map(
                  (tier) =>
                    `≥ ${tier.minQuantity} → ${formatMoney(Number(tier.unitPrice))}`,
                )
                .join(' · ')}
            </Text>
            <Text style={styles.muted}>
              {(family.products ?? []).map((product) => product.name).join(', ') ||
                'Aucun produit'}
            </Text>
            {canManage ? (
              <View style={styles.actions}>
                <Pressable onPress={() => openEdit(family)}>
                  <Text style={styles.link}>Modifier</Text>
                </Pressable>
                <Pressable onPress={() => confirmDelete(family)}>
                  <Text style={styles.danger}>Supprimer</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        )}
      />

      <ModalShell
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
        body={
          <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
            <TextInput
              style={styles.input}
              placeholder="Nom de la famille"
              placeholderTextColor={BrandColors.textMuted}
              value={name}
              onChangeText={setName}
            />
            <Text style={styles.section}>Paliers de prix</Text>
            {tiers.map((tier, index) => (
              <View key={index} style={styles.tierRow}>
                <TextInput
                  style={[styles.input, styles.tierInput]}
                  placeholder="Qté min."
                  placeholderTextColor={BrandColors.textMuted}
                  keyboardType="decimal-pad"
                  value={tier.minQuantity}
                  onChangeText={(value) =>
                    setTiers((previous) =>
                      previous.map((row, rowIndex) =>
                        rowIndex === index ? { ...row, minQuantity: value } : row,
                      ),
                    )
                  }
                />
                <TextInput
                  style={[styles.input, styles.tierInput]}
                  placeholder="Prix"
                  placeholderTextColor={BrandColors.textMuted}
                  keyboardType="decimal-pad"
                  value={tier.unitPrice}
                  onChangeText={(value) =>
                    setTiers((previous) =>
                      previous.map((row, rowIndex) =>
                        rowIndex === index ? { ...row, unitPrice: value } : row,
                      ),
                    )
                  }
                />
                <Pressable
                  disabled={tiers.length === 1}
                  onPress={() =>
                    setTiers((previous) => previous.filter((_, rowIndex) => rowIndex !== index))
                  }>
                  <Text style={styles.danger}>×</Text>
                </Pressable>
              </View>
            ))}
            <Pressable
              style={styles.secondaryBtn}
              onPress={() =>
                setTiers((previous) => [
                  ...previous,
                  { minQuantity: '', unitPrice: '' },
                ])
              }>
              <Text style={styles.link}>+ Palier</Text>
            </Pressable>

            <Text style={styles.section}>Produits de la famille</Text>
            {companyProducts.map((product) => {
              const selected = selectedProductIds.includes(product.id);
              return (
                <Pressable
                  key={product.id}
                  style={[styles.productRow, selected && styles.productRowSelected]}
                  onPress={() =>
                    setSelectedProductIds((previous) =>
                      selected
                        ? previous.filter((id) => id !== product.id)
                        : [...previous, product.id],
                    )
                  }>
                  <Text style={styles.productCheck}>{selected ? '✓' : '○'}</Text>
                  <Text style={styles.productName}>{product.name}</Text>
                  {product.department?.name ? (
                    <Text style={styles.muted}>{product.department.name}</Text>
                  ) : null}
                </Pressable>
              );
            })}
            {status ? <Text style={styles.status}>{status}</Text> : null}
          </ScrollView>
        }
        footer={
          <View style={styles.footer}>
            <Pressable
              style={[styles.primaryBtn, busy && styles.disabled]}
              disabled={busy}
              onPress={() => void submit()}>
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>
                  {editing ? 'Enregistrer' : 'Créer la famille'}
                </Text>
              )}
            </Pressable>
          </View>
        }>
        <View style={styles.modalTop}>
          <Text style={styles.modalTitle}>{editing ? 'Modifier la famille' : 'Nouvelle famille'}</Text>
          <Pressable onPress={() => setModalVisible(false)}>
            <Text style={styles.link}>Fermer</Text>
          </Pressable>
        </View>
      </ModalShell>
    </Screen>
  );
}

const styles = StyleSheet.create({
  blocked: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six },
  header: { gap: Spacing.two, marginBottom: Spacing.three },
  hint: { color: BrandColors.textMuted, lineHeight: 20 },
  section: { color: BrandColors.text, fontWeight: '700', fontSize: 15 },
  status: { color: BrandColors.primaryHover, fontWeight: '600' },
  muted: { color: BrandColors.textMuted, fontSize: 12 },
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
  chipText: { color: BrandColors.text, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  primaryBtn: {
    backgroundColor: BrandColors.primary,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  card: {
    borderWidth: 1,
    borderColor: BrandColors.border,
    borderRadius: 14,
    padding: Spacing.three,
    marginBottom: Spacing.two,
    gap: 5,
    backgroundColor: BrandColors.surface,
  },
  cardTitle: { color: BrandColors.text, fontWeight: '700', fontSize: 16 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  link: { color: BrandColors.primary, fontWeight: '700' },
  danger: { color: BrandColors.danger, fontWeight: '700', fontSize: 18 },
  modalTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.three,
  },
  modalTitle: { color: BrandColors.text, fontWeight: '700', fontSize: 18 },
  modalBody: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.four, gap: Spacing.two },
  input: {
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: 11,
    color: BrandColors.text,
    backgroundColor: BrandColors.surface,
  },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  tierInput: { flex: 1 },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: BrandColors.border,
    borderRadius: 10,
    padding: Spacing.two,
  },
  productRowSelected: {
    borderColor: BrandColors.primary,
    backgroundColor: BrandColors.primarySoft,
  },
  productCheck: { color: BrandColors.primary, fontWeight: '700', fontSize: 18 },
  productName: { flex: 1, color: BrandColors.text, fontWeight: '600' },
  footer: { padding: Spacing.three, backgroundColor: BrandColors.bg },
  disabled: { opacity: 0.55 },
});
