import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { getDepartments, getGlobalStockSnapshot } from '@/services/api';
import type { Department, GlobalStockSnapshotItem } from '@/types/api';
import { formatDateTime } from '@/utils/datetime';
import { formatQuantity } from '@/utils/quantity';

type Props = { companyId: number; refreshKey?: number };

export function GlobalStockPanel({ companyId, refreshKey }: Props) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const [items, setItems] = useState<GlobalStockSnapshotItem[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [asOfDraft, setAsOfDraft] = useState('');
  const [asOf, setAsOf] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getDepartments(companyId)
      .then((rows) => {
        if (!cancelled) setDepartments(rows);
      })
      .catch(() => {
        if (!cancelled) setDepartments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const snapshot = await getGlobalStockSnapshot({
        companyIds: [companyId],
        departmentIds: departmentId != null ? [departmentId] : undefined,
        asOf: asOf || undefined,
      });
      setItems(snapshot.items);
      setGeneratedAt(snapshot.asOf ?? snapshot.generatedAt);
    } catch {
      setItems([]);
      setError('Impossible de charger l’inventaire global.');
    } finally {
      setLoading(false);
    }
  }, [asOf, companyId, departmentId]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load, refreshKey]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('fr');
    if (!normalized) return items;
    return items.filter(
      (item) =>
        item.name.toLocaleLowerCase('fr').includes(normalized) ||
        item.sku?.toLocaleLowerCase('fr').includes(normalized),
    );
  }, [items, query]);

  const lowCount = items.filter((item) => item.lowStock).length;
  const zeroCount = items.filter((item) => Number(item.stock) <= 0).length;

  function applyDate() {
    const value = asOfDraft.trim();
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      setError('Date attendue au format AAAA-MM-JJ.');
      return;
    }
    setAsOf(value);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerInfo}>
          <Text style={styles.title}>Inventaire global</Text>
          <Text style={styles.subtitle}>
            {items.length} produit(s){generatedAt ? ` · ${formatDateTime(generatedAt)}` : ''}
          </Text>
        </View>
        <Pressable
          style={[styles.filterButton, filtersOpen && styles.filterButtonActive]}
          onPress={() => setFiltersOpen((value) => !value)}>
          <Ionicons
            name="options-outline"
            size={18}
            color={filtersOpen ? '#fff' : BrandColors.primary}
          />
        </Pressable>
      </View>

      {filtersOpen ? (
        <View style={styles.filters}>
          <Text style={styles.filterLabel}>Département</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0 }}
            contentContainerStyle={styles.chips}>
            <FilterChip label="Tous" active={departmentId == null} onPress={() => setDepartmentId(null)} />
            {departments.map((department) => (
              <FilterChip
                key={department.id}
                label={department.name}
                active={departmentId === department.id}
                onPress={() => setDepartmentId(department.id)}
              />
            ))}
          </ScrollView>
          <Text style={styles.filterLabel}>Stock à une date (optionnel)</Text>
          <View style={styles.dateRow}>
            <TextInput
              value={asOfDraft}
              onChangeText={setAsOfDraft}
              placeholder="AAAA-MM-JJ"
              placeholderTextColor={BrandColors.textMuted}
              keyboardType="numbers-and-punctuation"
              style={styles.dateInput}
            />
            <Pressable style={styles.applyButton} onPress={applyDate}>
              <Text style={styles.applyText}>Appliquer</Text>
            </Pressable>
          </View>
          {asOf ? (
            <Pressable
              onPress={() => {
                setAsOfDraft('');
                setAsOf('');
              }}>
              <Text style={styles.currentText}>Revenir au stock actuel</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={styles.stats}>
        <Stat label="Produits" value={items.length} color={BrandColors.primary} />
        <Stat label="Stock bas" value={lowCount} color="#B45309" />
        <Stat label="Ruptures" value={zeroCount} color={BrandColors.danger} />
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color={BrandColors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Rechercher un produit ou SKU"
          placeholderTextColor={BrandColors.textMuted}
          style={styles.search}
        />
      </View>

      {loading ? <ActivityIndicator color={BrandColors.primary} style={styles.loader} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!loading && !error && filtered.length === 0 ? (
        <Text style={styles.empty}>Aucun produit dans cette sélection.</Text>
      ) : null}

      {filtered.map((item) => {
        const zero = Number(item.stock) <= 0;
        return (
          <View key={item.id} style={styles.card}>
            <View style={[styles.stockMark, zero ? styles.zeroMark : item.lowStock ? styles.lowMark : styles.okMark]}>
              <Ionicons
                name={zero ? 'close' : item.lowStock ? 'warning-outline' : 'checkmark'}
                size={16}
                color={zero ? BrandColors.danger : item.lowStock ? '#B45309' : BrandColors.ok}
              />
            </View>
            <View style={styles.cardInfo}>
              <Text style={styles.productName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.productMeta} numberOfLines={1}>
                {item.department?.name ?? '—'}
                {item.sku ? ` · ${item.sku}` : ''}
              </Text>
            </View>
            <View style={styles.quantity}>
              <Text style={[styles.stockValue, zero && styles.dangerText]}>
                {formatQuantity(item.stock)}
              </Text>
              <Text style={styles.minimum}>min {formatQuantity(item.stockMin)}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  headerInfo: { flex: 1 },
  title: { color: BrandColors.text, fontSize: 17, fontWeight: '800' },
  subtitle: { color: BrandColors.textMuted, fontSize: 11, marginTop: 2 },
  filterButton: {
    width: 42,
    height: 38,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: BrandColors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterButtonActive: { backgroundColor: BrandColors.primary },
  filters: {
    padding: Spacing.three,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BrandColors.border,
    backgroundColor: BrandColors.surfaceSoft,
    gap: 8,
  },
  filterLabel: { color: BrandColors.textMuted, fontSize: 11, fontWeight: '700' },
  chips: { gap: 7 },
  chip: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    backgroundColor: BrandColors.surface,
  },
  chipActive: { backgroundColor: BrandColors.primary, borderColor: BrandColors.primary },
  chipText: { color: BrandColors.text, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  dateRow: { flexDirection: 'row', gap: Spacing.two },
  dateInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 10,
    backgroundColor: BrandColors.surface,
    color: BrandColors.text,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  applyButton: { borderRadius: 10, backgroundColor: BrandColors.primary, justifyContent: 'center', paddingHorizontal: 12 },
  applyText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  currentText: { color: BrandColors.primary, fontWeight: '700', fontSize: 12 },
  stats: { flexDirection: 'row', gap: Spacing.two },
  stat: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BrandColors.border,
    backgroundColor: BrandColors.surface,
    paddingVertical: 10,
  },
  statValue: { fontSize: 19, fontWeight: '900' },
  statLabel: { color: BrandColors.textMuted, fontSize: 10 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 12,
    paddingHorizontal: 11,
    backgroundColor: BrandColors.surface,
  },
  search: { flex: 1, color: BrandColors.text, paddingVertical: 10 },
  loader: { marginVertical: Spacing.three },
  error: { color: BrandColors.danger, fontWeight: '600' },
  empty: { color: BrandColors.textMuted, textAlign: 'center', paddingVertical: Spacing.four },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: BrandColors.border,
    backgroundColor: BrandColors.surface,
    padding: Spacing.three,
  },
  stockMark: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  zeroMark: { backgroundColor: '#FEE2E2' },
  lowMark: { backgroundColor: '#FEF3C7' },
  okMark: { backgroundColor: '#DCFCE7' },
  cardInfo: { flex: 1 },
  productName: { color: BrandColors.text, fontWeight: '700' },
  productMeta: { color: BrandColors.textMuted, fontSize: 10, marginTop: 2 },
  quantity: { alignItems: 'flex-end' },
  stockValue: { color: BrandColors.text, fontWeight: '900', fontSize: 15 },
  minimum: { color: BrandColors.textMuted, fontSize: 9 },
  dangerText: { color: BrandColors.danger },
});
