import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState, type ComponentProps } from 'react';
import { useFocusEffect } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ChipScroll } from '@/components/ChipScroll';
import { GlobalStockPanel } from '@/components/monitor/GlobalStockPanel';
import { InventoryPhysicalPanel } from '@/components/monitor/InventoryPhysicalPanel';
import { StockMovementsPanel } from '@/components/monitor/StockMovementsPanel';
import { RefreshableScroll } from '@/components/RefreshableScroll';
import { Screen } from '@/components/Screen';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useCompanyScope } from '@/hooks/useCompanyScope';
import {
  getInventoryAlerts,
  getZeroStockAlerts,
} from '@/services/api';
import type { Product } from '@/types/api';
import { formatQuantity } from '@/utils/quantity';

type StockView = 'alerts' | 'count' | 'global' | 'movements';

export default function StockMonitorScreen() {
  const { can, canPerm } = useAuth();
  const canSeeGlobalStock =
    can(['ADMIN']) || canPerm('stock.global') || canPerm('reports.view');
  const { companyId, companies, setCompanyId, ready, lockedToSession } = useCompanyScope();
  const [view, setView] = useState<StockView>('alerts');
  const [low, setLow] = useState<Product[]>([]);
  const [zero, setZero] = useState<Product[]>([]);
  const [lowTotal, setLowTotal] = useState(0);
  const [zeroTotal, setZeroTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState<'low' | 'zero' | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (kind?: 'low' | 'zero', offset = 0) => {
    if (!canSeeGlobalStock || companyId == null) return;
    try {
      setError(null);
      if (kind === 'low') {
        setLoadingMore('low');
        const result = await getInventoryAlerts({
          threshold: 5,
          companyId,
          skip: offset,
          take: 15,
        });
        setLow((previous) => [...previous, ...result.items]);
        setLowTotal(result.total);
      } else if (kind === 'zero') {
        setLoadingMore('zero');
        const result = await getZeroStockAlerts({
          companyId,
          skip: offset,
          take: 15,
        });
        setZero((previous) => [...previous, ...result.items]);
        setZeroTotal(result.total);
      } else {
        const [lowRes, zeroRes] = await Promise.all([
          getInventoryAlerts({ threshold: 5, companyId, take: 15 }),
          getZeroStockAlerts({ companyId, take: 15 }),
        ]);
        setLow(lowRes.items);
        setZero(zeroRes.items);
        setLowTotal(lowRes.total);
        setZeroTotal(zeroRes.total);
      }
    } catch {
      if (!kind) {
        setLow([]);
        setZero([]);
        setLowTotal(0);
        setZeroTotal(0);
      }
      setError('Impossible de charger les alertes de stock.');
    } finally {
      setLoadingMore(null);
    }
  }, [canSeeGlobalStock, companyId]);

  useFocusEffect(
    useCallback(() => {
      if (!ready) return;
      void load();
    }, [load, ready]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshKey((value) => value + 1);
    setRefreshing(false);
  }

  async function stockChanged() {
    await load();
    setRefreshKey((value) => value + 1);
  }

  if (!canSeeGlobalStock) {
    return (
      <Screen>
        <View style={styles.blocked}>
          <Text style={styles.blockedText}>
            Stock global réservé aux comptes avec stock.global ou reports.view.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <RefreshableScroll refreshing={refreshing} onRefresh={onRefresh}>
        {!lockedToSession && companies.length > 1 ? (
          <ChipScroll>
            {companies.map((company) => (
              <Pressable
                key={company.id}
                style={[styles.companyChip, companyId === company.id && styles.companyChipActive]}
                onPress={() => setCompanyId(company.id)}>
                <Text
                  style={[
                    styles.companyChipText,
                    companyId === company.id && styles.companyChipTextActive,
                  ]}
                  numberOfLines={1}>
                  {company.name}
                </Text>
              </Pressable>
            ))}
          </ChipScroll>
        ) : null}

        <ChipScroll contentStyle={styles.viewSwitch}>
          <ViewButton
            label="Alertes"
            icon="warning-outline"
            active={view === 'alerts'}
            onPress={() => setView('alerts')}
          />
          <ViewButton
            label="Comptage"
            icon="clipboard-outline"
            active={view === 'count'}
            onPress={() => setView('count')}
          />
          <ViewButton
            label="Inventaire"
            icon="cube-outline"
            active={view === 'global'}
            onPress={() => setView('global')}
          />
          <ViewButton
            label="Mouvements"
            icon="swap-vertical-outline"
            active={view === 'movements'}
            onPress={() => setView('movements')}
          />
        </ChipScroll>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {ready && companyId == null ? (
          <Text style={styles.error}>Aucune entreprise disponible.</Text>
        ) : null}

        {view === 'alerts' ? (
          <>
            <View style={styles.alertSummary}>
              <View style={[styles.summaryCard, styles.summaryLow]}>
                <Ionicons name="warning-outline" size={21} color="#B45309" />
                <Text style={styles.summaryValue}>{lowTotal}</Text>
                <Text style={styles.summaryLabel}>Stock faible</Text>
              </View>
              <View style={[styles.summaryCard, styles.summaryZero]}>
                <Ionicons name="close-circle-outline" size={21} color={BrandColors.danger} />
                <Text style={[styles.summaryValue, { color: BrandColors.danger }]}>{zeroTotal}</Text>
                <Text style={styles.summaryLabel}>Ruptures</Text>
              </View>
            </View>

            <View style={styles.sectionHead}>
              <View>
                <Text style={styles.section}>Alertes stock faible</Text>
                <Text style={styles.sectionHint}>Réapprovisionnement recommandé</Text>
              </View>
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{lowTotal}</Text>
              </View>
            </View>
            {low.length === 0 ? (
              <View style={styles.okState}>
                <Ionicons name="checkmark-circle-outline" size={24} color={BrandColors.ok} />
                <Text style={styles.okText}>Aucun produit sous le minimum.</Text>
              </View>
            ) : (
              <View style={styles.alertGrid}>
                {low.map((product) => {
                  const stock = Number(product.stock);
                  const minimum = Number(product.stockMin);
                  const percentage =
                    minimum > 0 ? Math.min(100, Math.max(4, (stock / minimum) * 100)) : 100;
                  return (
                    <View key={`low-${product.id}`} style={styles.alertCard}>
                      <Text style={styles.productName} numberOfLines={2}>
                        {product.name}
                      </Text>
                      <Text style={styles.productDepartment} numberOfLines={1}>
                        {product.department?.name ?? '—'}
                      </Text>
                      <View style={styles.meter}>
                        <View style={[styles.meterFill, { width: `${percentage}%` }]} />
                      </View>
                      <View style={styles.stockRow}>
                        <Text style={styles.stockText}>Stock {formatQuantity(stock)}</Text>
                        <Text style={styles.minimumText}>min {formatQuantity(minimum)}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
            {low.length < lowTotal ? (
              <LoadMoreButton
                loading={loadingMore === 'low'}
                onPress={() => void load('low', low.length)}
                label="Voir plus d’alertes"
              />
            ) : null}

            <View style={styles.sectionHead}>
              <View>
                <Text style={styles.section}>Produits indisponibles</Text>
                <Text style={styles.sectionHint}>Rupture totale de stock</Text>
              </View>
              <View style={[styles.countBadge, styles.countBadgeDanger]}>
                <Text style={[styles.countBadgeText, { color: BrandColors.danger }]}>{zeroTotal}</Text>
              </View>
            </View>
            {zero.length === 0 ? (
              <View style={styles.okState}>
                <Ionicons name="checkmark-circle-outline" size={24} color={BrandColors.ok} />
                <Text style={styles.okText}>Aucune rupture de stock.</Text>
              </View>
            ) : (
              zero.map((product) => (
                <View key={`zero-${product.id}`} style={styles.zeroRow}>
                  <View style={styles.zeroIcon}>
                    <Ionicons name="close" size={15} color={BrandColors.danger} />
                  </View>
                  <View style={styles.zeroInfo}>
                    <Text style={styles.zeroName} numberOfLines={1}>
                      {product.name}
                    </Text>
                    <Text style={styles.productDepartment}>{product.department?.name ?? '—'}</Text>
                  </View>
                  <Text style={styles.zeroValue}>0</Text>
                </View>
              ))
            )}
            {zero.length < zeroTotal ? (
              <LoadMoreButton
                loading={loadingMore === 'zero'}
                onPress={() => void load('zero', zero.length)}
                label="Voir plus de ruptures"
              />
            ) : null}
          </>
        ) : null}

        {companyId != null && view === 'count' ? (
          <InventoryPhysicalPanel
            companyId={companyId}
            refreshKey={refreshKey}
            onStockChanged={() => void stockChanged()}
          />
        ) : null}

        {companyId != null && view === 'global' ? (
          <GlobalStockPanel companyId={companyId} refreshKey={refreshKey} />
        ) : null}

        {companyId != null && view === 'movements' ? (
          <StockMovementsPanel companyId={companyId} refreshKey={refreshKey} />
        ) : null}
      </RefreshableScroll>
    </Screen>
  );
}

function ViewButton({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.viewButton, active && styles.viewButtonActive]} onPress={onPress}>
      <Ionicons name={icon} size={17} color={active ? '#fff' : BrandColors.textMuted} />
      <Text style={[styles.viewButtonText, active && styles.viewButtonTextActive]}>{label}</Text>
    </Pressable>
  );
}

function LoadMoreButton({
  label,
  loading,
  onPress,
}: {
  label: string;
  loading: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.loadMore, loading && styles.disabled]} disabled={loading} onPress={onPress}>
      {loading ? (
        <ActivityIndicator color={BrandColors.primary} />
      ) : (
        <Text style={styles.loadMoreText}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  blocked: { flex: 1, justifyContent: 'center', padding: Spacing.five },
  blockedText: { textAlign: 'center', color: BrandColors.textMuted },
  companyChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    backgroundColor: BrandColors.surface,
    maxWidth: 200,
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: 'center',
  },
  companyChipActive: { backgroundColor: BrandColors.primary, borderColor: BrandColors.primary },
  companyChipText: { color: BrandColors.text, fontSize: 13, fontWeight: '600' },
  companyChipTextActive: { color: '#fff' },
  viewSwitch: {
    gap: 6,
    padding: 4,
    borderRadius: 14,
    backgroundColor: BrandColors.bgDeep,
  },
  viewButton: {
    minWidth: 100,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  viewButtonActive: { backgroundColor: BrandColors.primary },
  viewButtonText: { color: BrandColors.textMuted, fontSize: 11, fontWeight: '700' },
  viewButtonTextActive: { color: '#fff' },
  error: { color: BrandColors.danger, fontWeight: '600' },
  alertSummary: { flexDirection: 'row', gap: Spacing.two },
  summaryCard: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: Spacing.three,
    gap: 3,
  },
  summaryLow: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  summaryZero: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  summaryValue: { color: '#B45309', fontSize: 24, fontWeight: '900' },
  summaryLabel: { color: BrandColors.textMuted, fontSize: 11, fontWeight: '600' },
  sectionHead: {
    marginTop: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  section: { color: BrandColors.text, fontSize: 16, fontWeight: '800' },
  sectionHint: { color: BrandColors.textMuted, fontSize: 10, marginTop: 2 },
  countBadge: {
    minWidth: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEF3C7',
  },
  countBadgeDanger: { backgroundColor: '#FEE2E2' },
  countBadgeText: { color: '#B45309', fontWeight: '900' },
  okState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    backgroundColor: '#F0FDF4',
    padding: Spacing.three,
  },
  okText: { color: BrandColors.ok, fontWeight: '700', fontSize: 12 },
  alertGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  alertCard: {
    width: '48%',
    flexGrow: 1,
    minHeight: 125,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FDE68A',
    backgroundColor: BrandColors.surface,
    padding: Spacing.three,
    gap: 5,
  },
  productName: { color: BrandColors.text, fontSize: 13, fontWeight: '800', minHeight: 32 },
  productDepartment: { color: BrandColors.textMuted, fontSize: 10 },
  meter: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: BrandColors.bgDeep,
    marginTop: 3,
  },
  meterFill: { height: '100%', borderRadius: 4, backgroundColor: '#F59E0B' },
  stockRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 'auto' },
  stockText: { color: BrandColors.text, fontSize: 11, fontWeight: '800' },
  minimumText: { color: BrandColors.textMuted, fontSize: 10 },
  zeroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: BrandColors.surface,
    padding: Spacing.three,
  },
  zeroIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEE2E2',
  },
  zeroInfo: { flex: 1 },
  zeroName: { color: BrandColors.text, fontWeight: '700' },
  zeroValue: { color: BrandColors.danger, fontSize: 17, fontWeight: '900' },
  loadMore: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BrandColors.primary,
    paddingVertical: 11,
  },
  loadMoreText: { color: BrandColors.primary, fontWeight: '700' },
  disabled: { opacity: 0.55 },
});
