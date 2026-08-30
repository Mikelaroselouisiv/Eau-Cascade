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
import { Screen } from '@/components/Screen';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import {
  addDeliveryDrop,
  claimProductionSession,
  closeProductionSession,
  confirmInternalTransfer,
  createInternalTransfer,
  getCompanies,
  getDeliveryById,
  getDepartments,
  getProductionCountSheet,
  getProductionSessionContext,
  getProducts,
  listDeliveries,
  listInternalTransfers,
  openProductionSession,
  rejectInternalTransfer,
} from '@/services/api';
import { formatApiError } from '@/services/api-errors';
import { getPosDeviceId, getPosDeviceName } from '@/services/pos-device';
import type {
  Delivery,
  DeliveryItem,
  Department,
  InternalTransferRow,
  InventoryCountSheetRow,
  Product,
  ProductionSessionContext,
  ProductionSessionDetail,
} from '@/types/api';
import { departmentsForUser } from '@/utils/user-scope';
import { formatQuantity } from '@/utils/quantity';
import { saleDisplayRef } from '@/utils/saleRef';

type PanelMode = 'open' | 'close' | null;
type Dest = 'ON_SITE' | 'HOME' | 'TRANSFER';

const STATUS_LABEL: Record<Delivery['status'], string> = {
  PENDING: 'Non livré',
  PARTIAL: 'Partiel',
  DELIVERED: 'Livré',
};

function remainingOf(it: DeliveryItem): number {
  return Number(
    it.quantityRemaining ?? Math.max(0, Number(it.quantityOrdered) - Number(it.quantityDelivered)),
  );
}

function itemLabel(it: DeliveryItem): string {
  return it.saleItem?.lineLabel || it.saleItem?.product?.name || 'Article';
}

function belongsToPlant(d: Delivery, plantId: number): boolean {
  if (d.departmentId === plantId) return true;
  const ids = (d.items ?? []).map((it) => it.saleItem?.product?.departmentId);
  if (ids.some((id) => id === plantId)) return true;
  if (d.departmentId == null && ids.every((id) => id == null)) return true;
  return false;
}

