import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
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
import { getDepartments, getUsers, listAuditLogs } from '@/services/api';
import type { AuditLogRow, Department, SessionUser } from '@/types/api';
import { formatDateTime } from '@/utils/datetime';

const TAKE = 25;
const ENTITY_OPTIONS = [
  { id: '', label: 'Toutes' },
  { id: 'Sale', label: 'Ventes' },
  { id: 'RegisterSession', label: 'Caisses' },
  { id: 'Product', label: 'Produits' },
  { id: 'InventorySession', label: 'Inventaire' },
  { id: 'PurchaseOrder', label: 'Achats' },
  { id: 'FinanceEntry', label: 'Finance' },
];

const ACTION_LABELS: Record<string, string> = {
  CREATED: 'Création',
  UPDATED: 'Modification',
  DELETED: 'Suppression',
  OPENED: 'Ouverture',
  CLOSED: 'Fermeture',
  CANCELLED: 'Annulation',
  REFUNDED: 'Remboursement',
  COMPLETED: 'Finalisation',
};

type Props = {
  companyId: number;
  dateFrom: string;
  dateTo: string;
  refreshKey?: number;
};

function userLabel(user?: { fullName?: string | null; phone?: string | null; email?: string | null } | null) {
  return user?.fullName?.trim() || user?.phone?.trim() || user?.email?.trim() || 'Système';
}

function actionLabel(action: string) {
  return ACTION_LABELS[action] ?? action.replaceAll('_', ' ').toLowerCase();
}

export function AuditJournalPanel({ companyId, dateFrom, dateTo, refreshKey }: Props) {
  const [items, setItems] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [users, setUsers] = useState<SessionUser[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [userId, setUserId] = useState<number | null>(null);
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const [entity, setEntity] = useState('');
  const [actionDraft, setActionDraft] = useState('');
  const [action, setAction] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const load = useCallback(
    async (offset = 0) => {
      const append = offset > 0;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await listAuditLogs({
          skip: offset,
          take: TAKE,
          companyId,
          dateFrom,
          dateTo,
          userId: userId ?? undefined,
          departmentId: departmentId ?? undefined,
          entity: entity || undefined,
          action: action || undefined,
        });
        setItems((prev) => (append ? [...prev, ...res.items] : res.items));
        setTotal(res.total);
      } catch {
        if (!append) {
          setItems([]);
          setTotal(0);
        }
        setError('Impossible de charger le journal d’audit.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [action, companyId, dateFrom, dateTo, departmentId, entity, userId],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(0), 0);
    return () => clearTimeout(timer);
  }, [load, refreshKey]);

  function applyAction() {
    setAction(actionDraft.trim());
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Journal d’audit</Text>
          <Text style={styles.subtitle}>{total} action(s) correspondent aux filtres</Text>
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
          <Text style={styles.filterLabel}>Personne</Text>
          <FilterChips
            items={[{ id: '', label: 'Toutes' }, ...users.map((u) => ({ id: u.id, label: userLabel(u) }))]}
            value={userId ?? ''}
            onChange={(value) => setUserId(value === '' ? null : Number(value))}
          />
          <Text style={styles.filterLabel}>Département</Text>
          <FilterChips
            items={[
              { id: '', label: 'Tous' },
              ...departments.map((d) => ({ id: d.id, label: d.name })),
            ]}
            value={departmentId ?? ''}
            onChange={(value) => setDepartmentId(value === '' ? null : Number(value))}
          />
          <Text style={styles.filterLabel}>Type d’action</Text>
          <FilterChips items={ENTITY_OPTIONS} value={entity} onChange={(v) => setEntity(String(v))} />
          <View style={styles.actionRow}>
            <TextInput
              value={actionDraft}
              onChangeText={setActionDraft}
              onSubmitEditing={applyAction}
              placeholder="Action précise : CREATED, CLOSED…"
              placeholderTextColor={BrandColors.textMuted}
              autoCapitalize="characters"
              returnKeyType="search"
              style={styles.actionInput}
            />
            <Pressable style={styles.applyButton} onPress={applyAction}>
              <Ionicons name="search" size={18} color="#fff" />
            </Pressable>
          </View>
        </View>
      ) : null}

      {loading ? <ActivityIndicator color={BrandColors.primary} style={styles.loader} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!loading && !error && items.length === 0 ? (
        <Text style={styles.empty}>Aucune action pour ces filtres.</Text>
      ) : null}

      {items.map((row) => (
        <View key={row.id} style={styles.card}>
          <View style={styles.rail}>
            <View style={styles.dot} />
            <View style={styles.railLine} />
          </View>
          <View style={styles.cardBody}>
            <View style={styles.cardTop}>
              <Text style={styles.action}>{actionLabel(row.action)}</Text>
              <Text style={styles.date}>{formatDateTime(row.createdAt)}</Text>
            </View>
            <Text style={styles.actor}>{userLabel(row.user)}</Text>
            <View style={styles.entityRow}>
              <Text style={styles.entity}>{row.entity}</Text>
              {row.entityId ? <Text style={styles.reference}>#{row.entityId}</Text> : null}
            </View>
          </View>
        </View>
      ))}

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

function FilterChips({
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
  actionRow: { flexDirection: 'row', gap: Spacing.two, marginTop: 4 },
  actionInput: {
    flex: 1,
    backgroundColor: BrandColors.surface,
    color: BrandColors.text,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 11,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  applyButton: {
    width: 44,
    borderRadius: 11,
    backgroundColor: BrandColors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loader: { marginVertical: Spacing.four },
  error: { color: BrandColors.danger, fontWeight: '600' },
  empty: { color: BrandColors.textMuted, paddingVertical: Spacing.four, textAlign: 'center' },
  card: {
    flexDirection: 'row',
    backgroundColor: BrandColors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: Spacing.three,
  },
  rail: { width: 18, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: BrandColors.primary, marginTop: 5 },
  railLine: { width: 2, flex: 1, minHeight: 32, backgroundColor: BrandColors.primarySoft, marginTop: 4 },
  cardBody: { flex: 1, gap: 3 },
  cardTop: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  action: { flex: 1, color: BrandColors.text, fontWeight: '800', textTransform: 'capitalize' },
  date: { color: BrandColors.textMuted, fontSize: 10, textAlign: 'right' },
  actor: { color: BrandColors.text, fontSize: 12, fontWeight: '600' },
  entityRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  entity: { color: BrandColors.textMuted, fontSize: 11 },
  reference: {
    color: BrandColors.primaryHover,
    backgroundColor: BrandColors.primarySoft,
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
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
