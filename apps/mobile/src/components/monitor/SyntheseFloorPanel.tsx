import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { deliverySaleRef } from '@/components/deliveries/deliveryFiche';
import { MoneyText } from '@/components/MoneyText';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import {
  getDepartments,
  getProducts,
  listDeliveries,
  listProductionSessions,
  listProductionWorkerIssues,
  listRegisterSessions,
} from '@/services/api';
import type {
  Delivery,
  Department,
  Product,
  ProductionSessionDetail,
  ProductionWorkerOutputRow,
  RegisterSessionDetail,
  Sale,
  SessionUser,
} from '@/types/api';
import { formatQuantity } from '@/utils/quantity';
import {
  listSalesInWindow,
  saleBelongsToRegisterSession,
  takingsBySession,
  type SessionTakings,
} from '@/utils/register-session-takings';
import { departmentsForUser, productionPlantsForUser } from '@/utils/user-scope';

type StockTone = 'ok' | 'low' | 'zero' | 'empty';

type StockLine = {
  id: number;
  name: string;
  stock: number;
  tone: 'ok' | 'low' | 'zero';
};

type DeptStock = {
  id: number;
  name: string;
  tone: StockTone;
  zeroCount: number;
  products: StockLine[];
};

type SoldLine = {
  id: number;
  name: string;
  qty: number;
};

type DeptSales = {
  id: number;
  name: string;
  total: number;
  open: boolean;
  cashier?: string;
  registerCode?: string;
  sold: SoldLine[];
};

type FlowGroup = {
  label: string;
  lines: SoldLine[];
};

type PlantFloor = {
  id: number;
  name: string;
  open: boolean;
  opener?: string;
  mp: SoldLine[];
  pf: SoldLine[];
  mpTotal: number;
  pfTotal: number;
};

type Props = {
  companyId: number;
  user: SessionUser | null;
  refreshKey?: number;
  canSeeQueue?: boolean;
  canSeeRegisters?: boolean;
  canSeeStock?: boolean;
  canSeeSales?: boolean;
  canSeeProduction?: boolean;
};

function productDeptId(product: Product): number | null {
  return product.department?.id ?? null;
}

function tracksOnHand(product: Product): boolean {
  if (product.isService) return false;
  if (product.trackStock === false) return false;
  return true;
}

function stockTone(zero: number, low: number, products: number): StockTone {
  if (products === 0) return 'empty';
  if (zero > 0) return 'zero';
  if (low > 0) return 'low';
  return 'ok';
}

function isLowStock(product: Product): boolean {
  const stock = Number(product.stock);
  const min = Number(product.stockMin);
  if (!Number.isFinite(stock) || stock <= 0) return false;
  if (Number.isFinite(min) && min > 0) return stock < min;
  return stock < 5;
}

function userLabel(user?: { fullName?: string | null; phone?: string | null } | null) {
  return user?.fullName?.trim() || user?.phone?.trim() || '';
}

function sortSold(lines: SoldLine[]): SoldLine[] {
  return [...lines].sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, 'fr'));
}

function soldFromRegister(session: RegisterSessionDetail, sales: Sale[]): SoldLine[] {
  const fromApi = sortSold(
    (session.soldProducts ?? [])
      .map((row) => ({
        id: row.productId,
        name: row.name,
        qty: Number(row.deliveredQty) || 0,
      }))
      .filter((row) => row.qty > 0.0001),
  );
  if (fromApi.length) return fromApi;

  const map = new Map<string, SoldLine>();
  for (const sale of sales) {
    if (!saleBelongsToRegisterSession(sale, session)) continue;
    for (const item of sale.items ?? []) {
      const productId = item.product?.id ?? 0;
      const name = item.lineLabel?.trim() || item.product?.name?.trim() || 'Article';
      const key = productId > 0 ? `p-${productId}` : `n-${name}`;
      const current = map.get(key) ?? { id: productId || map.size + 1, name, qty: 0 };
      current.qty += Number(item.quantity) || 0;
      map.set(key, current);
    }
  }
  return sortSold([...map.values()].filter((row) => row.qty > 0.0001));
}

