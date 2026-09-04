import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ModalShell } from '@/components/ModalShell';
import { MoneyText } from '@/components/MoneyText';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { getDepartments, getUsers, listRegisterSessions } from '@/services/api';
import type { Department, InventoryLineRow, RegisterSessionDetail, SessionUser } from '@/types/api';
import { formatDateTime } from '@/utils/datetime';
import { formatQuantity } from '@/utils/quantity';
import {
  listSalesInWindow,
  takingsBySession,
  type SessionTakings,
} from '@/utils/register-session-takings';

type Props = {
  companyId: number;
  dateFrom: string;
  dateTo: string;
  refreshKey?: number;
};

type StatusFilter = '' | 'OPEN' | 'CLOSED';

const PAGE_SIZE = 12;
const MAX_TAKE = 200;

function userLabel(user?: { fullName?: string | null; phone?: string | null; email?: string | null } | null) {
  return user?.fullName?.trim() || user?.phone?.trim() || user?.email?.trim() || 'Utilisateur inconnu';
}

function lineQty(line: InventoryLineRow): number {
  return Number(line.countedQty ?? line.systemQtyAtOpen) || 0;
}

function soldArticleRows(session: RegisterSessionDetail) {
  const rows = new Map<
    number,
    { productId: number; name: string; opened: number | null; closed: number | null }
  >();
  for (const line of session.openingInventorySession?.lines ?? []) {
    rows.set(line.productId, {
      productId: line.productId,
      name: line.product.name,
      opened: lineQty(line),
      closed: null,
    });
  }
  for (const line of session.closingInventorySession?.lines ?? []) {
    const prev = rows.get(line.productId);
    const closed = lineQty(line);
    if (prev) prev.closed = closed;
    else {
      rows.set(line.productId, {
        productId: line.productId,
        name: line.product.name,
        opened: null,
        closed,
      });
    }
  }
  return [...rows.values()]
    .map((row) => ({
      ...row,
      sold: row.opened != null && row.closed != null ? row.opened - row.closed : null,
    }))
    .filter((row) => Math.abs(row.sold ?? 0) > 1e-9)
    .sort((a, b) => Math.abs(b.sold ?? 0) - Math.abs(a.sold ?? 0));
}

