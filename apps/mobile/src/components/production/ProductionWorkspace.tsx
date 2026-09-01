import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ModalShell } from '@/components/ModalShell';
import { makeRefreshControl } from '@/components/RefreshableScroll';
import { Screen } from '@/components/Screen';
import { DeliveryExecuteModal } from '@/components/deliveries/DeliveryExecuteModal';
import { DeliveryFicheCard } from '@/components/deliveries/DeliveryFicheCard';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import {
  claimProductionSession,
  closeProductionSession,
  createInternalTransfer,
  getCompanies,
  getDepartments,
  getProductionCountSheet,
  getProductionSessionContext,
  getProducts,
  listDeliveries,
  listInternalTransfers,
  openProductionSession,
} from '@/services/api';
import { formatApiError } from '@/services/api-errors';
import { getPosDeviceId, getPosDeviceName } from '@/services/pos-device';
import type {
  Delivery,
  Department,
  InternalTransferRow,
  InventoryCountSheetRow,
  Product,
  ProductionSessionContext,
  ProductionSessionDetail,
} from '@/types/api';
import { canEditDeliveryExecutor, departmentsForUser } from '@/utils/user-scope';
import { formatQuantity } from '@/utils/quantity';

type PanelMode = 'open' | 'close' | null;
type Dest = 'ON_SITE' | 'HOME' | 'TRANSFER';

function belongsToPlant(d: Delivery, plantId: number): boolean {
  if (d.departmentId === plantId) return true;
  const ids = (d.items ?? []).map((it) => it.saleItem?.product?.departmentId);
  if (ids.some((id) => id === plantId)) return true;
  if (d.departmentId == null && ids.every((id) => id == null)) return true;
  return false;
}

function sessionHolder(s: ProductionSessionDetail) {
  const who = s.openedBy?.fullName?.trim() || s.openedBy?.phone?.trim() || 'Utilisateur';
  const device = s.openedDeviceName?.trim();
  return device ? `${who} · ${device}` : who;
}