function addIssuedQty(map: Map<number, SoldLine>, productId: number, name: string, qty: number) {
  if (!(qty > 0.0001)) return;
  const current = map.get(productId);
  if (current) current.qty += qty;
  else map.set(productId, { id: productId, name: name.trim() || `#${productId}`, qty });
}

/** MP écoulée = matières premières déclarées données aux ouvriers. */
function productionMpLines(
  session: ProductionSessionDetail,
  declared: ProductionWorkerOutputRow[] = [],
): SoldLine[] {
  const map = new Map<number, SoldLine>();
  if (declared.length) {
    for (const row of declared) {
      addIssuedQty(
        map,
        row.productId,
        row.product?.name ?? `#${row.productId}`,
        Number(row.quantity) || 0,
      );
    }
  } else {
    for (const row of session.rawIssued ?? []) {
      addIssuedQty(map, row.productId, row.name, Number(row.issuedQty) || 0);
    }
    if (map.size === 0) {
      for (const row of session.usage ?? []) {
        addIssuedQty(map, row.productId, row.name, Number(row.usedQty) || 0);
      }
    }
  }
  return sortSold([...map.values()]);
}

function productionPfLines(session: ProductionSessionDetail): SoldLine[] {
  return sortSold(
    (session.outflow ?? [])
      .map((row) => {
        const shipped =
          row.shipped ?? row.toClients + row.toDepartments + (row.toDonations ?? 0);
        return {
          id: row.productId,
          name: row.name,
          qty: shipped,
        };
      })
      .filter((row) => row.qty > 0.0001),
  );
}