export function RegisterSessionsPanel({ companyId, dateFrom, dateTo, refreshKey }: Props) {
  const [sessions, setSessions] = useState<RegisterSessionDetail[]>([]);
  const [users, setUsers] = useState<SessionUser[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [userId, setUserId] = useState<number | null>(null);
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const [status, setStatus] = useState<StatusFilter>('');
  const [selected, setSelected] = useState<RegisterSessionDetail | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [takingsById, setTakingsById] = useState<Map<number, SessionTakings>>(new Map());
  const [takingsLoading, setTakingsLoading] = useState(false);

  useEffect(() => {
    void Promise.all([getUsers(), getDepartments(companyId)])
      .then(([userRows, deptRows]) => {
        setUserId(null);
        setDepartmentId(null);
        setUsers(userRows.filter((u) => u.companyId === companyId || u.companyId == null));
        setDepartments(deptRows);
      })
      .catch(() => {
        setUsers([]);
        setDepartments([]);
      });
  }, [companyId]);

  const load = useCallback(async (currentCount = 0) => {
    const append = currentCount > 0;
    const take = Math.min(MAX_TAKE, currentCount + PAGE_SIZE);
    if (append) setLoadingMore(true);
    else {
      setLoading(true);
      setTakingsById(new Map());
      setTakingsLoading(true);
    }
    setError(null);
    try {
      const rows = await listRegisterSessions({
        companyId,
        dateFrom,
        dateTo,
        openedById: userId ?? undefined,
        departmentId: departmentId ?? undefined,
        status: status || undefined,
        sortBy: 'openedAt',
        sortDir: 'desc',
        take,
      });
      setSessions(rows);
      setHasMore(rows.length === take && take < MAX_TAKE);
      if (rows.length === 0) {
        setTakingsById(new Map());
        setTakingsLoading(false);
      } else {
        setTakingsLoading(true);
        const nowIso = new Date().toISOString();
        const createdFrom = rows.reduce(
          (min, row) => (row.openedAt < min ? row.openedAt : min),
          rows[0].openedAt,
        );
        const createdTo = rows.reduce((max, row) => {
          const end = row.closedAt ?? nowIso;
          return end > max ? end : max;
        }, rows[0].closedAt ?? nowIso);
        const departmentIds = [...new Set(rows.map((row) => row.departmentId))];
        try {
          const sales = await listSalesInWindow({
            companyId,
            departmentIds,
            createdFrom,
            createdTo,
          });
          setTakingsById(takingsBySession(rows, sales));
        } catch {
          if (!append) setTakingsById(new Map());
        } finally {
          setTakingsLoading(false);
        }
      }
    } catch {
      if (!append) {
        setSessions([]);
        setHasMore(false);
        setTakingsById(new Map());
      }
      setError('Impossible de charger les sessions de caisse.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [companyId, dateFrom, dateTo, departmentId, status, userId]);

  useEffect(() => {
    const timer = setTimeout(() => void load(0), 0);
    return () => clearTimeout(timer);
  }, [load, refreshKey]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Sessions de caisse</Text>
          <Text style={styles.subtitle}>{sessions.length} session(s)</Text>
        </View>
        <Pressable
          style={[styles.filterButton, filtersOpen && styles.filterButtonActive]}
          onPress={() => setFiltersOpen((v) => !v)}>
          <Ionicons
            name="options-outline"
            size={18}
            color={filtersOpen ? '#fff' : BrandColors.primary}
          />
          <Text style={[styles.filterButtonText, filtersOpen && styles.filterButtonTextActive]}>
            Filtres
          </Text>
        </Pressable>
      </View>

      {filtersOpen ? (
        <View style={styles.filters}>
          <Text style={styles.filterLabel}>Statut</Text>
          <ChipRow
            items={[
              { id: '', label: 'Toutes' },
              { id: 'OPEN', label: 'Ouvertes' },
              { id: 'CLOSED', label: 'Fermées' },
            ]}
            value={status}
            onChange={(value) => setStatus(value as StatusFilter)}
          />
          <Text style={styles.filterLabel}>Personne</Text>
          <ChipRow
            items={[{ id: '', label: 'Toutes' }, ...users.map((u) => ({ id: u.id, label: userLabel(u) }))]}
            value={userId ?? ''}
            onChange={(value) => setUserId(value === '' ? null : Number(value))}
          />
          <Text style={styles.filterLabel}>Département</Text>
          <ChipRow
            items={[
              { id: '', label: 'Tous' },
              ...departments.map((d) => ({ id: d.id, label: d.name })),
            ]}
            value={departmentId ?? ''}
            onChange={(value) => setDepartmentId(value === '' ? null : Number(value))}
          />
        </View>
      ) : null}

      {loading && sessions.length === 0 ? (
        <ActivityIndicator color={BrandColors.primary} style={styles.loader} />
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!loading && !error && sessions.length === 0 ? (
        <Text style={styles.empty}>Aucune session pour ces filtres.</Text>
      ) : null}

      {sessions.map((session) => {
        const isOpen = session.status === 'OPEN';
        const takings = takingsById.get(session.id);
        return (
          <Pressable key={session.id} style={styles.card} onPress={() => setSelected(session)}>
            <View style={styles.cardTop}>
              <View style={styles.registerIcon}>
                <Ionicons name="storefront-outline" size={18} color={BrandColors.primary} />
              </View>
              <View style={styles.cardHeading}>
                <Text style={styles.cardTitle}>{session.register.code}</Text>
                <Text style={styles.cardMeta} numberOfLines={1}>
                  {session.department.name} · {userLabel(session.openedBy)}
                </Text>
              </View>
              <View style={[styles.statusBadge, isOpen ? styles.openBadge : styles.closedBadge]}>
                <Text style={[styles.statusText, isOpen ? styles.openText : styles.closedText]}>
                  {isOpen ? 'Ouverte' : 'Fermée'}
                </Text>
              </View>
            </View>
            <View style={styles.timeline}>
              <View style={styles.timeBlock}>
                <Text style={styles.timeLabel}>Ouverture</Text>
                <Text style={styles.timeValue}>{formatDateTime(session.openedAt)}</Text>
              </View>
              <Ionicons name="arrow-forward" size={16} color={BrandColors.textMuted} />
              <View style={styles.timeBlock}>
                <Text style={styles.timeLabel}>Fermeture</Text>
                <Text style={styles.timeValue}>
                  {session.closedAt ? formatDateTime(session.closedAt) : 'En cours'}
                </Text>
              </View>
            </View>
            <View style={styles.cardCashGrid}>
              {takingsLoading && !takings ? (
                <ActivityIndicator color={BrandColors.primary} />
              ) : (
                <>
                  <CardCashCell label="CA" value={takings?.total ?? 0} />
                  <CardCashCell label="Espèces" value={takings?.cash ?? 0} />
                  <CardCashCell label="Banque" value={takings?.bank ?? 0} />
                </>
              )}
            </View>
          </Pressable>
        );
      })}

      {hasMore ? (
        <Pressable
          style={[styles.loadMore, (loadingMore || loading) && styles.loadMoreDisabled]}
          disabled={loadingMore || loading}
          onPress={() => void load(sessions.length)}>
          {loadingMore ? (
            <ActivityIndicator color={BrandColors.primary} />
          ) : (
            <Text style={styles.loadMoreText}>Charger plus</Text>
          )}
        </Pressable>
      ) : null}

      <ModalShell
        visible={selected != null}
        onRequestClose={() => setSelected(null)}
        body={
          selected ? (
            <View style={styles.detailRoot}>
              <View style={styles.cashPinned}>
                <View style={styles.detailStatusRow}>
                  <View
                    style={[
                      styles.statusBadge,
                      selected.status === 'OPEN' ? styles.openBadge : styles.closedBadge,
                    ]}>
                    <Text
                      style={[
                        styles.statusText,
                        selected.status === 'OPEN' ? styles.openText : styles.closedText,
                      ]}>
                      {selected.status === 'OPEN' ? 'Ouverte' : 'Fermée'}
                    </Text>
                  </View>
                  <Text style={styles.detailDepartment}>{selected.department.name}</Text>
                </View>
                <Text style={styles.cashPinnedTitle}>Encaissements</Text>
                {takingsLoading && !takingsById.has(selected.id) ? (
                  <ActivityIndicator color={BrandColors.primary} />
                ) : (
                  <View style={styles.amountGrid}>
                    <AmountCell label="CA" value={takingsById.get(selected.id)?.total ?? 0} />
                    <AmountCell label="Espèces" value={takingsById.get(selected.id)?.cash ?? 0} />
                    <AmountCell label="Banque" value={takingsById.get(selected.id)?.bank ?? 0} />
                  </View>
                )}
              </View>
              <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailBody}>
                <Text style={styles.detailSection}>Tiroir</Text>
                <View style={styles.amountGrid}>
                  <AmountCell label="Fond initial" value={selected.openingCashAmount} />
                  <AmountCell label="Attendu" value={selected.closingCashExpected} />
                  <AmountCell label="Compté" value={selected.closingCashCounted} />
                  <AmountCell label="Écart" value={selected.cashVariance} warning />
                </View>
                <DetailLine label="Ouverte par" value={userLabel(selected.openedBy)} />
                <DetailLine label="Date d’ouverture" value={formatDateTime(selected.openedAt)} />
                <DetailLine
                  label="Fermée par"
                  value={selected.closedAt ? userLabel(selected.closedBy) : '—'}
                />
                <DetailLine
                  label="Date de fermeture"
                  value={selected.closedAt ? formatDateTime(selected.closedAt) : 'En cours'}
                />
                {selected.status === 'CLOSED' ? (
                  <SoldArticlesBlock session={selected} />
                ) : null}
              </ScrollView>
            </View>
          ) : null
        }
        footer={
          <View style={styles.detailFooter}>
            <Pressable style={styles.closeButton} onPress={() => setSelected(null)}>
              <Text style={styles.closeButtonText}>Fermer</Text>
            </Pressable>
          </View>
        }>
        <View style={styles.modalHeader}>
          <View>
            <Text style={styles.modalEyebrow}>SESSION DE CAISSE</Text>
            <Text style={styles.modalTitle}>{selected?.register.code ?? ''}</Text>
          </View>
          <Pressable onPress={() => setSelected(null)} hitSlop={12}>
            <Ionicons name="close" size={26} color={BrandColors.text} />
          </Pressable>
        </View>
      </ModalShell>
    </View>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailLine}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function CardCashCell({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string | number | null;
  warning?: boolean;
}) {
  const amount = value == null ? null : Number(value);
  const isWarning = warning && amount != null && amount !== 0;
  return (
    <View style={styles.cardCashCell}>
      <Text style={styles.cashLabel}>{label}</Text>
      <MoneyText
        value={amount}
        style={[styles.cashValue, isWarning && styles.cashValueWarning]}
      />
    </View>
  );
}

function SoldArticlesBlock({ session }: { session: RegisterSessionDetail }) {
  const rows = soldArticleRows(session);
  const totalSold = rows.reduce((sum, row) => sum + Math.max(0, row.sold ?? 0), 0);
  return (
    <View style={styles.soldBlock}>
      <Text style={styles.detailSection}>Articles écoulés</Text>
      {rows.length === 0 ? (
        <Text style={styles.soldEmpty}>Aucun article écoulé</Text>
      ) : (
        <>
          <View style={styles.soldHead}>
            <Text style={[styles.soldColName, styles.soldHeadText]}>Article</Text>
            <Text style={[styles.soldColQty, styles.soldHeadText]}>Ouvert</Text>
            <Text style={[styles.soldColQty, styles.soldHeadText]}>Fermé</Text>
            <Text style={[styles.soldColQty, styles.soldHeadText]}>Écoulé</Text>
          </View>
          {rows.map((row) => (
            <View key={row.productId} style={styles.soldRow}>
              <Text style={styles.soldColName} numberOfLines={2}>
                {row.name}
              </Text>
              <Text style={styles.soldColQty}>{row.opened == null ? '—' : formatQuantity(row.opened)}</Text>
              <Text style={styles.soldColQty}>{row.closed == null ? '—' : formatQuantity(row.closed)}</Text>
              <Text
                style={[
                  styles.soldColQty,
                  styles.soldQty,
                  (row.sold ?? 0) < 0 && styles.cashValueWarning,
                ]}>
                {row.sold == null ? '—' : formatQuantity(row.sold)}
              </Text>
            </View>
          ))}
          <View style={styles.soldTotal}>
            <Text style={styles.soldTotalLabel}>Total écoulé</Text>
            <Text style={styles.soldTotalValue}>{formatQuantity(totalSold)}</Text>
          </View>
        </>
      )}
    </View>
  );
}

function AmountCell({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string | number | null;
  warning?: boolean;
}) {
  const amount = value == null ? null : Number(value);
  const isWarning = warning && amount != null && amount !== 0;
  return (
    <View style={styles.amountCell}>
      <Text style={styles.amountLabel}>{label}</Text>
      <MoneyText
        value={amount}
        style={[styles.amountValue, isWarning && styles.cashValueWarning]}
      />
    </View>
  );
}

function ChipRow({
  items,
  value,
  onChange,
}: {
  items: { id: string | number; label: string }[];
  value: string | number;
  onChange: (value: string | number) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0 }}
      contentContainerStyle={styles.chips}>
      {items.map((item) => {
        const active = item.id === value;
        return (
          <Pressable
            key={String(item.id)}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => onChange(item.id)}>
            <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  headerText: { flex: 1 },
  title: { color: BrandColors.text, fontSize: 17, fontWeight: '800' },
  subtitle: { color: BrandColors.textMuted, fontSize: 12, marginTop: 2 },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: BrandColors.primary,
  },
  filterButtonActive: { backgroundColor: BrandColors.primary },
  filterButtonText: { color: BrandColors.primary, fontWeight: '700', fontSize: 12 },
  filterButtonTextActive: { color: '#fff' },
  filters: {
    backgroundColor: BrandColors.surfaceSoft,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: Spacing.three,
    gap: 7,
  },
  filterLabel: { color: BrandColors.textMuted, fontSize: 11, fontWeight: '700', marginTop: 2 },
  chips: { gap: 7, paddingRight: Spacing.two },
  chip: {
    maxWidth: 180,
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
  loader: { marginVertical: Spacing.four },
  loadMore: {
    borderWidth: 1,
    borderColor: BrandColors.primary,
    borderRadius: 12,
    alignItems: 'center',
    paddingVertical: 12,
  },
  loadMoreDisabled: { opacity: 0.55 },
  loadMoreText: { color: BrandColors.primary, fontWeight: '800' },
  error: { color: BrandColors.danger, fontWeight: '600' },
  empty: { color: BrandColors.textMuted, paddingVertical: Spacing.four, textAlign: 'center' },
  card: {
    backgroundColor: BrandColors.surface,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  registerIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: BrandColors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeading: { flex: 1 },
  cardTitle: { color: BrandColors.text, fontWeight: '800', fontSize: 15 },
  cardMeta: { color: BrandColors.textMuted, fontSize: 12, marginTop: 2 },
  statusBadge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  openBadge: { backgroundColor: '#DCFCE7' },
  closedBadge: { backgroundColor: BrandColors.bgDeep },
  statusText: { fontSize: 11, fontWeight: '800' },
  openText: { color: BrandColors.ok },
  closedText: { color: BrandColors.textMuted },
  timeline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timeBlock: { flex: 1 },
  timeLabel: { color: BrandColors.textMuted, fontSize: 10, textTransform: 'uppercase' },
  timeValue: { color: BrandColors.text, fontSize: 12, fontWeight: '600', marginTop: 2 },
  cardCashGrid: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: BrandColors.border,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
  cardCashCell: { flex: 1, gap: 2 },
  cashLabel: { color: BrandColors.textMuted, fontSize: 11 },
  cashValue: { color: BrandColors.text, fontWeight: '800', fontSize: 13 },
  cashValueWarning: { color: BrandColors.danger },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: 1,
    borderBottomColor: BrandColors.border,
  },
  modalEyebrow: { color: BrandColors.textMuted, fontSize: 10, fontWeight: '800' },
  modalTitle: { color: BrandColors.text, fontSize: 20, fontWeight: '800', marginTop: 2 },
  detailRoot: { flex: 1 },
  cashPinned: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
    gap: Spacing.two,
    borderBottomWidth: 1,
    borderBottomColor: BrandColors.border,
    backgroundColor: BrandColors.surfaceSoft,
  },
  cashPinnedTitle: { color: BrandColors.text, fontSize: 15, fontWeight: '800' },
  detailScroll: { flex: 1 },
  detailBody: { padding: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.five },
  detailStatusRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  detailDepartment: { color: BrandColors.text, fontWeight: '700', flex: 1 },
  detailLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingBottom: Spacing.two,
    borderBottomWidth: 1,
    borderBottomColor: BrandColors.border,
  },
  detailLabel: { color: BrandColors.textMuted, fontSize: 12 },
  detailValue: { color: BrandColors.text, fontSize: 12, fontWeight: '700', textAlign: 'right', flex: 1 },
  detailSection: { color: BrandColors.text, fontSize: 15, fontWeight: '800' },
  amountGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  amountCell: {
    width: '47%',
    flexGrow: 1,
    flexBasis: '47%',
    backgroundColor: BrandColors.surface,
    borderWidth: 1,
    borderColor: BrandColors.border,
    borderRadius: 12,
    padding: Spacing.three,
    gap: 4,
  },
  amountLabel: { color: BrandColors.textMuted, fontSize: 11, fontWeight: '700' },
  amountValue: { color: BrandColors.text, fontSize: 20, fontWeight: '800' },
  soldBlock: { gap: Spacing.two, marginTop: Spacing.two },
  soldEmpty: { color: BrandColors.textMuted, fontSize: 13 },
  soldHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  soldHeadText: { color: BrandColors.textMuted, fontSize: 10, fontWeight: '800' },
  soldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: BrandColors.border,
  },
  soldColName: { flex: 1.4, color: BrandColors.text, fontSize: 13, fontWeight: '600' },
  soldColQty: { flex: 0.8, textAlign: 'right', color: BrandColors.textMuted, fontSize: 12 },
  soldQty: { color: BrandColors.text, fontWeight: '800' },
  soldTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Spacing.two,
  },
  soldTotalLabel: { color: BrandColors.textMuted, fontSize: 12, fontWeight: '700' },
  soldTotalValue: { color: BrandColors.text, fontSize: 16, fontWeight: '800' },
  detailFooter: { padding: Spacing.three, backgroundColor: BrandColors.bg },
  closeButton: {
    backgroundColor: BrandColors.primary,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  closeButtonText: { color: '#fff', fontWeight: '800' },
});