function parseQty(raw: string): number | null {
  const trimmed = raw.trim().replace(/\s/g, '').replace(',', '.');
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function ProductionWorkspace() {
  const { user, canPerm } = useAuth();
  const canOpen = canPerm('production.use');
  const canTransfer = canPerm('transfers.manage');
  const canManageDeliveries = canPerm('deliveries.manage');
  const listCompanyOutgoing = user?.role === 'MANAGER' || user?.role === 'ADMIN';
  const canPrintFiche = canPerm('deliveries.print');
  const canChangeExecutor = canEditDeliveryExecutor(user?.role);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [allDepartments, setAllDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState<number | ''>('');
  const [ctx, setCtx] = useState<ProductionSessionContext>({
    local: null,
    mineElsewhere: null,
    occupancy: null,
  });
  const [countProducts, setCountProducts] = useState<InventoryCountSheetRow[]>([]);
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [panel, setPanel] = useState<PanelMode>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [toDepartmentId, setToDepartmentId] = useState<number | ''>('');
  const [transferQty, setTransferQty] = useState<Record<number, string>>({});
  const [outgoing, setOutgoing] = useState<InternalTransferRow[]>([]);
  const [dest, setDest] = useState<Dest>(canManageDeliveries ? 'ON_SITE' : 'TRANSFER');
  const [fiches, setFiches] = useState<Delivery[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pullRefreshing, setPullRefreshing] = useState(false);

  const session = ctx.local;
  const mineElsewhere = ctx.mineElsewhere;
  const occupancy = ctx.occupancy;
  const productionEnabled = session != null;
  const plants = useMemo(
    () => departments.filter((d) => d.kind === 'PRODUCTION_DISTRIBUTION'),
    [departments],
  );
  const scopedDepts = useMemo(() => allDepartments, [allDepartments]);
  const linesReady = useMemo(
    () => countProducts.every((p) => parseQty(counts[p.id] ?? '') !== null),
    [countProducts, counts],
  );

  const refresh = useCallback(async (deptId: number) => {
    const deviceId = await getPosDeviceId();
    const next = await getProductionSessionContext({ deviceId, departmentId: deptId });
    setCtx(next);
    const sheet = await getProductionCountSheet(deptId);
    setCountProducts(sheet.products);
    const nextCounts: Record<number, string> = {};
    for (const p of sheet.products) nextCounts[p.id] = String(p.stock);
    setCounts(nextCounts);
  }, []);

  const reloadFiches = useCallback(async (deptId: number, nextDest: Dest) => {
    if (nextDest === 'TRANSFER') {
      setFiches([]);
      return;
    }
    try {
      const res =
        nextDest === 'HOME'
          ? await listDeliveries({
              ...(user?.companyId != null ? { companyId: user.companyId } : {}),
              fulfillmentType: 'HOME',
              take: 100,
            })
          : await listDeliveries({ departmentId: deptId, fulfillmentType: nextDest, take: 100 });
      const rows = res.items.filter((d) => d.status !== 'DELIVERED');
      setFiches(nextDest === 'HOME' ? rows : rows.filter((d) => belongsToPlant(d, deptId)));
    } catch {
      setFiches([]);
    }
  }, [user?.companyId]);

  const outgoingQuery = useCallback(
    (deptId: number) => {
      if (listCompanyOutgoing) {
        return user?.companyId != null ? { companyId: user.companyId } : {};
      }
      return { fromDepartmentId: deptId };
    },
    [listCompanyOutgoing, user?.companyId],
  );

  const reloadWorkspace = useCallback(
    async (deptId: number, nextDest: Dest = dest) => {
      await refresh(deptId);
      const [prods, out] = await Promise.all([
        getProducts(deptId)
          .then((rows) => rows.filter((p) => p.nature !== 'RAW_MATERIAL'))
          .catch(() => [] as Product[]),
        listInternalTransfers(outgoingQuery(deptId)).catch(() => [] as InternalTransferRow[]),
      ]);
      setProducts(prods);
      setOutgoing(out);
      await reloadFiches(deptId, nextDest);
    },
    [dest, refresh, reloadFiches, outgoingQuery],
  );

  useEffect(() => {
    const companyId = user?.companyId;
    void (async () => {
      try {
        const companies = await getCompanies();
        const cid = companyId ?? companies[0]?.id;
        if (cid == null) return;
        const depts = await getDepartments(cid);
        setAllDepartments(depts);
        const scoped = departmentsForUser(depts, user);
        setDepartments(scoped);
        const firstPlant = scoped.find((d) => d.kind === 'PRODUCTION_DISTRIBUTION');
        setDepartmentId((prev) =>
          prev !== '' && scoped.some((d) => d.id === prev) ? prev : (firstPlant?.id ?? ''),
        );
      } catch {
        setAllDepartments([]);
        setDepartments([]);
      }
    })();
  }, [user, user?.companyId]);

  useEffect(() => {
    if (departmentId === '') return;
    void refresh(departmentId).catch((e) => setStatus(formatApiError(e, 'Chargement impossible')));
    void getProducts(departmentId)
      .then((rows) => setProducts(rows.filter((p) => p.nature !== 'RAW_MATERIAL')))
      .catch(() => setProducts([]));
    void listInternalTransfers(outgoingQuery(departmentId))
      .then(setOutgoing)
      .catch(() => setOutgoing([]));
  }, [departmentId, refresh, outgoingQuery]);

  useEffect(() => {
    setSelectedId(null);
    if (departmentId === '') {
      setFiches([]);
      return;
    }
    void reloadFiches(departmentId, dest);
  }, [departmentId, dest, reloadFiches]);

  async function onPullRefresh() {
    if (departmentId === '') return;
    setPullRefreshing(true);
    try {
      await reloadWorkspace(departmentId, dest);
    } catch (e) {
      setStatus(formatApiError(e, 'Chargement impossible'));
    } finally {
      setPullRefreshing(false);
    }
  }

  function buildLines() {
    const lines: Array<{ productId: number; countedQty: number }> = [];
    for (const p of countProducts) {
      const qty = parseQty(counts[p.id] ?? '');
      if (qty === null) return null;
      lines.push({ productId: p.id, countedQty: qty });
    }
    return lines;
  }

  async function submitOpen() {
    if (departmentId === '') return;
    const lines = buildLines();
    if (!lines) {
      setError('Complétez le comptage');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const deviceId = await getPosDeviceId();
      await openProductionSession({
        departmentId,
        lines,
        deviceId,
        deviceName: getPosDeviceName(),
      });
      setPanel(null);
      setStatus('Production ouverte.');
      await refresh(departmentId);
    } catch (e) {
      setError(formatApiError(e, 'Ouverture impossible'));
    } finally {
      setBusy(false);
    }
  }

  async function submitClose() {
    const closeSession = session ?? mineElsewhere;
    if (!closeSession) return;
    const lines = buildLines();
    if (!lines) {
      setError('Complétez le comptage');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await closeProductionSession(closeSession.id, { lines });
      setPanel(null);
      setStatus('Production fermée.');
      if (departmentId !== '') await refresh(departmentId);
    } catch (e) {
      setError(formatApiError(e, 'Fermeture impossible'));
    } finally {
      setBusy(false);
    }
  }

  async function onClaim() {
    if (!mineElsewhere) return;
    setBusy(true);
    try {
      const deviceId = await getPosDeviceId();
      await claimProductionSession(mineElsewhere.id, {
        deviceId,
        deviceName: getPosDeviceName(),
      });
      setStatus('Production reprise.');
      await refresh(mineElsewhere.departmentId);
    } catch (e) {
      setStatus(formatApiError(e, 'Reprise impossible'));
    } finally {
      setBusy(false);
    }
  }

  async function sendTransfer() {
    if (!productionEnabled) {
      Alert.alert('Production fermée', 'Ouvrez la production d’abord.');
      return;
    }
    if (departmentId === '' || toDepartmentId === '') return;
    const items = products
      .map((p) => ({ productId: p.id, quantity: Number(transferQty[p.id] ?? 0) }))
      .filter((i) => i.quantity > 0);
    if (!items.length) {
      setStatus('Indiquez une quantité.');
      return;
    }
    setBusy(true);
    try {
      await createInternalTransfer({
        fromDepartmentId: departmentId,
        toDepartmentId,
        items,
      });
      setTransferQty({});
      setStatus('Livraison interne enregistrée.');
      setOutgoing(await listInternalTransfers(outgoingQuery(departmentId)));
    } catch (e) {
      setStatus(formatApiError(e, 'Envoi impossible'));
    } finally {
      setBusy(false);
    }
  }

  const barLabel = session
    ? `Ouverte · ${sessionHolder(session)}`
    : mineElsewhere
      ? `Autre appareil · ${sessionHolder(mineElsewhere)}`
      : occupancy
        ? `Occupée · ${sessionHolder(occupancy)}`
        : 'Production fermée';

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        alwaysBounceVertical
        refreshControl={makeRefreshControl(pullRefreshing, onPullRefresh)}>
        {status ? <Text style={styles.status}>{status}</Text> : null}
        <View style={styles.bar}>
          <View style={styles.barInfo}>
            <Text style={styles.barLabel}>{barLabel}</Text>
            {plants.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
                {plants.map((d) => (
                  <Pressable
                    key={d.id}
                    onPress={() => setDepartmentId(d.id)}
                    style={[styles.chip, departmentId === d.id && styles.chipActive]}>
                    <Text style={[styles.chipText, departmentId === d.id && styles.chipTextActive]}>
                      {d.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
          </View>
          {canOpen ? (
            <View style={styles.barActions}>
              {session ? (
                <Pressable style={styles.barBtnDanger} onPress={() => setPanel('close')} disabled={busy}>
                  <Text style={styles.barBtnTextDanger}>Fermer</Text>
                </Pressable>
              ) : mineElsewhere ? (
                <>
                  <Pressable style={styles.barBtn} onPress={() => void onClaim()} disabled={busy}>
                    <Text style={styles.barBtnText}>Reprendre</Text>
                  </Pressable>
                  <Pressable style={styles.barBtnDanger} onPress={() => setPanel('close')} disabled={busy}>
                    <Text style={styles.barBtnTextDanger}>Fermer</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable
                  style={[styles.barBtn, occupancy != null && styles.submitDisabled]}
                  onPress={() => setPanel('open')}
                  disabled={busy || occupancy != null || departmentId === ''}>
                  <Text style={styles.barBtnText}>Ouvrir</Text>
                </Pressable>
              )}
            </View>
          ) : null}
        </View>

        {departmentId !== '' && (canTransfer || canManageDeliveries) ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Écoulement</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
              {canManageDeliveries ? (
                <>
                  <Pressable
                    onPress={() => setDest('ON_SITE')}
                    style={[styles.chip, dest === 'ON_SITE' && styles.chipActive]}>
                    <Text style={[styles.chipText, dest === 'ON_SITE' && styles.chipTextActive]}>
                      Sur place
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setDest('HOME')}
                    style={[styles.chip, dest === 'HOME' && styles.chipActive]}>
                    <Text style={[styles.chipText, dest === 'HOME' && styles.chipTextActive]}>
                      Domicile
                    </Text>
                  </Pressable>
                </>
              ) : null}
              {canTransfer ? (
                <Pressable
                  onPress={() => setDest('TRANSFER')}
                  style={[styles.chip, dest === 'TRANSFER' && styles.chipActive]}>
                  <Text style={[styles.chipText, dest === 'TRANSFER' && styles.chipTextActive]}>
                    Autre département
                  </Text>
                </Pressable>
              ) : null}
            </ScrollView>

            {dest === 'TRANSFER' && canTransfer ? (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
                  {scopedDepts
                    .filter((d) => d.id !== departmentId)
                    .map((d) => (
                      <Pressable
                        key={d.id}
                        onPress={() => setToDepartmentId(d.id)}
                        style={[styles.chip, toDepartmentId === d.id && styles.chipActive]}>
                        <Text style={[styles.chipText, toDepartmentId === d.id && styles.chipTextActive]}>
                          {d.name}
                        </Text>
                      </Pressable>
                    ))}
                </ScrollView>
                {products.map((p) => (
                  <View key={p.id} style={styles.qtyRow}>
                    <Text style={styles.qtyName}>{p.name}</Text>
                    <TextInput
                      style={styles.qtyInput}
                      keyboardType="decimal-pad"
                      editable
                      value={transferQty[p.id] ?? ''}
                      onChangeText={(v) => setTransferQty((prev) => ({ ...prev, [p.id]: v }))}
                    />
                  </View>
                ))}
                <Pressable style={styles.submit} onPress={() => void sendTransfer()} disabled={busy}>
                  <Text style={styles.submitText}>Envoyer</Text>
                </Pressable>
                {outgoing.map((t) => (
                  <Text key={t.id} style={styles.meta}>
                    {listCompanyOutgoing ? `${t.fromDepartment.name} → ` : ''}
                    {t.toDepartment.name} ·{' '}
                    {t.status === 'PENDING'
                      ? 'En attente'
                      : t.status === 'CONFIRMED'
                        ? 'Confirmé'
                        : 'Refusé'}
                  </Text>
                ))}
              </>
            ) : null}
          </View>
        ) : null}

        {departmentId !== '' && dest !== 'TRANSFER' && canManageDeliveries ? (
          fiches.length === 0 ? (
            <Text style={styles.meta}>Aucune fiche</Text>
          ) : (
            <View style={styles.ficheGrid}>
              {fiches.map((d) => (
                <DeliveryFicheCard
                  key={d.id}
                  delivery={d}
                  onOpen={(row) => setSelectedId(row.id)}
                />
              ))}
            </View>
          )
        ) : null}
      </ScrollView>

      <DeliveryExecuteModal
        deliveryId={selectedId}
        canManage={() => canManageDeliveries}
        canPrint={canPrintFiche}
        canChangeExecutor={canChangeExecutor}
        lockDepartmentId={departmentId === '' ? undefined : departmentId}
        executeEnabled={productionEnabled}
        executorDefault={user?.fullName?.trim() || user?.phone || ''}
        onDisabledAction={() =>
          Alert.alert('Production fermée', 'Ouvrez la production d’abord.')
        }
        onClose={() => setSelectedId(null)}
        onUpdated={(d) => {
          if (d.status === 'DELIVERED') {
            setFiches((prev) => prev.filter((row) => row.id !== d.id));
            setSelectedId(null);
          } else {
            setFiches((prev) => prev.map((row) => (row.id === d.id ? d : row)));
          }
        }}
      />

      <ModalShell
        visible={panel != null}
        onRequestClose={() => setPanel(null)}
        body={
          <FlatList
            data={countProducts}
            keyExtractor={(p) => String(p.id)}
            contentContainerStyle={styles.countList}
            ListHeaderComponent={
              <Text style={styles.panelTitle}>
                {panel === 'open' ? 'Ouverture production' : 'Fermeture production'}
              </Text>
            }
            ListEmptyComponent={<Text style={styles.meta}>Aucune matière première.</Text>}
            renderItem={({ item }) => (
              <View style={styles.countRow}>
                <View style={styles.countInfo}>
                  <Text style={styles.countName}>{item.name}</Text>
                  <Text style={styles.meta}>
                    Système : {formatQuantity(item.stock)} {item.unitLabel}
                  </Text>
                </View>
                <TextInput
                  style={styles.countInput}
                  keyboardType="decimal-pad"
                  value={counts[item.id] ?? ''}
                  onChangeText={(v) => setCounts((prev) => ({ ...prev, [item.id]: v }))}
                />
              </View>
            )}
          />
        }
        footer={
          <View style={styles.footer}>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable
              style={[styles.submit, (!linesReady || busy) && styles.submitDisabled]}
              disabled={!linesReady || busy}
              onPress={() => void (panel === 'open' ? submitOpen() : submitClose())}>
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitText}>{panel === 'open' ? 'Ouvrir' : 'Fermer'}</Text>
              )}
            </Pressable>
          </View>
        }>
        <View style={styles.modalTop}>
          <Text style={styles.barLabel}>Production</Text>
          <Pressable onPress={() => setPanel(null)} hitSlop={12}>
            <Text style={styles.meta}>Fermer</Text>
          </Pressable>
        </View>
      </ModalShell>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  status: { color: BrandColors.primary, fontWeight: '600' },
  bar: {
    padding: Spacing.three,
    borderRadius: 12,
    backgroundColor: BrandColors.surface,
    borderWidth: 1,
    borderColor: BrandColors.border,
    gap: Spacing.two,
  },
  barInfo: { gap: 6 },
  barActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  barLabel: { fontSize: 15, fontWeight: '700', color: BrandColors.text },
  barBtn: {
    backgroundColor: BrandColors.primary,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    borderRadius: 10,
  },
  barBtnText: { color: '#fff', fontWeight: '700' },
  barBtnDanger: {
    backgroundColor: BrandColors.surface,
    borderWidth: 1,
    borderColor: BrandColors.border,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    borderRadius: 10,
  },
  barBtnTextDanger: { color: BrandColors.text, fontWeight: '700' },
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
  card: {
    padding: Spacing.three,
    borderRadius: 12,
    backgroundColor: BrandColors.surface,
    borderWidth: 1,
    borderColor: BrandColors.border,
    gap: Spacing.two,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: BrandColors.text },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  qtyName: { flex: 1, color: BrandColors.text },
  qtyInput: {
    width: 88,
    borderWidth: 1,
    borderColor: BrandColors.border,
    borderRadius: 8,
    padding: 8,
    color: BrandColors.text,
  },
  submit: {
    backgroundColor: BrandColors.primary,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  submitDisabled: { opacity: 0.5 },
  submitText: { color: '#fff', fontWeight: '700' },
  meta: { color: BrandColors.textMuted, fontSize: 13 },
  ficheGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  countList: { padding: Spacing.three, gap: Spacing.two },
  panelTitle: { fontSize: 18, fontWeight: '700', color: BrandColors.text, marginBottom: 12 },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginBottom: 10 },
  countInfo: { flex: 1 },
  countName: { fontWeight: '600', color: BrandColors.text },
  countInput: {
    width: 88,
    borderWidth: 1,
    borderColor: BrandColors.border,
    borderRadius: 8,
    padding: 8,
    color: BrandColors.text,
  },
  footer: { padding: Spacing.three, gap: Spacing.two },
  error: { color: '#b91c1c' },
  modalTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
});
