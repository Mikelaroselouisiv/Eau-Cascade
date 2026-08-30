import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ModalShell } from '@/components/ModalShell';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { getDepartments, listProductionSessions } from '@/services/api';
import type { Department, ProductionSessionDetail } from '@/types/api';
import { formatDateTime } from '@/utils/datetime';
import { formatQuantity } from '@/utils/quantity';

type Props = {
  companyId: number;
  dateFrom: string;
  dateTo: string;
  refreshKey?: number;
};

function userLabel(user?: { fullName?: string | null; phone?: string | null; email?: string | null } | null) {
  return user?.fullName?.trim() || user?.phone?.trim() || user?.email?.trim() || 'Utilisateur';
}

export function ProductionSessionsPanel({ companyId, dateFrom, dateTo, refreshKey }: Props) {
  const [sessions, setSessions] = useState<ProductionSessionDetail[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const [selected, setSelected] = useState<ProductionSessionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getDepartments(companyId)
      .then((rows) => setDepartments(rows.filter((d) => d.kind === 'PRODUCTION_DISTRIBUTION')))
      .catch(() => setDepartments([]));
  }, [companyId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listProductionSessions({
        companyId,
        dateFrom,
        dateTo,
        departmentId: departmentId ?? undefined,
        take: 80,
      });
      setSessions(rows);
    } catch {
      setError('Impossible de charger les sessions');
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [companyId, dateFrom, dateTo, departmentId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sessions production</Text>
      {departments.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
          <Pressable
            onPress={() => setDepartmentId(null)}
            style={[styles.chip, departmentId == null && styles.chipActive]}>
            <Text style={[styles.chipText, departmentId == null && styles.chipTextActive]}>Tous</Text>
          </Pressable>
          {departments.map((d) => (
            <Pressable
              key={d.id}
              onPress={() => setDepartmentId(d.id)}
              style={[styles.chip, departmentId === d.id && styles.chipActive]}>
              <Text style={[styles.chipText, departmentId === d.id && styles.chipTextActive]}>{d.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {loading ? <ActivityIndicator color={BrandColors.primary} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!loading && !error && sessions.length === 0 ? (
        <Text style={styles.empty}>Aucune session pour ces filtres.</Text>
      ) : null}

      {sessions.map((session) => {
        const used =
          session.status === 'CLOSED' && session.usage?.length
            ? session.usage.reduce((sum, row) => sum + row.usedQty, 0)
            : null;
        return (
          <Pressable key={session.id} style={styles.card} onPress={() => setSelected(session)}>
            <View style={styles.cardTop}>
              <Text style={styles.cardTitle}>{session.department?.name ?? 'Production'}</Text>
              <Text style={styles.status}>{session.status === 'OPEN' ? 'Ouverte' : 'Fermée'}</Text>
            </View>
            <Text style={styles.meta}>
              {userLabel(session.openedBy)} · {formatDateTime(session.openedAt)}
            </Text>
            {used != null ? (
              <Text style={styles.meta}>MP utilisée : {formatQuantity(used)}</Text>
            ) : null}
          </Pressable>
        );
      })}

      <ModalShell
        visible={selected != null}
        onRequestClose={() => setSelected(null)}
        body={
          selected ? (
            <ScrollView contentContainerStyle={styles.detailBody}>
              <Text style={styles.detailTitle}>
                {selected.status === 'OPEN' ? 'Ouverte' : 'Fermée'} · {selected.department?.name}
              </Text>
              <Text style={styles.meta}>Ouverture : {formatDateTime(selected.openedAt)} — {userLabel(selected.openedBy)}</Text>
              <Text style={styles.meta}>
                Fermeture :{' '}
                {selected.closedAt
                  ? `${formatDateTime(selected.closedAt)} — ${userLabel(selected.closedBy)}`
                  : '—'}
              </Text>
              {(selected.usage ?? []).map((row) => (
                <View key={row.productId} style={styles.usageRow}>
                  <Text style={styles.usageName}>{row.name}</Text>
                  <Text style={styles.meta}>
                    Ouvert {formatQuantity(row.openedQty)}
                    {selected.status === 'CLOSED'
                      ? ` · utilisé ${formatQuantity(row.usedQty)} · restant ${formatQuantity(row.remainingQty)}`
                      : ''}
                  </Text>
                </View>
              ))}
            </ScrollView>
          ) : null
        }
        footer={
          <View style={styles.footer}>
            <Pressable style={styles.closeBtn} onPress={() => setSelected(null)}>
              <Text style={styles.closeBtnText}>Fermer</Text>
            </Pressable>
          </View>
        }>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Session production</Text>
          <Pressable onPress={() => setSelected(null)} hitSlop={12}>
            <Ionicons name="close" size={26} color={BrandColors.text} />
          </Pressable>
        </View>
      </ModalShell>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two, marginTop: Spacing.three },
  title: { fontSize: 16, fontWeight: '700', color: BrandColors.text },
  chips: { flexGrow: 0 },
  chip: {
    marginRight: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BrandColors.border,
  },
  chipActive: { backgroundColor: BrandColors.primary, borderColor: BrandColors.primary },
  chipText: { color: BrandColors.text },
  chipTextActive: { color: '#fff', fontWeight: '700' },
  error: { color: '#b91c1c' },
  empty: { color: BrandColors.textMuted },
  card: {
    padding: Spacing.three,
    borderRadius: 12,
    backgroundColor: BrandColors.surface,
    borderWidth: 1,
    borderColor: BrandColors.border,
    gap: 4,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontWeight: '700', color: BrandColors.text },
  status: { color: BrandColors.primary, fontWeight: '600' },
  meta: { color: BrandColors.textMuted, fontSize: 13 },
  detailBody: { padding: Spacing.three, gap: Spacing.two },
  detailTitle: { fontWeight: '700', fontSize: 16, color: BrandColors.text },
  usageRow: { paddingVertical: 6 },
  usageName: { fontWeight: '600', color: BrandColors.text },
  footer: { padding: Spacing.three },
  closeBtn: {
    backgroundColor: BrandColors.primary,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  closeBtnText: { color: '#fff', fontWeight: '700' },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  modalTitle: { fontWeight: '700', fontSize: 16, color: BrandColors.text },
});