function isHomeDelivery(d: Delivery) {
  return d.fulfillmentType === 'HOME' || d.sale?.fulfillmentType === 'HOME';
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
  const canConfirm = canPerm('transfers.confirm');
  const canManageDeliveries = canPerm('deliveries.manage');

  const [departments, setDepartments] = useState<Department[]>([]);
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
  const [inbox, setInbox] = useState<InternalTransferRow[]>([]);
  const [dest, setDest] = useState<Dest>('ON_SITE');
  const [fiches, setFiches] = useState<Delivery[]>([]);
  const [selected, setSelected] = useState<Delivery | null>(null);
  const [dropSaleItemId, setDropSaleItemId] = useState<number | ''>('');
  const [dropQty, setDropQty] = useState('');
  const [dropExecutor, setDropExecutor] = useState('');
  const [dropStopId, setDropStopId] = useState<number | ''>('');

  const session = ctx.local;
  const mineElsewhere = ctx.mineElsewhere;
  const occupancy = ctx.occupancy;
  const productionEnabled = session != null;
  const plants = useMemo(
    () => departments.filter((d) => d.kind === 'PRODUCTION_DISTRIBUTION'),
    [departments],
  );
  const scopedDepts = useMemo(() => departmentsForUser(departments, user), [departments, user]);
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

  useEffect(() => {
    const companyId = user?.companyId;
    void (async () => {
      try {
        const companies = await getCompanies();
        const cid = companyId ?? companies[0]?.id;
        if (cid == null) return;
        const depts = departmentsForUser(await getDepartments(cid), user);
        setDepartments(depts);
        const firstPlant = depts.find((d) => d.kind === 'PRODUCTION_DISTRIBUTION');
        setDepartmentId((prev) =>
          prev !== '' && depts.some((d) => d.id === prev) ? prev : (firstPlant?.id ?? ''),
        );
      } catch {
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
    void listInternalTransfers({ fromDepartmentId: departmentId }).then(setOutgoing).catch(() => setOutgoing([]));
    if (canConfirm) {
      void listInternalTransfers({ inbox: true, status: 'PENDING' }).then(setInbox).catch(() => setInbox([]));
    }
  }, [departmentId, canConfirm, refresh]);

  useEffect(() => {
    setSelected(null);
    if (departmentId === '' || dest === 'TRANSFER') {
      setFiches([]);
      return;
    }
    void (dest === 'HOME'
      ? listDeliveries({
          ...(user?.companyId != null ? { companyId: user.companyId } : {}),
          fulfillmentType: 'HOME',
          take: 100,
        })
      : listDeliveries({ departmentId, fulfillmentType: dest, take: 100 })
    )
      .then((res) => {
        const rows = res.items.filter((d) => d.status !== 'DELIVERED');
        setFiches(
          dest === 'HOME' ? rows : rows.filter((d) => belongsToPlant(d, departmentId)),
        );
      })
      .catch(() => setFiches([]));
  }, [departmentId, dest, user?.companyId]);

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
      setOutgoing(await listInternalTransfers({ fromDepartmentId: departmentId }));
    } catch (e) {
      setStatus(formatApiError(e, 'Envoi impossible'));
    } finally {
      setBusy(false);
    }
  }

  function applyFiche(d: Delivery) {
    setSelected(d);
    const remainingItem = (d.items ?? []).find((it) => remainingOf(it) > 0.0001);
    setDropSaleItemId(remainingItem?.saleItemId ?? d.items?.[0]?.saleItemId ?? '');
    setDropQty(remainingItem ? String(remainingOf(remainingItem)) : '');
    setDropExecutor(d.executorName?.trim() || user?.fullName?.trim() || user?.phone || '');
    const stops = d.sale?.deliveryStops ?? [];
    const remainingStop = stops.find((s) => Number(s.quantityRemaining ?? s.quantity) > 0.0001);
    setDropStopId(remainingStop?.id ?? stops[0]?.id ?? '');
  }

  async function addLine() {
    if (!selected || departmentId === '') return;
    if (!productionEnabled) {
      Alert.alert('Production fermée', 'Ouvrez la production d’abord.');
      return;
    }
    if (dropSaleItemId === '') {
      setStatus('Choisissez un article');
      return;
    }
    const qty = Number(String(dropQty).replace(',', '.'));
    if (!Number.isFinite(qty) || qty <= 0) {
      setStatus('Quantité invalide');
      return;
    }
    if (isHomeDelivery(selected) && !dropExecutor.trim()) {
      setStatus('Indiquez le livreur');
      return;
    }
    setBusy(true);
    try {
      await addDeliveryDrop(selected.id, {
        saleItemId: dropSaleItemId,
        quantity: qty,
        departmentId,
        ...(isHomeDelivery(selected)
          ? {
              executorName: dropExecutor.trim(),
              stopId: dropStopId === '' ? undefined : dropStopId,
            }
          : {}),
      });
      const next = await getDeliveryById(selected.id);
      setStatus('Livraison enregistrée.');
      if (next.status === 'DELIVERED') {
        setSelected(null);
        setFiches((prev) => prev.filter((d) => d.id !== next.id));
      } else {
        applyFiche(next);
        setFiches((prev) => prev.map((d) => (d.id === next.id ? next : d)));
      }
    } catch (e) {
      setStatus(formatApiError(e, 'Livraison impossible'));
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
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
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
                        onPress={() => productionEnabled && setToDepartmentId(d.id)}
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
                      editable={productionEnabled}
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

            {dest !== 'TRANSFER' && canManageDeliveries ? (
              <>
                {fiches.length === 0 ? <Text style={styles.meta}>Aucune fiche</Text> : null}
                {fiches.map((d) => (
                  <Pressable
                    key={d.id}
                    onPress={() => applyFiche(d)}
                    style={styles.ficheRow}>
                    <Text style={styles.qtyName}>
                      Vente #{d.saleRef ?? (d.sale ? saleDisplayRef(d.sale) : d.saleId)} ·{' '}
                      {d.sale?.clientName?.trim() || 'Client'}
                    </Text>
                    <Text style={styles.meta}>{STATUS_LABEL[d.status]}</Text>
                  </Pressable>
                ))}
                {selected ? (
                  <>
                    {(selected.items ?? []).map((it) => (
                      <Pressable
                        key={it.id}
                        onPress={() => {
                          if (remainingOf(it) <= 0.0001) return;
                          setDropSaleItemId(it.saleItemId);
                          setDropQty(String(remainingOf(it)));
                        }}
                        style={styles.ficheRow}>
                        <Text
                          style={[
                            styles.qtyName,
                            dropSaleItemId === it.saleItemId && { fontWeight: '700' },
                          ]}>
                          {itemLabel(it)} · reste {formatQuantity(remainingOf(it))}
                        </Text>
                      </Pressable>
                    ))}
                    <View style={styles.qtyRow}>
                      <Text style={styles.qtyName}>Quantité</Text>
                      <TextInput
                        style={styles.qtyInput}
                        keyboardType="decimal-pad"
                        editable={productionEnabled}
                        value={dropQty}
                        onChangeText={setDropQty}
                      />
                    </View>
                    {isHomeDelivery(selected) ? (
                      <View style={styles.qtyRow}>
                        <Text style={styles.qtyName}>Livreur</Text>
                        <TextInput
                          style={[styles.qtyInput, { width: 160 }]}
                          editable={productionEnabled}
                          value={dropExecutor}
                          onChangeText={setDropExecutor}
                        />
                      </View>
                    ) : null}
                    <Pressable style={styles.submit} onPress={() => void addLine()} disabled={busy}>
                      <Text style={styles.submitText}>Livrer</Text>
                    </Pressable>
                  </>
                ) : null}
              </>
            ) : null}
          </View>
        ) : null}

        {canConfirm && inbox.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>À confirmer</Text>
            {inbox.map((t) => (
              <View key={t.id} style={styles.inboxRow}>
                <Text style={styles.qtyName}>
                  {t.fromDepartment.name} → {t.toDepartment.name}
                </Text>
                <View style={styles.barActions}>
                  <Pressable
                    style={styles.barBtn}
                    onPress={() =>
                      void confirmInternalTransfer(t.id).then(() =>
                        setInbox((prev) => prev.filter((x) => x.id !== t.id)),
                      )
                    }>
                    <Text style={styles.barBtnText}>Confirmer</Text>
                  </Pressable>
                  <Pressable
                    style={styles.barBtnDanger}
                    onPress={() =>
                      void rejectInternalTransfer(t.id).then(() =>
                        setInbox((prev) => prev.filter((x) => x.id !== t.id)),
                      )
                    }>
                    <Text style={styles.barBtnTextDanger}>Refuser</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

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
  inboxRow: { gap: 8, paddingVertical: 8 },
  ficheRow: { gap: 2, paddingVertical: 8 },
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
