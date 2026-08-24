import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ModalShell } from '@/components/ModalShell';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import {
  cancelInventorySession,
  completeInventorySession,
  createInventorySession,
  getDepartments,
  getInventorySession,
  listInventorySessions,
  patchInventoryLine,
} from '@/services/api';
import type {
  Department,
  InventorySessionDetail,
  InventorySessionKind,
  InventorySessionListItem,
} from '@/types/api';
import { formatDateTime } from '@/utils/datetime';
import { formatQuantity } from '@/utils/quantity';

type Props = {
  companyId: number;
  refreshKey?: number;
  onStockChanged: () => void;
};

type QuantityDrafts = Record<number, string>;

const SESSION_KINDS: { id: InventorySessionKind; label: string }[] = [
  { id: 'OPENING', label: 'Ouverture' },
  { id: 'CLOSING', label: 'Fermeture' },
  { id: 'AD_HOC', label: 'Ponctuel' },
];

const kindLabel = (kind?: InventorySessionKind) =>
  SESSION_KINDS.find((item) => item.id === kind)?.label ?? 'Ponctuel';

const statusLabel = (status: InventorySessionListItem['status']) => {
  if (status === 'DRAFT') return 'Brouillon';
  if (status === 'COMPLETED') return 'Validée';
  return 'Annulée';
};