export function SyntheseFloorPanel({
  companyId,
  user,
  refreshKey = 0,
  canSeeQueue = true,
  canSeeRegisters = true,
  canSeeStock = true,
  canSeeSales = true,
  canSeeProduction = true,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onSite, setOnSite] = useState<Delivery[]>([]);
  const [onSiteCount, setOnSiteCount] = useState(0);
  const [homeCount, setHomeCount] = useState(0);
  const [stocks, setStocks] = useState<DeptStock[]>([]);
  const [floors, setFloors] = useState<DeptSales[]>([]);
  const [plants, setPlants] = useState<PlantFloor[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [deptRows, pendingOnSite, partialOnSite, pendingHome, partialHome, sessions, prodSessions, products] =
        await Promise.all([
          getDepartments(companyId).catch(() => [] as Department[]),
          canSeeQueue
            ? listDeliveries({
                companyId,
                status: 'PENDING',
                fulfillmentType: 'ON_SITE',
                take: 12,
              }).catch(() => ({ items: [] as Delivery[], total: 0 }))
            : Promise.resolve({ items: [] as Delivery[], total: 0 }),
          canSeeQueue
            ? listDeliveries({
                companyId,
                status: 'PARTIAL',
                fulfillmentType: 'ON_SITE',
                take: 8,
              }).catch(() => ({ items: [] as Delivery[], total: 0 }))
            : Promise.resolve({ items: [] as Delivery[], total: 0 }),
          canSeeQueue
            ? listDeliveries({
                companyId,
                status: 'PENDING',
                fulfillmentType: 'HOME',
                take: 1,
              }).catch(() => ({ items: [] as Delivery[], total: 0 }))
            : Promise.resolve({ items: [] as Delivery[], total: 0 }),
          canSeeQueue
            ? listDeliveries({
                companyId,
                status: 'PARTIAL',
                fulfillmentType: 'HOME',
                take: 1,
              }).catch(() => ({ items: [] as Delivery[], total: 0 }))
            : Promise.resolve({ items: [] as Delivery[], total: 0 }),
          canSeeRegisters
            ? listRegisterSessions({ companyId, status: 'OPEN', take: 50 }).catch(
                () => [] as RegisterSessionDetail[],
              )
            : Promise.resolve([] as RegisterSessionDetail[]),
          canSeeProduction
            ? listProductionSessions({ companyId, status: 'OPEN', take: 50 }).catch(
                () => [] as ProductionSessionDetail[],
              )
            : Promise.resolve([] as ProductionSessionDetail[]),
          canSeeStock ? getProducts().catch(() => [] as Product[]) : Promise.resolve([] as Product[]),
        ]);

      const scopedDepts = departmentsForUser(deptRows, user);
      const allowed = new Set(scopedDepts.map((d) => d.id));

      const queue = [...pendingOnSite.items, ...partialOnSite.items].filter(
        (row) => row.departmentId == null || allowed.has(row.departmentId),
      );
      setOnSite(queue.slice(0, 6));
      setOnSiteCount(pendingOnSite.total + partialOnSite.total);
      setHomeCount(pendingHome.total + partialHome.total);

      const openByDept = new Map<number, RegisterSessionDetail>();
      for (const session of sessions) {
        if (!allowed.has(session.departmentId)) continue;
        const existing = openByDept.get(session.departmentId);
        if (!existing || session.openedAt > existing.openedAt) {
          openByDept.set(session.departmentId, session);
        }
      }

      const openSessions = [...openByDept.values()];
      let takingsById = new Map<number, SessionTakings>();
      let sessionSales: Sale[] = [];
      if (canSeeSales && openSessions.length > 0) {
        const createdFrom = openSessions.reduce(
          (min, session) => (session.openedAt < min ? session.openedAt : min),
          openSessions[0].openedAt,
        );
        try {
          sessionSales = await listSalesInWindow({
            companyId,
            departmentIds: [...new Set(openSessions.map((session) => session.departmentId))],
            createdFrom,
            createdTo: new Date().toISOString(),
          });
          takingsById = takingsBySession(openSessions, sessionSales);
        } catch {
          takingsById = new Map();
          sessionSales = [];
        }
      }

      const floorRows: DeptSales[] = scopedDepts.map((dept) => {
        const open = openByDept.get(dept.id);
        const takings = open ? takingsById.get(open.id) : undefined;
        return {
          id: dept.id,
          name: dept.name,
          total: takings?.total ?? 0,
          open: open != null,
          cashier: open ? userLabel(open.openedBy) : undefined,
          registerCode: open?.register.code,
          sold: open ? soldFromRegister(open, sessionSales) : [],
        };
      });
      floorRows.sort((a, b) => {
        if (a.open !== b.open) return a.open ? -1 : 1;
        return b.total - a.total;
      });
      setFloors(floorRows);

      const plantDepts = productionPlantsForUser(deptRows, user);
      const openPlantByDept = new Map<number, ProductionSessionDetail>();
      for (const session of prodSessions) {
        if (!plantDepts.some((dept) => dept.id === session.departmentId)) continue;
        const existing = openPlantByDept.get(session.departmentId);
        if (!existing || session.openedAt > existing.openedAt) {
          openPlantByDept.set(session.departmentId, session);
        }
      }
      const openPlantIds = [...openPlantByDept.keys()];
      const issuesByDept = new Map<number, ProductionWorkerOutputRow[]>();
      if (canSeeProduction && openPlantIds.length > 0) {
        const issueLists = await Promise.all(
          openPlantIds.map((deptId) =>
            listProductionWorkerIssues({ departmentId: deptId }).catch(
              () => [] as ProductionWorkerOutputRow[],
            ),
          ),
        );
        openPlantIds.forEach((deptId, index) => {
          issuesByDept.set(deptId, issueLists[index] ?? []);
        });
      }

      const plantRows: PlantFloor[] = plantDepts.map((dept) => {
        const open = openPlantByDept.get(dept.id);
        const mp = open ? productionMpLines(open, issuesByDept.get(dept.id) ?? []) : [];
        const pf = open ? productionPfLines(open) : [];
        return {
          id: dept.id,
          name: dept.name,
          open: open != null,
          opener: open ? userLabel(open.openedBy) : undefined,
          mp,
          pf,
          mpTotal: mp.reduce((sum, row) => sum + row.qty, 0),
          pfTotal: pf.reduce((sum, row) => sum + row.qty, 0),
        };
      });
      plantRows.sort((a, b) => {
        if (a.open !== b.open) return a.open ? -1 : 1;
        return b.pfTotal + b.mpTotal - (a.pfTotal + a.mpTotal);
      });
      setPlants(plantRows);

      const byDeptProducts = new Map<number, Product[]>();
      for (const product of products) {
        const deptId = productDeptId(product);
        if (deptId == null || !allowed.has(deptId)) continue;
        if (product.companyId != null && product.companyId !== companyId) continue;
        if (!tracksOnHand(product)) continue;
        const list = byDeptProducts.get(deptId);
        if (list) list.push(product);
        else byDeptProducts.set(deptId, [product]);
      }

      const stockRows: DeptStock[] = scopedDepts.map((dept) => {
        const rows = byDeptProducts.get(dept.id) ?? [];
        const products = rows
          .map((p) => {
            const stock = Number(p.stock) || 0;
            const tone: StockLine['tone'] =
              stock <= 0 ? 'zero' : isLowStock(p) ? 'low' : 'ok';
            return { id: p.id, name: p.name, stock, tone };
          })
          .sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name, 'fr'));
        const zeroCount = products.filter((p) => p.tone === 'zero').length;
        const lowCount = products.filter((p) => p.tone === 'low').length;
        return {
          id: dept.id,
          name: dept.name,
          tone: stockTone(zeroCount, lowCount, products.length),
          zeroCount,
          products,
        };
      });
      stockRows.sort((a, b) => toneRank(a.tone) - toneRank(b.tone) || b.zeroCount - a.zeroCount);
      setStocks(stockRows);
    } catch {
      setError('Impossible de charger le terrain.');
      setOnSite([]);
      setOnSiteCount(0);
      setHomeCount(0);
      setStocks([]);
      setFloors([]);
      setPlants([]);
    } finally {
      setLoading(false);
    }
  }, [canSeeProduction, canSeeQueue, canSeeRegisters, canSeeSales, canSeeStock, companyId, user]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load, refreshKey]);

  const openCount = floors.filter((row) => row.open).length;
  const plantOpenCount = plants.filter((row) => row.open).length;
  const restockCount = stocks.filter((row) => row.tone === 'zero' || row.tone === 'low').length;
  const serveCount = onSiteCount + homeCount;

  if (
    loading &&
    stocks.length === 0 &&
    floors.length === 0 &&
    plants.length === 0 &&
    onSite.length === 0
  ) {
    return <ActivityIndicator color={BrandColors.primary} style={styles.loader} />;
  }

  return (
    <View style={styles.root}>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.pulseRow}>
        <PulseCell
          label="À servir"
          value={serveCount}
          tone={serveCount > 0 ? 'alert' : 'ok'}
        />
        <PulseCell
          label="Ouvertes"
          value={openCount}
          tone={openCount > 0 ? 'ok' : 'idle'}
        />
        <PulseCell
          label="À réappro"
          value={restockCount}
          tone={stocks.some((row) => row.tone === 'zero') ? 'alert' : restockCount > 0 ? 'warn' : 'ok'}
        />
      </View>

      {canSeeQueue ? (
        <View style={[styles.block, serveCount > 0 ? styles.blockAlert : styles.blockOk]}>
          <View style={styles.blockHead}>
            <View style={styles.blockTitleRow}>
              <View style={[styles.dot, serveCount > 0 ? styles.dotAlert : styles.dotOk]} />
              <Text style={styles.blockTitle}>À servir</Text>
            </View>
            <Text style={[styles.blockCount, serveCount > 0 && styles.blockCountAlert]}>
              {serveCount}
            </Text>
          </View>
          <View style={styles.splitRow}>
            <Text style={styles.splitText}>Sur place {onSiteCount}</Text>
            <Text style={styles.splitText}>Domicile {homeCount}</Text>
          </View>
          {onSite.length === 0 ? (
            <Text style={styles.quiet}>File vide</Text>
          ) : (
            onSite.map((row) => (
              <View key={row.id} style={styles.queueRow}>
                <Text style={styles.queueRef}>#{deliverySaleRef(row)}</Text>
                <Text style={styles.queueName} numberOfLines={1}>
                  {row.sale?.clientName?.trim() || 'Client'}
                </Text>
                <Text style={styles.queueDept} numberOfLines={1}>
                  {row.department?.name ?? '—'}
                </Text>
              </View>
            ))
          )}
          <Pressable
            style={styles.linkBtn}
            onPress={() => router.push('/(app)/deliveries/undelivered' as never)}>
            <Text style={styles.linkText}>Livraisons</Text>
            <Ionicons name="chevron-forward" size={16} color={BrandColors.primary} />
          </Pressable>
        </View>
      ) : null}

      {canSeeRegisters || canSeeSales ? (
        <View style={styles.block}>
          <View style={styles.blockHead}>
            <View style={styles.blockTitleRow}>
              <View style={[styles.dot, openCount > 0 ? styles.dotOk : styles.dotIdle]} />
              <Text style={styles.blockTitle}>Caisses</Text>
            </View>
            <Text style={styles.blockMeta}>{openCount} ouverte{openCount > 1 ? 's' : ''}</Text>
          </View>
          {floors.length === 0 ? (
            <Text style={styles.quiet}>Aucun département</Text>
          ) : (
            <View style={styles.sessionList}>
              {floors.map((row) => (
                <SessionMiniCard
                  key={row.id}
                  name={row.name}
                  open={row.open}
                  meta={
                    row.open
                      ? [row.registerCode, row.cashier].filter(Boolean).join(' · ') || 'En vente'
                      : undefined
                  }
                  headerRight={
                    row.open ? <MoneyText value={row.total} style={styles.floorTotal} /> : undefined
                  }
                  lines={row.sold}
                />
              ))}
            </View>
          )}
        </View>
      ) : null}

      {canSeeProduction ? (
        <View style={styles.block}>
          <View style={styles.blockHead}>
            <View style={styles.blockTitleRow}>
              <View style={[styles.dot, plantOpenCount > 0 ? styles.dotOk : styles.dotIdle]} />
              <Text style={styles.blockTitle}>Production</Text>
            </View>
            <Text style={styles.blockMeta}>
              {plantOpenCount} ouverte{plantOpenCount > 1 ? 's' : ''}
            </Text>
          </View>
          {plants.length === 0 ? (
            <Text style={styles.quiet}>Aucune usine</Text>
          ) : (
            <View style={styles.sessionList}>
              {plants.map((row) => (
                <SessionMiniCard
                  key={row.id}
                  name={row.name}
                  open={row.open}
                  meta={row.open ? row.opener || 'En production' : undefined}
                  groups={
                    row.open
                      ? [
                          { label: 'Matière première', lines: row.mp },
                          { label: 'Produit fini', lines: row.pf },
                        ]
                      : undefined
                  }
                />
              ))}
            </View>
          )}
        </View>
      ) : null}

      {canSeeStock ? (
        <View style={styles.block}>
          <View style={styles.blockHead}>
            <View style={styles.blockTitleRow}>
              <View
                style={[
                  styles.dot,
                  stocks.some((row) => row.tone === 'zero')
                    ? styles.dotAlert
                    : stocks.some((row) => row.tone === 'low')
                      ? styles.dotWarn
                      : styles.dotOk,
                ]}
              />
              <Text style={styles.blockTitle}>Stocks</Text>
            </View>
            <Text style={styles.blockMeta}>{restockCount} à réappro</Text>
          </View>
          <View style={styles.stockGrid}>
            {stocks.map((row) => (
              <Pressable
                key={row.id}
                style={[styles.stockCard, stockCardStyle(row.tone)]}
                onPress={() => router.push('/(app)/stock' as never)}>
                <Text style={styles.stockName} numberOfLines={1}>
                  {row.name}
                </Text>
                {row.products.length === 0 ? (
                  <Text style={styles.stockQuiet}>—</Text>
                ) : (
                  row.products.map((item) => (
                    <View key={item.id} style={styles.critRow}>
                      <Text style={styles.critName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text
                        style={[
                          styles.critQty,
                          item.tone === 'zero' && styles.critZero,
                          item.tone === 'low' && styles.critLow,
                        ]}>
                        {formatQuantity(item.stock)}
                      </Text>
                    </View>
                  ))
                )}
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function toneRank(tone: StockTone): number {
  if (tone === 'zero') return 0;
  if (tone === 'low') return 1;
  if (tone === 'empty') return 3;
  return 2;
}

function SessionMiniCard({
  name,
  open,
  meta,
  headerRight,
  lines = [],
  groups,
}: {
  name: string;
  open: boolean;
  meta?: string;
  headerRight?: ReactNode;
  lines?: SoldLine[];
  groups?: FlowGroup[];
}) {
  const sections = groups?.length ? groups : lines.length ? [{ label: '', lines }] : [];
  const hasLines = sections.some((section) => section.lines.length > 0);

  return (
    <View style={[styles.sessionCard, open ? styles.stockOk : styles.stockEmpty]}>
      <View style={styles.sessionHead}>
        <Text style={styles.stockName} numberOfLines={1}>
          {name}
        </Text>
        <View style={[styles.badge, open ? styles.badgeOpen : styles.badgeClosed]}>
          <Text style={[styles.badgeText, open ? styles.badgeOpenText : styles.badgeClosedText]}>
            {open ? 'Ouvert' : 'Fermé'}
          </Text>
        </View>
      </View>
      {open ? (
        <View style={styles.sessionMeta}>
          <Text style={styles.floorHint} numberOfLines={1}>
            {meta || '—'}
          </Text>
          {headerRight}
        </View>
      ) : null}
      {!open ? (
        <Text style={styles.stockQuiet}>—</Text>
      ) : !hasLines ? (
        <Text style={styles.stockQuiet}>Aucun article</Text>
      ) : (
        sections.map((section) => (
          <View key={section.label || 'lines'} style={styles.flowGroup}>
            {section.label ? <Text style={styles.flowLabel}>{section.label}</Text> : null}
            {section.lines.length === 0 ? (
              <Text style={styles.stockQuiet}>0</Text>
            ) : (
              section.lines.map((item) => (
                <View key={item.id} style={styles.critRow}>
                  <Text style={styles.critName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.critQty}>{formatQuantity(item.qty)}</Text>
                </View>
              ))
            )}
          </View>
        ))
      )}
    </View>
  );
}

function stockCardStyle(tone: StockTone) {
  if (tone === 'zero') return styles.stockZero;
  if (tone === 'low') return styles.stockLow;
  if (tone === 'ok') return styles.stockOk;
  return styles.stockEmpty;
}

function PulseCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'ok' | 'warn' | 'alert' | 'idle';
}) {
  return (
    <View
      style={[
        styles.pulse,
        tone === 'alert' && styles.pulseAlert,
        tone === 'warn' && styles.pulseWarn,
        tone === 'ok' && styles.pulseOk,
      ]}>
      <Text
        style={[
          styles.pulseValue,
          tone === 'alert' && styles.textZero,
          tone === 'warn' && styles.textLow,
          tone === 'ok' && styles.textOk,
        ]}>
        {value}
      </Text>
      <Text style={styles.pulseLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: Spacing.three },
  loader: { marginVertical: Spacing.four },
  error: { color: BrandColors.danger, fontWeight: '700' },
  pulseRow: { flexDirection: 'row', gap: Spacing.two },
  pulse: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BrandColors.border,
    backgroundColor: BrandColors.surface,
    paddingVertical: 12,
    gap: 2,
  },
  pulseAlert: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  pulseWarn: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  pulseOk: { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
  pulseValue: { fontSize: 26, fontWeight: '900', color: BrandColors.text },
  pulseLabel: { color: BrandColors.textMuted, fontSize: 11, fontWeight: '700' },
  block: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BrandColors.border,
    backgroundColor: BrandColors.surface,
    padding: Spacing.three,
    gap: 10,
  },
  blockAlert: { backgroundColor: '#FFF7F7', borderColor: '#FECACA' },
  blockOk: { backgroundColor: '#F7FDF9', borderColor: '#BBF7D0' },
  blockHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  blockTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  blockTitle: { color: BrandColors.text, fontSize: 17, fontWeight: '800' },
  blockCount: { color: BrandColors.text, fontSize: 22, fontWeight: '900' },
  blockCountAlert: { color: BrandColors.danger },
  blockMeta: { color: BrandColors.textMuted, fontSize: 12, fontWeight: '700' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotOk: { backgroundColor: BrandColors.ok },
  dotWarn: { backgroundColor: '#D97706' },
  dotAlert: { backgroundColor: BrandColors.danger },
  dotIdle: { backgroundColor: BrandColors.borderStrong },
  splitRow: { flexDirection: 'row', gap: Spacing.three },
  splitText: { color: BrandColors.text, fontSize: 13, fontWeight: '700' },
  quiet: { color: BrandColors.textMuted, fontSize: 13, fontWeight: '600' },
  queueRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  queueRef: { color: BrandColors.text, fontWeight: '900', width: 52 },
  queueName: { flex: 1, color: BrandColors.text, fontWeight: '700', fontSize: 13 },
  queueDept: { maxWidth: 110, color: BrandColors.textMuted, fontSize: 11, textAlign: 'right' },
  linkBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 2 },
  linkText: { color: BrandColors.primary, fontWeight: '800', fontSize: 13 },
  sessionHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sessionMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  flowGroup: { gap: 4, marginTop: 4 },
  flowLabel: { color: BrandColors.textMuted, fontSize: 11, fontWeight: '800' },
  floorHint: { flex: 1, color: BrandColors.textMuted, fontSize: 11 },
  floorTotal: { color: BrandColors.text, fontWeight: '900', fontSize: 13 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeOpen: { backgroundColor: '#DCFCE7' },
  badgeClosed: { backgroundColor: BrandColors.bgDeep },
  badgeText: { fontSize: 10, fontWeight: '800' },
  badgeOpenText: { color: BrandColors.ok },
  badgeClosedText: { color: BrandColors.textMuted },
  sessionList: { gap: Spacing.two },
  stockGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  stockCard: {
    width: '48%',
    flexGrow: 1,
    minHeight: 132,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 5,
  },
  sessionCard: {
    width: '100%',
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 5,
  },
  stockZero: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  stockLow: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  stockOk: { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
  stockEmpty: { backgroundColor: BrandColors.surfaceSoft, borderColor: BrandColors.border },
  stockName: { flex: 1, color: BrandColors.text, fontWeight: '800', fontSize: 14 },
  textZero: { color: BrandColors.danger },
  textLow: { color: '#B45309' },
  textOk: { color: BrandColors.ok },
  stockQuiet: { color: BrandColors.textMuted, fontSize: 11, marginTop: 'auto' },
  critRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  critName: { flex: 1, color: BrandColors.text, fontSize: 12, fontWeight: '600' },
  critQty: { color: BrandColors.text, fontSize: 13, fontWeight: '900' },
  critZero: { color: BrandColors.danger },
  critLow: { color: '#B45309' },
});
