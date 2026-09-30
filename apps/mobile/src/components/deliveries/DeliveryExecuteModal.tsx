import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ModalShell } from '@/components/ModalShell';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import {
  addDeliveryDrop,
  getDeliveryById,
  getDepartments,
  getSaleById,
  listCarriers,
  updateDelivery,
} from '@/services/api';
import { formatApiError } from '@/services/api-errors';
import { printReceipt } from '@/services/bluetooth-printer';
import { buildSaleReceiptDataFromSale } from '@/services/receipt';
import type { CarrierRow, Delivery, Department } from '@/types/api';
import { formatDateTime, formatMoney } from '@/utils/datetime';
import { formatQuantity } from '@/utils/quantity';
import { departmentsForUser } from '@/utils/user-scope';
import {
  DELIVERY_STATUS_LABEL,
  deliveryDropWho,
  deliverySaleRef,
  isHomeDelivery,
} from './deliveryFiche';

type Props = {
  deliveryId: number | null;
  canManage: (d: Delivery) => boolean;
  canPrint?: boolean;
  canChangeExecutor?: boolean;
  lockDepartmentId?: number;
  executeEnabled?: boolean;
  executorDefault?: string;
  onDisabledAction?: () => void;
  onClose: () => void;
  onUpdated: (d: Delivery) => void;
};