function parseQuantity(value: string): number | null | undefined {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function quantityEqual(left: number | null | undefined, right: string | number | null) {
  const normalizedRight = right == null ? null : Number(right);
  return left === normalizedRight;
}

function draftsFromSession(session: InventorySessionDetail): QuantityDrafts {
  return Object.fromEntries(
    session.lines.map((line) => [
      line.id,
      line.countedQty == null ? '' : String(line.countedQty).replace('.', ','),
    ]),
  );
}

export function InventoryPhysicalPanel({ companyId, refreshKey, onStockChanged }: Props) {
  const mountedRef = useRef(true);
  const detailRequestRef = useRef(0);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [sessions, setSessions] = useState<InventorySessionListItem[]>([]);
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const [kind, setKind] = useState<InventorySessionKind>('AD_HOC');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<InventorySessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<QuantityDrafts>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      detailRequestRef.current += 1;
    };
  }, []);

  const loadOverview = useCallback(async (cancelled?: () => boolean) => {
    setLoading(true);
    setError(null);
    try {
      const [departmentRows, sessionRows] = await Promise.all([
        getDepartments(companyId),
        listInventorySessions({ companyId }),
      ]);
      if (cancelled?.() || !mountedRef.current) return;
      setDepartments(departmentRows);
      setSessions(sessionRows);
      setDepartmentId((current) =>
        current != null && departmentRows.some((row) => row.id === current)
          ? current
          : (departmentRows[0]?.id ?? null),
      );
    } catch {
      if (cancelled?.() || !mountedRef.current) return;
      setDepartments([]);
      setSessions([]);
      setDepartmentId(null);
      setError('Impossible de charger les inventaires physiques.');
    } finally {
      if (!cancelled?.() && mountedRef.current) setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => void loadOverview(() => cancelled), 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loadOverview, refreshKey]);

  const selectedDraft = useMemo(
    () =>
      sessions.find(
        (session) => session.departmentId === departmentId && session.status === 'DRAFT',
      ) ?? null,
    [departmentId, sessions],
  );

  const openSession = useCallback(async (sessionId: number) => {
    const requestId = ++detailRequestRef.current;
    setSelectedId(sessionId);
    setDetail(null);
    setDrafts({});
    setDetailError(null);
    setDetailLoading(true);
    try {
      const row = await getInventorySession(sessionId);
      if (!mountedRef.current || detailRequestRef.current !== requestId) return;
      setDetail(row);
      setDrafts(draftsFromSession(row));
    } catch {
      if (!mountedRef.current || detailRequestRef.current !== requestId) return;
      setDetailError('Impossible de charger le détail de cette session.');
    } finally {
      if (mountedRef.current && detailRequestRef.current === requestId) setDetailLoading(false);
    }
  }, []);

  const closeDetail = useCallback(() => {
    detailRequestRef.current += 1;
    setSelectedId(null);
    setDetail(null);
    setDrafts({});
    setDetailError(null);
    setDetailLoading(false);
  }, []);

  const startOrResume = async () => {
    if (departmentId == null || actionBusy) return;
    if (selectedDraft) {
      await openSession(selectedDraft.id);
      return;
    }
    setActionBusy(true);
    setError(null);
    try {
      const created = await createInventorySession({
        departmentId,
        kind,
        onlyPositiveStock: false,
      });
      if (!mountedRef.current) return;
      setSessions((current) => [
        {
          ...created,
          _count: { lines: created.lines.length },
        },
        ...current,
      ]);
      setSelectedId(created.id);
      setDetail(created);
      setDrafts(draftsFromSession(created));
    } catch {
      if (mountedRef.current) setError('Impossible de démarrer la session d’inventaire.');
    } finally {
      if (mountedRef.current) setActionBusy(false);
    }
  };

  const changedLines = useMemo(() => {
    if (!detail) return [];
    return detail.lines.filter((line) => {
      const parsed = parseQuantity(drafts[line.id] ?? '');
      return parsed !== undefined && !quantityEqual(parsed, line.countedQty);
    });
  }, [detail, drafts]);

  const hasInvalidQuantity = useMemo(
    () =>
      detail?.lines.some((line) => parseQuantity(drafts[line.id] ?? '') === undefined) ?? false,
    [detail, drafts],
  );

  const countedCount = useMemo(
    () =>
      detail?.lines.filter((line) => {
        const parsed = parseQuantity(drafts[line.id] ?? '');
        return parsed !== null && parsed !== undefined;
      }).length ?? 0,
    [detail, drafts],
  );

  const saveChanges = useCallback(async (): Promise<InventorySessionDetail | null> => {
    if (!detail || detail.status !== 'DRAFT' || saving) return detail;
    if (hasInvalidQuantity) {
      setDetailError('Corrigez les quantités invalides avant de sauvegarder.');
      return null;
    }
    if (changedLines.length === 0) return detail;

    setSaving(true);
    setDetailError(null);
    try {
      for (const line of changedLines) {
        await patchInventoryLine(detail.id, line.id, {
          countedQty: parseQuantity(drafts[line.id] ?? '') ?? null,
        });
      }
      const updated = await getInventorySession(detail.id);
      if (!mountedRef.current) return null;
      setDetail(updated);
      setDrafts(draftsFromSession(updated));
      return updated;
    } catch {
      if (mountedRef.current) setDetailError('Impossible de sauvegarder les quantités.');
      return null;
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [changedLines, detail, drafts, hasInvalidQuantity, saving]);

  const completeConfirmed = async () => {
    if (!detail || saving) return;
    const saved = await saveChanges();
    if (!saved || !mountedRef.current) return;
    setSaving(true);
    setDetailError(null);
    try {
      const completed = await completeInventorySession(saved.id);
      if (!mountedRef.current) return;
      setDetail(completed);
      setDrafts(draftsFromSession(completed));
      await loadOverview();
      if (!mountedRef.current) return;
      onStockChanged();
    } catch {
      if (mountedRef.current) {
        setDetailError('La validation a échoué. Le stock n’a pas été modifié.');
      }
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  const requestComplete = () => {
    if (!detail || countedCount !== detail.lines.length || hasInvalidQuantity) return;
    Alert.alert(
      'Valider l’inventaire ?',
      'Cette action appliquera les quantités comptées au stock et ne pourra pas être annulée.',
      [
        { text: 'Retour', style: 'cancel' },
        { text: 'Valider', style: 'destructive', onPress: () => void completeConfirmed() },
      ],
    );
  };

  const cancelConfirmed = async () => {
    if (!detail || saving) return;
    setSaving(true);
    setDetailError(null);
    try {
      const cancelled = await cancelInventorySession(detail.id);
      if (!mountedRef.current) return;
      setDetail(cancelled);
      setDrafts(draftsFromSession(cancelled));
      await loadOverview();
    } catch {
      if (mountedRef.current) setDetailError('Impossible d’annuler cette session.');
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  const requestCancel = () => {
    Alert.alert(
      'Annuler la session ?',
      'Les comptages saisis seront abandonnés. Le stock ne sera pas modifié.',
      [
        { text: 'Retour', style: 'cancel' },
        { text: 'Annuler la session', style: 'destructive', onPress: () => void cancelConfirmed() },
      ],
    );
  };

  const isDraft = detail?.status === 'DRAFT';
  const completionReady = detail != null && countedCount === detail.lines.length && !hasInvalidQuantity;

  return (
    <View style={styles.container}>
      <View>
        <Text style={styles.title}>Inventaire physique</Text>
        <Text style={styles.subtitle}>Comptez le stock réel d’un département.</Text>
      </View>

      {loading ? (
        <View style={styles.stateBox}>
          <ActivityIndicator color={BrandColors.primary} />
          <Text style={styles.stateText}>Chargement des inventaires…</Text>
        </View>
      ) : null}

      {!loading && error ? (
        <View style={styles.errorBox}>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={() => void loadOverview()}>
            <Text style={styles.retryText}>Réessayer</Text>
          </Pressable>
        </View>
      ) : null}

      {!loading && !error && departments.length === 0 ? (
        <Text style={styles.empty}>Aucun département disponible pour cette entreprise.</Text>
      ) : null}

      {!loading && !error && departments.length > 0 ? (
        <>
          <View style={styles.selectorBox}>
            <Text style={styles.fieldLabel}>Département</Text>
            <ChipRow
              items={departments.map((department) => ({
                id: department.id,
                label: department.name,
              }))}
              value={departmentId}
              onChange={(value) => setDepartmentId(Number(value))}
            />
            <Text style={styles.fieldLabel}>Type de session</Text>
            <ChipRow items={SESSION_KINDS} value={kind} onChange={(value) => setKind(value as InventorySessionKind)} />
            {selectedDraft ? (
              <Text style={styles.draftHint}>
                Un brouillon existe déjà pour ce département. Il sera repris.
              </Text>
            ) : null}
            <Pressable
              style={[styles.primaryButton, actionBusy && styles.buttonDisabled]}
              disabled={actionBusy || departmentId == null}
              onPress={() => void startOrResume()}>
              {actionBusy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons
                    name={selectedDraft ? 'play-forward-outline' : 'add-circle-outline'}
                    size={19}
                    color="#fff"
                  />
                  <Text style={styles.primaryButtonText}>
                    {selectedDraft ? 'Reprendre l’inventaire' : 'Démarrer l’inventaire'}
                  </Text>
                </>
              )}
            </Pressable>
          </View>

          <View style={styles.historyHeader}>
            <Text style={styles.historyTitle}>Historique</Text>
            <Text style={styles.historyCount}>{sessions.length} session(s)</Text>
          </View>
          {sessions.length === 0 ? (
            <Text style={styles.empty}>Aucune session d’inventaire.</Text>
          ) : (
            sessions.map((session) => (
              <Pressable
                key={session.id}
                style={styles.historyCard}
                onPress={() => void openSession(session.id)}>
                <View style={styles.historyMain}>
                  <Text style={styles.historyDepartment} numberOfLines={1}>
                    {session.department.name}
                  </Text>
                  <Text style={styles.historyMeta}>
                    {kindLabel(session.kind)} · {formatDateTime(session.createdAt)} ·{' '}
                    {session._count.lines} ligne(s)
                  </Text>
                </View>
                <StatusBadge status={session.status} />
                <Ionicons name="chevron-forward" size={17} color={BrandColors.textMuted} />
              </Pressable>
            ))
          )}
        </>
      ) : null}

      <ModalShell
        visible={selectedId != null}
        onRequestClose={saving ? () => undefined : closeDetail}
        body={
          detailLoading ? (
            <View style={styles.modalState}>
              <ActivityIndicator color={BrandColors.primary} />
              <Text style={styles.stateText}>Chargement de la session…</Text>
            </View>
          ) : detailError && !detail ? (
            <View style={styles.modalState}>
              <Text style={styles.error}>{detailError}</Text>
              <Pressable
                style={styles.retryButton}
                onPress={() => selectedId != null && void openSession(selectedId)}>
                <Text style={styles.retryText}>Réessayer</Text>
              </Pressable>
            </View>
          ) : detail ? (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.detailBody}>
              <View style={styles.detailSummary}>
                <View style={styles.summaryTop}>
                  <StatusBadge status={detail.status} />
                  <Text style={styles.summaryKind}>{kindLabel(detail.kind)}</Text>
                </View>
                <Text style={styles.summaryDate}>Créée le {formatDateTime(detail.createdAt)}</Text>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${
                          detail.lines.length === 0
                            ? 100
                            : Math.round((countedCount / detail.lines.length) * 100)
                        }%`,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.progressText}>
                  {countedCount} / {detail.lines.length} produit(s) compté(s)
                </Text>
              </View>

              {detailError ? <Text style={styles.error}>{detailError}</Text> : null}
              {detail.lines.length === 0 ? (
                <Text style={styles.empty}>Aucun produit dans ce département.</Text>
              ) : null}

              {detail.lines.map((line) => {
                const systemQty = Number(line.systemQtyAtOpen);
                const parsed = parseQuantity(drafts[line.id] ?? '');
                const shownCounted =
                  isDraft ? parsed : line.countedQty == null ? null : Number(line.countedQty);
                const variance =
                  shownCounted == null || shownCounted === undefined
                    ? null
                    : shownCounted - systemQty;
                const invalid = parsed === undefined;
                return (
                  <View key={line.id} style={styles.lineCard}>
                    <View style={styles.lineHeading}>
                      <View style={styles.lineNameWrap}>
                        <Text style={styles.lineName}>{line.product.name}</Text>
                        {line.product.sku ? (
                          <Text style={styles.lineSku}>SKU {line.product.sku}</Text>
                        ) : null}
                      </View>
                      <View style={styles.systemBlock}>
                        <Text style={styles.metricLabel}>Système</Text>
                        <Text style={styles.systemValue}>
                          {formatQuantity(line.systemQtyAtOpen)}
                        </Text>
                      </View>
                    </View>
                    {isDraft ? (
                      <View style={styles.inputRow}>
                        <View style={styles.inputWrap}>
                          <Text style={styles.metricLabel}>Quantité comptée</Text>
                          <TextInput
                            value={drafts[line.id] ?? ''}
                            onChangeText={(value) =>
                              setDrafts((current) => ({ ...current, [line.id]: value }))
                            }
                            editable={!saving}
                            keyboardType="decimal-pad"
                            placeholder="0"
                            placeholderTextColor={BrandColors.textMuted}
                            selectTextOnFocus
                            style={[styles.quantityInput, invalid && styles.quantityInputInvalid]}
                          />
                        </View>
                        <Variance value={variance} />
                      </View>
                    ) : (
                      <View style={styles.readonlyMetrics}>
                        <View>
                          <Text style={styles.metricLabel}>Compté</Text>
                          <Text style={styles.countedValue}>
                            {formatQuantity(line.countedQty)}
                          </Text>
                        </View>
                        <Variance value={variance} />
                      </View>
                    )}
                    {invalid ? (
                      <Text style={styles.inputError}>Saisissez un nombre positif ou zéro.</Text>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
          ) : null
        }
        footer={
          detail ? (
            <View style={styles.modalFooter}>
              {isDraft ? (
                <>
                  <View style={styles.footerActions}>
                    <Pressable
                      style={[styles.secondaryButton, saving && styles.buttonDisabled]}
                      disabled={saving}
                      onPress={() => void saveChanges()}>
                      <Text style={styles.secondaryButtonText}>
                        {saving ? 'Traitement…' : `Sauvegarder${changedLines.length ? ` (${changedLines.length})` : ''}`}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.validateButton,
                        (!completionReady || saving) && styles.buttonDisabled,
                      ]}
                      disabled={!completionReady || saving}
                      onPress={requestComplete}>
                      <Text style={styles.validateButtonText}>Valider le stock</Text>
                    </Pressable>
                  </View>
                  {!completionReady ? (
                    <Text style={styles.footerHint}>
                      Toutes les lignes doivent être comptées avant validation.
                    </Text>
                  ) : null}
                  <Pressable disabled={saving} onPress={requestCancel}>
                    <Text style={styles.cancelText}>Annuler cette session</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable style={styles.primaryButton} onPress={closeDetail}>
                  <Text style={styles.primaryButtonText}>Fermer</Text>
                </Pressable>
              )}
            </View>
          ) : null
        }>
        <View style={styles.modalHeader}>
          <View style={styles.modalTitleWrap}>
            <Text style={styles.modalEyebrow}>INVENTAIRE PHYSIQUE</Text>
            <Text style={styles.modalTitle} numberOfLines={1}>
              {detail?.department.name ?? 'Session'}
            </Text>
          </View>
          <Pressable disabled={saving} onPress={closeDetail} hitSlop={12}>
            <Ionicons name="close" size={27} color={BrandColors.text} />
          </Pressable>
        </View>
      </ModalShell>
    </View>
  );
}

function ChipRow({
  items,
  value,
  onChange,
}: {
  items: { id: string | number; label: string }[];
  value: string | number | null;
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

function StatusBadge({ status }: { status: InventorySessionListItem['status'] }) {
  return (
    <View
      style={[
        styles.statusBadge,
        status === 'DRAFT'
          ? styles.statusDraft
          : status === 'COMPLETED'
            ? styles.statusCompleted
            : styles.statusCancelled,
      ]}>
      <Text
        style={[
          styles.statusText,
          status === 'DRAFT'
            ? styles.statusDraftText
            : status === 'COMPLETED'
              ? styles.statusCompletedText
              : styles.statusCancelledText,
        ]}>
        {statusLabel(status)}
      </Text>
    </View>
  );
}

function Variance({ value }: { value: number | null }) {
  const warning = value != null && value !== 0;
  return (
    <View style={styles.varianceBlock}>
      <Text style={styles.metricLabel}>Écart</Text>
      <Text style={[styles.varianceValue, warning && styles.varianceWarning]}>
        {value == null ? '—' : `${value > 0 ? '+' : ''}${formatQuantity(value)}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.three },
  title: { color: BrandColors.text, fontSize: 18, fontWeight: '800' },
  subtitle: { color: BrandColors.textMuted, fontSize: 12, marginTop: 3 },
  stateBox: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.four,
  },
  stateText: { color: BrandColors.textMuted, fontSize: 12 },
  errorBox: {
    padding: Spacing.three,
    borderRadius: 13,
    backgroundColor: '#FEF2F2',
    gap: Spacing.two,
  },
  error: { color: BrandColors.danger, fontSize: 12, fontWeight: '600' },
  retryButton: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 10 },
  retryText: { color: BrandColors.primary, fontWeight: '800', fontSize: 12 },
  empty: {
    color: BrandColors.textMuted,
    textAlign: 'center',
    paddingVertical: Spacing.four,
    fontSize: 12,
  },
  selectorBox: {
    backgroundColor: BrandColors.surfaceSoft,
    borderWidth: 1,
    borderColor: BrandColors.border,
    borderRadius: 15,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  fieldLabel: {
    color: BrandColors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginTop: 2,
  },
  chips: { gap: 7, paddingRight: Spacing.two },
  chip: {
    maxWidth: 190,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    backgroundColor: BrandColors.surface,
  },
  chipActive: { backgroundColor: BrandColors.primary, borderColor: BrandColors.primary },
  chipText: { color: BrandColors.text, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: '#fff' },
  draftHint: { color: BrandColors.primaryHover, fontSize: 12, fontWeight: '600' },
  primaryButton: {
    minHeight: 46,
    backgroundColor: BrandColors.primary,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: Spacing.three,
  },
  primaryButtonText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  buttonDisabled: { opacity: 0.48 },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.one,
  },
  historyTitle: { color: BrandColors.text, fontSize: 15, fontWeight: '800' },
  historyCount: { color: BrandColors.textMuted, fontSize: 11 },
  historyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    backgroundColor: BrandColors.surface,
    borderWidth: 1,
    borderColor: BrandColors.border,
    borderRadius: 13,
  },
  historyMain: { flex: 1, minWidth: 0 },
  historyDepartment: { color: BrandColors.text, fontSize: 14, fontWeight: '800' },
  historyMeta: { color: BrandColors.textMuted, fontSize: 11, marginTop: 3 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999 },
  statusDraft: { backgroundColor: BrandColors.primarySoft },
  statusCompleted: { backgroundColor: '#DCFCE7' },
  statusCancelled: { backgroundColor: BrandColors.bgDeep },
  statusText: { fontSize: 10, fontWeight: '800' },
  statusDraftText: { color: BrandColors.primaryHover },
  statusCompletedText: { color: BrandColors.ok },
  statusCancelledText: { color: BrandColors.textMuted },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: 1,
    borderBottomColor: BrandColors.border,
  },
  modalTitleWrap: { flex: 1, minWidth: 0 },
  modalEyebrow: { color: BrandColors.textMuted, fontSize: 10, fontWeight: '800' },
  modalTitle: { color: BrandColors.text, fontSize: 20, fontWeight: '800', marginTop: 2 },
  modalState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  detailBody: { padding: Spacing.three, gap: Spacing.three },
  detailSummary: {
    backgroundColor: BrandColors.surfaceSoft,
    borderWidth: 1,
    borderColor: BrandColors.border,
    borderRadius: 14,
    padding: Spacing.three,
    gap: 7,
  },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  summaryKind: { color: BrandColors.text, fontWeight: '700', fontSize: 12 },
  summaryDate: { color: BrandColors.textMuted, fontSize: 11 },
  progressTrack: {
    height: 7,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: BrandColors.bgDeep,
    marginTop: 3,
  },
  progressFill: { height: '100%', backgroundColor: BrandColors.primary, borderRadius: 999 },
  progressText: { color: BrandColors.textMuted, fontSize: 11, fontWeight: '600' },
  lineCard: {
    backgroundColor: BrandColors.surface,
    borderWidth: 1,
    borderColor: BrandColors.border,
    borderRadius: 14,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  lineHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  lineNameWrap: { flex: 1 },
  lineName: { color: BrandColors.text, fontWeight: '800', fontSize: 14 },
  lineSku: { color: BrandColors.textMuted, fontSize: 10, marginTop: 3 },
  systemBlock: { alignItems: 'flex-end' },
  metricLabel: {
    color: BrandColors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  systemValue: { color: BrandColors.text, fontSize: 16, fontWeight: '800', marginTop: 3 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.three },
  inputWrap: { flex: 1, gap: 5 },
  quantityInput: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 10,
    backgroundColor: BrandColors.surfaceSoft,
    color: BrandColors.text,
    fontWeight: '800',
    fontSize: 17,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  quantityInputInvalid: { borderColor: BrandColors.danger, backgroundColor: '#FEF2F2' },
  inputError: { color: BrandColors.danger, fontSize: 10, marginTop: -6 },
  varianceBlock: { minWidth: 76, alignItems: 'flex-end', paddingBottom: 9 },
  varianceValue: { color: BrandColors.ok, fontSize: 16, fontWeight: '800', marginTop: 5 },
  varianceWarning: { color: BrandColors.danger },
  readonlyMetrics: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: BrandColors.border,
    paddingTop: Spacing.two,
  },
  countedValue: { color: BrandColors.text, fontSize: 16, fontWeight: '800', marginTop: 4 },
  modalFooter: {
    padding: Spacing.three,
    gap: Spacing.two,
    backgroundColor: BrandColors.bg,
    borderTopWidth: 1,
    borderTopColor: BrandColors.border,
  },
  footerActions: { flexDirection: 'row', gap: Spacing.two },
  secondaryButton: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: BrandColors.primary,
    borderRadius: 11,
    paddingHorizontal: Spacing.two,
  },
  secondaryButtonText: { color: BrandColors.primary, fontSize: 12, fontWeight: '800' },
  validateButton: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: BrandColors.ok,
    paddingHorizontal: Spacing.two,
  },
  validateButtonText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  footerHint: { color: BrandColors.textMuted, textAlign: 'center', fontSize: 10 },
  cancelText: {
    color: BrandColors.danger,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 5,
  },
});
