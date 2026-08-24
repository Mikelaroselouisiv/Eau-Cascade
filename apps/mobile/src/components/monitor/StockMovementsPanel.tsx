import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { PeriodChips } from '@/components/monitor/PeriodChips';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { getInventoryMovements } from '@/services/api';
import type { StockMovementRow } from '@/types/api';
import { formatDateTime, periodDateRange, type PeriodKey } from '@/utils/datetime';
import { formatQuantity } from '@/utils/quantity';

type MovementType = '' | 'IN' | 'OUT' | 'ADJUSTMENT';
type Props = { companyId: number; refreshKey?: number };

const TYPE_META = {
  IN: { label: 'Entrée', icon: 'arrow-down-outline' as const, color: BrandColors.ok, bg: '#DCFCE7' },
  OUT: { label: 'Sortie', icon: 'arrow-up-outline' as const, color: BrandColors.danger, bg: '#FEE2E2' },
  ADJUSTMENT: { label: 'Ajustement', icon: 'swap-vertical-outline' as const, color: '#B45309', bg: '#FEF3C7' },
};

export function StockMovementsPanel({ companyId, refreshKey }: Props) {
  const [period, setPeriod] = useState<PeriodKey>('week');
  const [type, setType] = useState<MovementType>('');
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [items, setItems] = useState<StockMovementRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (offset = 0) => {
      const append = offset > 0;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      const { dateFrom, dateTo } = periodDateRange(period);
      try {
        const result = await getInventoryMovements({
          companyId,
          skip: offset,
          take: 25,
          order,
          dateFrom,
          dateTo,
        });
        setItems((previous) => (append ? [...previous, ...result.items] : result.items));
        setTotal(result.total);
      } catch {
        if (!append) {
          setItems([]);
          setTotal(0);
        }
        setError('Impossible de charger les mouvements.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [companyId, order, period],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(0), 0);
    return () => clearTimeout(timer);
  }, [load, refreshKey]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('fr');
    return items.filter((item) => {
      if (type && item.type !== type) return false;
      if (normalized && !item.product.name.toLocaleLowerCase('fr').includes(normalized)) return false;
      return true;
    });
  }, [items, query, type]);

  const counts = useMemo(
    () => ({
      IN: items.filter((item) => item.type === 'IN').length,
      OUT: items.filter((item) => item.type === 'OUT').length,
      ADJUSTMENT: items.filter((item) => item.type === 'ADJUSTMENT').length,
    }),
    [items],
  );
  const maximum = Math.max(counts.IN, counts.OUT, counts.ADJUSTMENT, 1);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerInfo}>
          <Text style={styles.title}>Mouvements de stock</Text>
          <Text style={styles.subtitle}>{total} mouvement(s) sur la période</Text>
        </View>
        <Pressable
          style={styles.orderButton}
          onPress={() => setOrder((value) => (value === 'desc' ? 'asc' : 'desc'))}>
          <Ionicons name={order === 'desc' ? 'arrow-down' : 'arrow-up'} size={16} color={BrandColors.primary} />
          <Text style={styles.orderText}>{order === 'desc' ? 'Récent' : 'Ancien'}</Text>
        </Pressable>
      </View>

      <PeriodChips value={period} onChange={setPeriod} />

      <View style={styles.chart}>
        {(['IN', 'OUT', 'ADJUSTMENT'] as const).map((key) => {
          const meta = TYPE_META[key];
          return (
            <Pressable
              key={key}
              style={[styles.chartColumn, type === key && styles.chartColumnActive]}
              onPress={() => setType((current) => (current === key ? '' : key))}>
              <Text style={[styles.chartValue, { color: meta.color }]}>{counts[key]}</Text>
              <View style={styles.chartTrack}>
                <View
                  style={[
                    styles.chartBar,
                    {
                      height: `${Math.max(8, (counts[key] / maximum) * 100)}%`,
                      backgroundColor: meta.color,
                    },
                  ]}
                />
              </View>
              <Text style={styles.chartLabel}>{meta.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color={BrandColors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Filtrer par produit"
          placeholderTextColor={BrandColors.textMuted}
          style={styles.search}
        />
        {type ? (
          <Pressable onPress={() => setType('')}>
            <Ionicons name="close-circle" size={19} color={BrandColors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {loading ? <ActivityIndicator color={BrandColors.primary} style={styles.loader} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!loading && !error && filtered.length === 0 ? (
        <Text style={styles.empty}>Aucun mouvement pour ces filtres.</Text>
      ) : null}

      {filtered.map((movement) => {
        const movementType =
          movement.type === 'IN' || movement.type === 'OUT' || movement.type === 'ADJUSTMENT'
            ? movement.type
            : 'ADJUSTMENT';
        const meta = TYPE_META[movementType];
        const user =
          movement.createdBy?.fullName?.trim() || movement.createdBy?.phone || 'Utilisateur inconnu';
        return (
          <View key={movement.id} style={styles.card}>
            <View style={[styles.icon, { backgroundColor: meta.bg }]}>
              <Ionicons name={meta.icon} size={18} color={meta.color} />
            </View>
            <View style={styles.cardInfo}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.productName} numberOfLines={1}>
                  {movement.product.name}
                </Text>
                <Text style={[styles.quantity, { color: meta.color }]}>
                  {formatQuantity(movement.quantity)}
                </Text>
              </View>
              <Text style={styles.meta}>
                {meta.label} · {formatDateTime(movement.createdAt)}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {user}
                {movement.reason ? ` · ${movement.reason === 'Sale' ? 'Vente' : movement.reason}` : ''}
              </Text>
            </View>
          </View>
        );
      })}

      {items.length < total ? (
        <Pressable
          style={[styles.moreButton, loadingMore && styles.disabled]}
          disabled={loadingMore}
          onPress={() => void load(items.length)}>
          {loadingMore ? (
            <ActivityIndicator color={BrandColors.primary} />
          ) : (
            <Text style={styles.moreText}>Charger plus ({items.length}/{total})</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  headerInfo: { flex: 1 },
  title: { color: BrandColors.text, fontSize: 17, fontWeight: '800' },
  subtitle: { color: BrandColors.textMuted, fontSize: 11, marginTop: 2 },
  orderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: BrandColors.primary,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  orderText: { color: BrandColors.primary, fontSize: 11, fontWeight: '700' },
  chart: {
    height: 130,
    flexDirection: 'row',
    gap: Spacing.two,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BrandColors.border,
    backgroundColor: BrandColors.surface,
    padding: Spacing.three,
  },
  chartColumn: { flex: 1, alignItems: 'center', gap: 4, borderRadius: 8 },
  chartColumnActive: { backgroundColor: BrandColors.primarySoft },
  chartValue: { fontWeight: '900', fontSize: 15 },
  chartTrack: {
    flex: 1,
    width: 24,
    borderRadius: 7,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    backgroundColor: BrandColors.bgDeep,
  },
  chartBar: { width: '100%', borderRadius: 7 },
  chartLabel: { color: BrandColors.textMuted, fontSize: 9, fontWeight: '700' },
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
  icon: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  cardInfo: { flex: 1, gap: 2 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  productName: { flex: 1, color: BrandColors.text, fontWeight: '700' },
  quantity: { fontWeight: '900' },
  meta: { color: BrandColors.textMuted, fontSize: 10 },
  moreButton: {
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BrandColors.primary,
    borderRadius: 12,
    paddingVertical: 12,
  },
  moreText: { color: BrandColors.primary, fontWeight: '700' },
  disabled: { opacity: 0.55 },
});
