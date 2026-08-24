import { useCallback, useEffect, useMemo, useState } from 'react';
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

import { RefreshableScroll } from '@/components/RefreshableScroll';
import { Screen } from '@/components/Screen';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import {
  getCompanies,
  getDepartments,
  getProducts,
  stockAdjust,
  stockIn,
} from '@/services/api';
import type { CompanyListItem, Department, Product } from '@/types/api';
import { stockPackagingLabel } from '@/utils/packaging';
import { formatQuantity } from '@/utils/quantity';

export function StockHarmonisationScreen() {
  const { can, canPerm } = useAuth();
  const allowed = can(['ADMIN']) || canPerm('stock.adjust');

  const [companies, setCompanies] = useState<CompanyListItem[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [companyId, setCompanyId] = useState<number | ''>('');
  const [deptId, setDeptId] = useState<number | ''>('');
  const [productId, setProductId] = useState<number | ''>('');
  const [kind, setKind] = useState<'in' | 'out'>('in');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!allowed) return;
    try {
      setError(null);
      const [co, prods] = await Promise.all([getCompanies(), getProducts()]);
      setCompanies(co);
      setProducts(prods);
      setCompanyId((prev) => (prev !== '' && co.some((c) => c.id === prev) ? prev : (co[0]?.id ?? '')));
    } catch {
      setError('Impossible de charger les produits');
    }
  }, [allowed]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    if (companyId === '') {
      setDepartments([]);
      setDeptId('');
      return;
    }
    void getDepartments(companyId).then((d) => {
      setDepartments(d);
      setDeptId((prev) => (prev !== '' && d.some((x) => x.id === prev) ? prev : ''));
      setProductId('');
    });
  }, [companyId]);

  const filteredProducts = useMemo(() => {
    if (companyId === '' || deptId === '') return [];
    return products
      .filter((p) => p.trackStock && !p.isService)
      .filter((p) => (p.companyId ?? p.company?.id) === companyId)
      .filter((p) => p.department?.id === deptId)
      .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  }, [products, companyId, deptId]);

  useEffect(() => {
    if (productId !== '' && !filteredProducts.some((p) => p.id === productId)) {
      setProductId('');
    }
  }, [filteredProducts, productId]);

  const selected = useMemo(
    () => (productId === '' ? null : products.find((p) => p.id === productId) ?? null),
    [productId, products],
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function submit() {
    if (productId === '') {
      setStatus('Produit requis');
      return;
    }
    const quantity = Number(qty.replace(',', '.'));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setStatus('Quantité invalide');
      return;
    }
    const note = reason.trim() || undefined;
    setBusy(true);
    setStatus(null);
    try {
      if (kind === 'in') {
        await stockIn({
          productId,
          quantity,
          reason: note ?? 'Réception / entrée stock',
        });
      } else {
        if (selected && Number(selected.stock) < quantity) {
          setStatus(
            `Stock insuffisant (dispo : ${formatQuantity(selected.stock)} ${stockPackagingLabel(selected)})`,
          );
          setBusy(false);
          return;
        }
        await stockAdjust({
          productId,
          quantity: -quantity,
          reason: note ?? 'Sortie manuelle (casse, invendable, etc.)',
        });
      }
      setQty('');
      setReason('');
      setStatus(kind === 'in' ? 'Entrée enregistrée' : 'Sortie enregistrée');
      await load();
    } catch {
      setStatus('Opération impossible');
    } finally {
      setBusy(false);
    }
  }

  if (!allowed) {
    return (
      <Screen>
        <View style={styles.blocked}>
          <Text style={styles.blockedText}>Harmonisation réservée aux administrateurs.</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen keyboard>
      <RefreshableScroll refreshing={refreshing} onRefresh={() => void onRefresh()}>
        <View style={styles.body}>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {status ? <Text style={styles.status}>{status}</Text> : null}

          <Text style={styles.fieldLabel}>Type</Text>
          <View style={styles.row2}>
            <Pressable
              style={[styles.kindChip, kind === 'in' && styles.kindChipActive]}
              onPress={() => setKind('in')}>
              <Text style={[styles.kindText, kind === 'in' && styles.kindTextActive]}>Entrée</Text>
            </Pressable>
            <Pressable
              style={[styles.kindChip, kind === 'out' && styles.kindChipActive]}
              onPress={() => setKind('out')}>
              <Text style={[styles.kindText, kind === 'out' && styles.kindTextActive]}>Sortie</Text>
            </Pressable>
          </View>

          <Text style={styles.fieldLabel}>Entreprise</Text>
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

          <Text style={styles.fieldLabel}>Département</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
            {departments.map((d) => (
              <Chip
                key={d.id}
                label={d.name}
                active={deptId === d.id}
                onPress={() => {
                  setDeptId(d.id);
                  setProductId('');
                }}
              />
            ))}
          </ScrollView>

          <Text style={styles.fieldLabel}>Produit</Text>
          {filteredProducts.length === 0 ? (
            <Text style={styles.meta}>Choisir entreprise et département</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
              {filteredProducts.map((p) => (
                <Chip
                  key={p.id}
                  label={`${p.name} (${formatQuantity(p.stock)})`}
                  active={productId === p.id}
                  onPress={() => setProductId(p.id)}
                />
              ))}
            </ScrollView>
          )}

          {selected ? (
            <Text style={styles.meta}>
              Stock : {formatQuantity(selected.stock)} {stockPackagingLabel(selected)}
            </Text>
          ) : null}

          <TextInput
            style={styles.input}
            placeholder="Quantité"
            placeholderTextColor={BrandColors.textMuted}
            keyboardType="decimal-pad"
            value={qty}
            onChangeText={setQty}
          />
          <TextInput
            style={styles.input}
            placeholder="Motif (optionnel)"
            placeholderTextColor={BrandColors.textMuted}
            value={reason}
            onChangeText={setReason}
          />

          <Pressable
            style={[styles.primaryBtn, busy && styles.disabled]}
            disabled={busy}
            onPress={() => void submit()}>
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>
                {kind === 'in' ? 'Enregistrer entrée' : 'Enregistrer sortie'}
              </Text>
            )}
          </Pressable>
        </View>
      </RefreshableScroll>
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
  body: { padding: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.six },
  error: { color: BrandColors.danger, fontWeight: '600' },
  status: { color: BrandColors.primaryHover, fontWeight: '600' },
  fieldLabel: { fontWeight: '600', color: BrandColors.textMuted, fontSize: 13, marginTop: 4 },
  meta: { fontSize: 13, color: BrandColors.textMuted },
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
    maxWidth: 240,
  },
  chipActive: { backgroundColor: BrandColors.primary, borderColor: BrandColors.primary },
  chipText: { fontWeight: '600', color: BrandColors.text, fontSize: 13 },
  chipTextActive: { color: '#fff' },
  row2: { flexDirection: 'row', gap: Spacing.two },
  kindChip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    alignItems: 'center',
    backgroundColor: BrandColors.surface,
  },
  kindChipActive: { backgroundColor: BrandColors.primary, borderColor: BrandColors.primary },
  kindText: { fontWeight: '700', color: BrandColors.text },
  kindTextActive: { color: '#fff' },
  primaryBtn: {
    backgroundColor: BrandColors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.55 },
});
