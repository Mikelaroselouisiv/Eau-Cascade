import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MoneyText } from '@/components/MoneyText';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import type { SalesSeriesPoint } from '@/utils/dashboard-series';
import { formatMoneyAmount } from '@/utils/datetime';

type Props = {
  rows: SalesSeriesPoint[];
  grain: 'day' | 'month';
};

const PLOT_HEIGHT = 168;
const DOT = 8;

function deltaTone(current: number, previous: number | null) {
  if (previous == null) return 'flat' as const;
  if (current > previous) return 'up' as const;
  if (current < previous) return 'down' as const;
  return 'flat' as const;
}

export function RevenueTrendChart({ rows, grain }: Props) {
  const [width, setWidth] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const stats = useMemo(() => {
    if (rows.length === 0) return null;
    let min = rows[0];
    let max = rows[0];
    for (const row of rows) {
      if (row.sales < min.sales) min = row;
      if (row.sales > max.sales) max = row;
    }
    return { min, max };
  }, [rows]);

  const selected = useMemo(() => {
    if (rows.length === 0) return null;
    const match = selectedKey ? rows.find((row) => row.key === selectedKey) : null;
    return match ?? rows[rows.length - 1];
  }, [rows, selectedKey]);

  const selectedIndex = selected ? rows.findIndex((row) => row.key === selected.key) : -1;
  const previous = selectedIndex > 0 ? rows[selectedIndex - 1] : null;
  const movement = selected ? deltaTone(selected.sales, previous?.sales ?? null) : 'flat';

  const layout = useMemo(() => {
    if (width < 8 || rows.length === 0) return [];
    const values = rows.map((row) => row.sales);
    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    const span = dataMax - dataMin;
    const pad = span > 0 ? span * 0.18 : Math.max(dataMax * 0.12, 1);
    const yMin = Math.max(0, dataMin - pad);
    const yMax = dataMax + pad;
    const inner = Math.max(width - DOT, 1);
    return rows.map((row, index) => {
      const t = rows.length === 1 ? 0.5 : index / (rows.length - 1);
      const x = DOT / 2 + t * inner;
      const ratio = (row.sales - yMin) / (yMax - yMin || 1);
      const y = PLOT_HEIGHT - ratio * PLOT_HEIGHT;
      return { ...row, x, y };
    });
  }, [rows, width]);

  const xLabels = useMemo(() => {
    if (rows.length <= 4) return rows;
    const last = rows.length - 1;
    const picks = [0, Math.round(last / 3), Math.round((last * 2) / 3), last];
    return [...new Set(picks)].map((index) => rows[index]);
  }, [rows]);

  if (rows.length === 0) {
    return <Text style={styles.empty}>Aucun chiffre d’affaires sur la période</Text>;
  }

  const maxSales = Math.max(...rows.map((row) => row.sales), 0);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{grain === 'day' ? 'CA par jour' : 'CA par mois'}</Text>

      <View style={styles.plot} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {layout.length > 1
          ? layout.slice(1).map((point, index) => {
              const prev = layout[index];
              const dx = point.x - prev.x;
              const dy = point.y - prev.y;
              const length = Math.sqrt(dx * dx + dy * dy);
              const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
              const up = point.sales >= prev.sales;
              return (
                <View
                  key={`seg-${point.key}`}
                  pointerEvents="none"
                  style={[
                    styles.segment,
                    {
                      width: length,
                      left: (prev.x + point.x) / 2 - length / 2,
                      top: (prev.y + point.y) / 2 - 1.5,
                      backgroundColor: up ? BrandColors.ok : BrandColors.danger,
                      transform: [{ rotate: `${angle}deg` }],
                    },
                  ]}
                />
              );
            })
          : null}

        {layout.map((point) => {
          const active = selected?.key === point.key;
          return (
            <View
              key={`dot-${point.key}`}
              pointerEvents="none"
              style={[
                styles.dot,
                {
                  left: point.x - DOT / 2,
                  top: point.y - DOT / 2,
                  backgroundColor:
                    point.key === stats?.max.key
                      ? BrandColors.ok
                      : point.key === stats?.min.key && stats.min.key !== stats.max.key
                        ? BrandColors.danger
                        : BrandColors.primary,
                  transform: [{ scale: active ? 1.35 : 1 }],
                },
              ]}
            />
          );
        })}

        {layout.map((point) => (
          <Pressable
            key={`hit-${point.key}`}
            accessibilityRole="button"
            accessibilityLabel={`${point.label} ${formatMoneyAmount(point.sales)} HTG`}
            onPress={() => setSelectedKey(point.key)}
            style={[
              styles.hit,
              {
                left: Math.max(0, point.x - Math.max(18, width / rows.length / 2)),
                width: Math.max(36, width / rows.length),
              },
            ]}
          />
        ))}
      </View>

      <View style={styles.xRow}>
        {xLabels.map((row) => (
          <Text key={row.key} style={styles.xLabel} numberOfLines={1}>
            {row.label}
          </Text>
        ))}
      </View>

      {selected ? (
        <View style={styles.selected}>
          <View style={styles.selectedText}>
            <Text style={styles.selectedLabel}>{selected.label}</Text>
            <MoneyText value={selected.sales} style={styles.selectedValue} />
          </View>
          <View
            style={[
              styles.deltaBadge,
              movement === 'up' && styles.deltaUp,
              movement === 'down' && styles.deltaDown,
            ]}>
            <Ionicons
              name={
                movement === 'up'
                  ? 'caret-up'
                  : movement === 'down'
                    ? 'caret-down'
                    : 'remove-outline'
              }
              size={14}
              color={
                movement === 'up'
                  ? BrandColors.ok
                  : movement === 'down'
                    ? BrandColors.danger
                    : BrandColors.textMuted
              }
            />
            <Text
              style={[
                styles.deltaText,
                movement === 'up' && { color: BrandColors.ok },
                movement === 'down' && { color: BrandColors.danger },
              ]}>
              {previous == null
                ? '—'
                : `${selected.sales - previous.sales >= 0 ? '+' : ''}${formatMoneyAmount(selected.sales - previous.sales)}`}
            </Text>
          </View>
        </View>
      ) : null}

      {stats && stats.min.key !== stats.max.key ? (
        <View style={styles.extremes}>
          <Text style={styles.extreme}>
            Plus fort · {stats.max.label} · {formatMoneyAmount(stats.max.sales)}
          </Text>
          <Text style={styles.extreme}>
            Plus faible · {stats.min.label} · {formatMoneyAmount(stats.min.sales)}
          </Text>
        </View>
      ) : null}

      <View style={styles.list}>
        {rows.map((row, index) => {
          const prev = index > 0 ? rows[index - 1] : null;
          const tone = deltaTone(row.sales, prev?.sales ?? null);
          const active = selected?.key === row.key;
          const barWidth =
            maxSales > 0 ? `${Math.max(4, (row.sales / maxSales) * 100)}%` : '4%';
          return (
            <Pressable
              key={row.key}
              onPress={() => setSelectedKey(row.key)}
              style={[styles.listRow, active && styles.listRowActive]}>
              <View style={styles.listHead}>
                <Text style={styles.listLabel}>{row.label}</Text>
                <View style={styles.listValueRow}>
                  <Ionicons
                    name={
                      tone === 'up' ? 'caret-up' : tone === 'down' ? 'caret-down' : 'remove-outline'
                    }
                    size={12}
                    color={
                      tone === 'up'
                        ? BrandColors.ok
                        : tone === 'down'
                          ? BrandColors.danger
                          : BrandColors.textMuted
                    }
                  />
                  <MoneyText value={row.sales} style={styles.listValue} />
                </View>
              </View>
              <View style={styles.track}>
                <View
                  style={[
                    styles.bar,
                    {
                      width: barWidth as `${number}%`,
                      backgroundColor:
                        tone === 'down'
                          ? BrandColors.danger
                          : tone === 'up'
                            ? BrandColors.ok
                            : BrandColors.primary,
                    },
                  ]}
                />
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: BrandColors.surface,
    borderWidth: 1,
    borderColor: BrandColors.border,
    borderRadius: 16,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  title: { color: BrandColors.text, fontSize: 15, fontWeight: '800' },
  empty: { color: BrandColors.textMuted },
  plot: { height: PLOT_HEIGHT, position: 'relative', marginTop: 4 },
  segment: {
    position: 'absolute',
    height: 3,
    borderRadius: 2,
  },
  dot: {
    position: 'absolute',
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 2,
    borderColor: '#fff',
  },
  hit: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
  xRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 4 },
  xLabel: {
    color: BrandColors.textMuted,
    fontSize: 10,
    fontWeight: '700',
  },
  selected: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingTop: Spacing.two,
    borderTopWidth: 1,
    borderTopColor: BrandColors.border,
  },
  selectedText: { flex: 1, gap: 2 },
  selectedLabel: { color: BrandColors.textMuted, fontSize: 12, fontWeight: '700' },
  selectedValue: { color: BrandColors.text, fontSize: 20, fontWeight: '800' },
  deltaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: BrandColors.bgDeep,
  },
  deltaUp: { backgroundColor: '#DCFCE7' },
  deltaDown: { backgroundColor: '#FEE2E2' },
  deltaText: { color: BrandColors.textMuted, fontSize: 12, fontWeight: '800' },
  extremes: { gap: 2 },
  extreme: { color: BrandColors.textMuted, fontSize: 11, fontWeight: '600' },
  list: { gap: 8, marginTop: 4 },
  listRow: { gap: 4, paddingVertical: 4, paddingHorizontal: 4, borderRadius: 8 },
  listRowActive: { backgroundColor: BrandColors.primarySoft },
  listHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  listLabel: { color: BrandColors.text, fontSize: 12, fontWeight: '700' },
  listValueRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  listValue: { color: BrandColors.text, fontSize: 12, fontWeight: '800' },
  track: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: BrandColors.bgDeep,
  },
  bar: { height: '100%', borderRadius: 3 },
});