export function DeliveryExecuteModal({
  deliveryId,
  canManage,
  canPrint,
  canChangeExecutor,
  lockDepartmentId,
  executeEnabled = true,
  executorDefault = '',
  onDisabledAction,
  onClose,
  onUpdated,
}: Props) {
  const { user } = useAuth();
  const [detail, setDetail] = useState<Delivery | null>(null);
  const [dropQty, setDropQty] = useState('');
  const [dropSaleItemId, setDropSaleItemId] = useState<number | ''>('');
  const [dropStopId, setDropStopId] = useState<number | ''>('');
  const [executorDraft, setExecutorDraft] = useState('');
  const [dropCarrierId, setDropCarrierId] = useState<number | ''>('');
  const [carriers, setCarriers] = useState<CarrierRow[]>([]);
  const [stockDeptId, setStockDeptId] = useState<number | ''>('');
  const [dropDeptChoices, setDropDeptChoices] = useState<Department[]>([]);
  const [saving, setSaving] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [printingId, setPrintingId] = useState<number | null>(null);

  function applyDropForm(d: Delivery, deptChoices?: Department[]) {
    const remainingItem =
      (d.items ?? []).find((it) => {
        const rem = Number(
          it.quantityRemaining ??
            Math.max(0, Number(it.quantityOrdered) - Number(it.quantityDelivered)),
        );
        return rem > 0.0001;
      }) ?? d.items?.[0];
    setDropSaleItemId(remainingItem?.saleItemId ?? '');
    setDropQty(
      remainingItem
        ? String(
            Number(
              remainingItem.quantityRemaining ??
                Number(remainingItem.quantityOrdered) - Number(remainingItem.quantityDelivered),
            ),
          )
        : '',
    );
    setExecutorDraft(d.executorName?.trim() || executorDefault);
    setDropCarrierId(d.carrierId ?? '');
    const locked = lockDepartmentId ?? d.departmentId;
    const depts = deptChoices ?? dropDeptChoices;
    setStockDeptId(locked ?? depts[0]?.id ?? '');
    const stops = d.sale?.deliveryStops ?? [];
    const remStop = stops.find((s) => Number(s.quantityRemaining ?? s.quantity) > 0.0001);
    setDropStopId(remStop?.id ?? stops[0]?.id ?? '');
  }

  useEffect(() => {
    if (deliveryId == null) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    let cancelled = false;
    setDetailError(null);
    void (async () => {
      try {
        const full = await getDeliveryById(deliveryId);
        if (cancelled) return;
        setDetail(full);
        const cid = full.companyId ?? (typeof user?.companyId === 'number' ? user.companyId : undefined);
        let choices: Department[] = [];
        if (lockDepartmentId != null) {
          choices = [];
        } else if (cid != null) {
          try {
            const list = await getDepartments(cid);
            const scoped = departmentsForUser(list, user);
            choices = isHomeDelivery(full)
              ? scoped.filter((d) => d.kind === 'PRODUCTION_DISTRIBUTION')
              : scoped;
          } catch {
            choices = [];
          }
        }
        if (cancelled) return;
        setDropDeptChoices(choices);
        applyDropForm(full, choices);
      } catch (err) {
        if (!cancelled) setDetailError(formatApiError(err, 'Impossible d’ouvrir la fiche'));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveryId, lockDepartmentId]);

  useEffect(() => {
    const home = detail != null && isHomeDelivery(detail);
    const deptId =
      lockDepartmentId ?? (typeof stockDeptId === 'number' ? stockDeptId : null);
    if (!home || deptId == null) {
      setCarriers([]);
      return;
    }
    let cancelled = false;
    void listCarriers(deptId)
      .then((list) => {
        if (!cancelled) setCarriers(list);
      })
      .catch(() => {
        if (!cancelled) setCarriers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [detail?.id, detail?.fulfillmentType, lockDepartmentId, stockDeptId]);

  function guardExecute() {
    if (executeEnabled) return true;
    onDisabledAction?.();
    return false;
  }

  async function reprintDelivery(delivery: Delivery) {
    const saleId = delivery.sale?.id ?? delivery.saleId;
    if (!saleId) {
      setDetailError('Vente introuvable pour impression');
      return;
    }
    setPrintingId(delivery.id);
    setDetailError(null);
    try {
      const sale = await getSaleById(saleId);
      const departmentId =
        lockDepartmentId ??
        delivery.departmentId ??
        sale.items?.[0]?.product?.departmentId ??
        (typeof user?.departmentId === 'number' ? user.departmentId : undefined);
      const receipt = await buildSaleReceiptDataFromSale(sale, departmentId);
      await printReceipt(receipt);
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Impossible de réimprimer la fiche');
    } finally {
      setPrintingId(null);
    }
  }

  async function saveDetail(markAll = false) {
    if (!detail || !canManage(detail) || detail.status === 'DELIVERED') return;
    if (!guardExecute()) return;
    const home = isHomeDelivery(detail);
    const deptId =
      lockDepartmentId ?? (typeof stockDeptId === 'number' ? stockDeptId : detail.departmentId);
    if (deptId == null) {
      setDetailError(
        home ? 'Choisissez le département qui livre à domicile' : 'Choisissez le département',
      );
      return;
    }
    if (home && dropCarrierId === '') {
      setDetailError('Choisissez le transporteur');
      return;
    }
    if (!markAll) {
      const qty = Number(String(dropQty).replace(',', '.'));
      if (!Number.isFinite(qty) || qty <= 0) {
        setDetailError('Quantité invalide');
        return;
      }
    }
    setSaving(true);
    setDetailError(null);
    try {
      const updated = markAll
        ? await updateDelivery(detail.id, {
            markDelivered: true,
            stockDepartmentId: deptId,
            ...(home
              ? {
                  carrierId: dropCarrierId === '' ? null : dropCarrierId,
                  stopId: dropStopId === '' ? undefined : dropStopId,
                }
              : {}),
          })
        : await addDeliveryDrop(detail.id, {
            saleItemId:
              dropSaleItemId === '' ? (detail.items?.[0]?.saleItemId ?? 0) : dropSaleItemId,
            quantity: Number(String(dropQty).replace(',', '.')),
            departmentId: deptId,
            ...(home
              ? {
                  carrierId: dropCarrierId === '' ? null : dropCarrierId,
                  stopId: dropStopId === '' ? null : dropStopId,
                }
              : { executorName: executorDraft.trim() || null }),
          });
      setDetail(updated);
      applyDropForm(updated);
      onUpdated(updated);
    } catch (e) {
      setDetailError(formatApiError(e, 'Enregistrement impossible'));
    } finally {
      setSaving(false);
    }
  }

  async function saveExecutorOnly() {
    if (!detail || (!canManage(detail) && !canChangeExecutor)) return;
    if (!isHomeDelivery(detail)) return;
    setSaving(true);
    setDetailError(null);
    try {
      const updated = await updateDelivery(detail.id, {
        carrierId: dropCarrierId === '' ? null : dropCarrierId,
      });
      setDetail(updated);
      setDropCarrierId(updated.carrierId ?? '');
      setExecutorDraft(updated.executorName?.trim() ?? '');
      onUpdated(updated);
    } catch (e) {
      setDetailError(formatApiError(e, 'Enregistrement impossible'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell
      visible={deliveryId != null}
      onRequestClose={onClose}
      body={
        detail ? (
          <FlatList
            data={detail.items ?? []}
            keyExtractor={(it) => String(it.saleItemId)}
            contentContainerStyle={styles.detailList}
            ListHeaderComponent={
              <View style={styles.detailHeader}>
                <Text style={styles.detailTitle} numberOfLines={1}>
                  Vente #{deliverySaleRef(detail)}
                </Text>
                <Text style={styles.client} numberOfLines={1}>
                  {detail.sale?.clientName?.trim() || 'Client'}
                </Text>
                <Text style={styles.meta} numberOfLines={2}>
                  {isHomeDelivery(detail) ? 'À domicile' : 'Sur place'} ·{' '}
                  {DELIVERY_STATUS_LABEL[detail.status]} · {formatMoney(detail.sale?.total)}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {isHomeDelivery(detail)
                    ? [
                        detail.company?.name,
                        detail.department?.name ? `Livré depuis ${detail.department.name}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : [detail.company?.name, detail.department?.name].filter(Boolean).join(' · ')}
                </Text>
                {isHomeDelivery(detail) && detail.sale?.clientPhone?.trim() ? (
                  <Text style={styles.meta}>Tél. {detail.sale.clientPhone.trim()}</Text>
                ) : null}
                {(detail.sale?.deliveryStops?.length
                  ? detail.sale.deliveryStops
                  : detail.sale?.clientAddress?.trim()
                    ? [{ id: 0, address: detail.sale.clientAddress.trim(), quantity: 0 }]
                    : []
                ).map((st) => (
                  <Text key={st.id || st.address} style={styles.meta} numberOfLines={2}>
                    {st.address}
                    {Number(st.quantity) > 0
                      ? ` · ${formatQuantity(Number(st.quantityDelivered ?? 0))} / ${formatQuantity(Number(st.quantity))}`
                      : ''}
                  </Text>
                ))}
                {canManage(detail) && detail.status !== 'DELIVERED' ? (
                  <View style={styles.executorBlock}>
                    {lockDepartmentId == null ? (
                      <>
                        <Text style={styles.meta}>
                          {isHomeDelivery(detail) ? 'Département de livraison' : 'Département'}
                        </Text>
                        {dropDeptChoices.length ? (
                          <View style={styles.chipWrap}>
                            {dropDeptChoices.map((d) => (
                              <Pressable
                                key={d.id}
                                onPress={() => setStockDeptId(d.id)}
                                style={[styles.deptChip, stockDeptId === d.id && styles.deptChipActive]}>
                                <Text
                                  style={[
                                    styles.deptChipText,
                                    stockDeptId === d.id && styles.deptChipTextActive,
                                  ]}>
                                  {d.name}
                                </Text>
                              </Pressable>
                            ))}
                          </View>
                        ) : (
                          <Text style={styles.meta}>Aucun département</Text>
                        )}
                      </>
                    ) : null}
                    <Text style={styles.meta}>Quantité livrée</Text>
                    <TextInput
                      style={styles.executorInput}
                      keyboardType="decimal-pad"
                      value={dropQty}
                      editable={!saving}
                      onChangeText={setDropQty}
                    />
                    {isHomeDelivery(detail) ? (
                      <>
                        <Text style={styles.meta}>Transporteur *</Text>
                        {carriers.length ? (
                          <View style={styles.chipWrap}>
                            {carriers.map((c) => (
                              <Pressable
                                key={c.id}
                                onPress={() => setDropCarrierId(c.id)}
                                style={[
                                  styles.deptChip,
                                  dropCarrierId === c.id && styles.deptChipActive,
                                ]}>
                                <Text
                                  style={[
                                    styles.deptChipText,
                                    dropCarrierId === c.id && styles.deptChipTextActive,
                                  ]}>
                                  {c.name}
                                </Text>
                              </Pressable>
                            ))}
                          </View>
                        ) : (
                          <Text style={styles.meta}>Aucun transporteur</Text>
                        )}
                      </>
                    ) : (
                      <>
                        <Text style={styles.meta}>Livreur</Text>
                        <TextInput
                          style={styles.executorInput}
                          value={executorDraft}
                          editable={!saving}
                          onChangeText={setExecutorDraft}
                        />
                      </>
                    )}
                    {isHomeDelivery(detail) && (detail.sale?.deliveryStops?.length ?? 0) > 0 ? (
                      <>
                        <Text style={styles.meta}>Adresse</Text>
                        <View style={styles.chipWrap}>
                          {(detail.sale?.deliveryStops ?? []).map((st) => (
                            <Pressable
                              key={st.id}
                              onPress={() => setDropStopId(st.id)}
                              style={[styles.deptChip, dropStopId === st.id && styles.deptChipActive]}>
                              <Text
                                style={[
                                  styles.deptChipText,
                                  dropStopId === st.id && styles.deptChipTextActive,
                                ]}
                                numberOfLines={2}>
                                {st.address} (
                                {formatQuantity(Number(st.quantityRemaining ?? st.quantity))})
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      </>
                    ) : null}
                  </View>
                ) : isHomeDelivery(detail) &&
                  (canChangeExecutor || detail.executorName?.trim()) ? (
                  <View style={styles.executorBlock}>
                    <Text style={styles.meta}>Transporteur</Text>
                    {canChangeExecutor && carriers.length ? (
                      <View style={styles.chipWrap}>
                        {carriers.map((c) => (
                          <Pressable
                            key={c.id}
                            onPress={() => setDropCarrierId(c.id)}
                            style={[
                              styles.deptChip,
                              dropCarrierId === c.id && styles.deptChipActive,
                            ]}>
                            <Text
                              style={[
                                styles.deptChipText,
                                dropCarrierId === c.id && styles.deptChipTextActive,
                              ]}>
                              {c.name}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : (
                      <Text style={styles.meta}>
                        {detail.carrier?.name?.trim() || detail.executorName?.trim() || '—'}
                      </Text>
                    )}
                  </View>
                ) : null}
              </View>
            }
            renderItem={({ item: it }) => {
              const label =
                it.saleItem?.lineLabel || it.saleItem?.product?.name || `Article #${it.saleItemId}`;
              const remaining = Number(
                it.quantityRemaining ??
                  Math.max(0, Number(it.quantityOrdered) - Number(it.quantityDelivered)),
              );
              const selectedLine = dropSaleItemId === it.saleItemId;
              const editable = canManage(detail) && detail.status !== 'DELIVERED';
              const lineDrops = (detail.drops ?? [])
                .filter((d) => d.saleItemId === it.saleItemId)
                .slice()
                .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
              return (
                <View style={[styles.lineRow, selectedLine && editable && styles.lineRowSelected]}>
                  <Pressable
                    style={styles.rowInfo}
                    disabled={!editable}
                    onPress={() => {
                      setDropSaleItemId(it.saleItemId);
                      setDropQty(String(remaining));
                    }}>
                    <Text style={styles.rowTitle} numberOfLines={2}>
                      {label}
                    </Text>
                    <Text style={styles.meta}>
                      Livré {formatQuantity(it.quantityDelivered)} · Reste {formatQuantity(remaining)}
                    </Text>
                  </Pressable>
                  {lineDrops.map((drop) => {
                    const who = deliveryDropWho(drop);
                    return (
                      <View key={drop.id} style={styles.dropCard}>
                        <View style={styles.dropCardTop}>
                          <Text style={styles.dropQty}>
                            {formatQuantity(Number(drop.quantity))}
                          </Text>
                          <Text style={styles.dropWhen} numberOfLines={1}>
                            {formatDateTime(drop.createdAt)}
                          </Text>
                        </View>
                        {who ? (
                          <Text style={styles.dropMeta} numberOfLines={1}>
                            {who}
                          </Text>
                        ) : null}
                        {drop.department?.name ? (
                          <Text style={styles.dropMeta} numberOfLines={1}>
                            {drop.department.name}
                          </Text>
                        ) : null}
                        {drop.stop?.address?.trim() ? (
                          <Text style={styles.dropMeta} numberOfLines={2}>
                            {drop.stop.address.trim()}
                          </Text>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              );
            }}
          />
        ) : (
          <View style={styles.loadingBox}>
            {detailError ? (
              <Text style={styles.error}>{detailError}</Text>
            ) : (
              <ActivityIndicator color={BrandColors.primary} />
            )}
          </View>
        )
      }
      footer={
        detail ? (
          <View style={styles.footer}>
            {detailError ? <Text style={styles.error}>{detailError}</Text> : null}
            <View style={styles.footerActions}>
              <Pressable style={styles.secondaryBtn} onPress={onClose}>
                <Text style={styles.secondaryBtnText}>Fermer</Text>
              </Pressable>
              {canPrint ? (
                <Pressable
                  style={[styles.secondaryBtn, printingId != null && styles.disabled]}
                  disabled={printingId != null || saving}
                  onPress={() => void reprintDelivery(detail)}>
                  {printingId === detail.id ? (
                    <ActivityIndicator color={BrandColors.text} />
                  ) : (
                    <Text style={styles.secondaryBtnText}>Réimprimer fiche</Text>
                  )}
                </Pressable>
              ) : null}
              {canManage(detail) && detail.status !== 'DELIVERED' ? (
                <>
                  <Pressable
                    style={[styles.secondaryBtn, saving && styles.disabled]}
                    disabled={saving}
                    onPress={() => void saveDetail(false)}>
                    <Text style={styles.secondaryBtnText}>Ajouter</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.primaryBtn, saving && styles.disabled]}
                    disabled={saving}
                    onPress={() => void saveDetail(true)}>
                    {saving ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.primaryBtnText}>Tout livrer</Text>
                    )}
                  </Pressable>
                </>
              ) : isHomeDelivery(detail) && canChangeExecutor ? (
                <Pressable
                  style={[styles.secondaryBtn, saving && styles.disabled]}
                  disabled={saving}
                  onPress={() => void saveExecutorOnly()}>
                  <Text style={styles.secondaryBtnText}>Enregistrer</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null
      }>
      <View style={styles.modalTop}>
        <Text style={styles.modalTopTitle}>Livraison</Text>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.modalClose}>Fermer</Text>
        </Pressable>
      </View>
    </ModalShell>
  );
}

const styles = StyleSheet.create({
  loadingBox: { padding: Spacing.five, alignItems: 'center' },
  error: {
    color: BrandColors.danger,
    fontWeight: '600',
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.two,
  },
  client: { fontSize: 15, fontWeight: '600', color: BrandColors.text },
  meta: { fontSize: 12, color: BrandColors.textMuted },
  modalTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  modalTopTitle: { fontSize: 18, fontWeight: '700', color: BrandColors.text },
  modalClose: { color: BrandColors.primary, fontWeight: '600' },
  detailList: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.four },
  detailHeader: { gap: 4, marginBottom: Spacing.three },
  detailTitle: { fontSize: 20, fontWeight: '700', color: BrandColors.text },
  lineRow: {
    gap: Spacing.two,
    backgroundColor: BrandColors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: Spacing.three,
    marginBottom: Spacing.two,
  },
  lineRowSelected: { borderColor: BrandColors.primary },
  rowInfo: { gap: 4 },
  rowTitle: { fontWeight: '600', color: BrandColors.text },
  dropCard: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: BrandColors.border,
    borderRadius: 10,
    backgroundColor: BrandColors.bg,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  dropCardTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  dropQty: { fontSize: 14, fontWeight: '800', color: BrandColors.text, flexShrink: 0 },
  dropWhen: {
    fontSize: 12,
    fontWeight: '700',
    color: BrandColors.primary,
    flexShrink: 1,
    textAlign: 'right',
  },
  dropMeta: { fontSize: 12, color: BrandColors.textMuted, fontWeight: '600' },
  footer: { padding: Spacing.three, gap: Spacing.two, backgroundColor: BrandColors.bg },
  footerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  secondaryBtn: {
    flexGrow: 1,
    flexBasis: '40%',
    minWidth: 120,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: BrandColors.surface,
  },
  secondaryBtnText: { fontWeight: '700', color: BrandColors.text },
  primaryBtn: {
    flexGrow: 1,
    flexBasis: '40%',
    minWidth: 120,
    backgroundColor: BrandColors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.55 },
  executorBlock: { marginTop: Spacing.two, gap: 6 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  deptChip: {
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: 8,
    backgroundColor: BrandColors.surface,
    maxWidth: '100%',
  },
  deptChipActive: {
    backgroundColor: BrandColors.primary,
    borderColor: BrandColors.primary,
  },
  deptChipText: { fontWeight: '700', color: BrandColors.text },
  deptChipTextActive: { color: '#fff' },
  executorInput: {
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    color: BrandColors.text,
    backgroundColor: BrandColors.surface,
  },
});
