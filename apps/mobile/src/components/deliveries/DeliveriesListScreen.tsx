import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { MoneyText } from '@/components/MoneyText';
import { ModalShell } from '@/components/ModalShell';
import { Screen } from '@/components/Screen';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import {
  addDeliveryDrop,
  getCompanies,
  getDeliveryById,
  getDepartments,
  getSaleById,
  listDeliveries,
  updateDelivery,
} from '@/services/api';
import { formatApiError } from '@/services/api-errors';
import { printReceipt } from '@/services/bluetooth-printer';
import { buildSaleReceiptDataFromSale } from '@/services/receipt';
import type { CompanyListItem, Delivery, DeliveryStatus, Department } from '@/types/api';
import { formatDateTime, formatMoney } from '@/utils/datetime';
import { formatQuantity } from '@/utils/quantity';
import { canEditDeliveryExecutor, departmentsForUser, isAdminRole } from '@/utils/user-scope';

const STATUS_LABEL: Record<DeliveryStatus, string> = {
  PENDING: 'Non livré',
  PARTIAL: 'Partiel',
  DELIVERED: 'Livré',
};

const STATUS_COLOR: Record<DeliveryStatus, string> = {
  PENDING: BrandColors.primaryHover,
  PARTIAL: '#B45309',
  DELIVERED: BrandColors.ok,
};

function isHomeDelivery(d: Delivery) {
  return d.fulfillmentType === 'HOME' || d.sale?.fulfillmentType === 'HOME';
}

type Props = {
  status?: DeliveryStatus;
};

export function DeliveriesListScreen({ status }: Props) {
  const { user, canPerm } = useAuth();
  const canManageAll = canPerm('deliveries.manage');
  const canManageOnsite = canPerm('deliveries.manage_onsite');
  const canManageHome = canPerm('deliveries.manage_home');
  const canPrintFiche = canPerm('deliveries.print');
  const canChangeExecutor = canEditDeliveryExecutor(user?.role);
  const lockedScope = user?.role === 'CASHIER' || user?.role === 'LIVREUR';
  const canFilter = !lockedScope;
  const sessionCompanyId = typeof user?.companyId === 'number' ? user.companyId : undefined;

  function canManageDelivery(d: Delivery) {
    if (canManageAll) return true;
    return isHomeDelivery(d) ? canManageHome : canManageOnsite;
  }

  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [fulfillmentFilter, setFulfillmentFilter] = useState<'' | 'ON_SITE' | 'HOME'>('');
  const [companies, setCompanies] = useState<CompanyListItem[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [filterCompanyId, setFilterCompanyId] = useState<number | ''>('');
  const [filterDepartmentId, setFilterDepartmentId] = useState<number | ''>('');
  const [items, setItems] = useState<Delivery[]>([]);
  const [total, setTotal] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detail, setDetail] = useState<Delivery | null>(null);
  const [dropQty, setDropQty] = useState('');
  const [dropSaleItemId, setDropSaleItemId] = useState<number | ''>('');
  const [dropStopId, setDropStopId] = useState<number | ''>('');
  const [executorDraft, setExecutorDraft] = useState('');
  const [stockDeptId, setStockDeptId] = useState<number | ''>('');
  const [homeDepartments, setHomeDepartments] = useState<Department[]>([]);
  const [saving, setSaving] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [printingId, setPrintingId] = useState<number | null>(null);

  const load = useCallback(
    async (opts?: { append?: boolean; currentCount?: number }) => {
      if (lockedScope && sessionCompanyId == null) {
        setError('Entreprise manquante pour ce compte');
        setItems([]);
        return;
      }
      try {
        setError(null);
        const skip = opts?.append ? (opts.currentCount ?? 0) : 0;
        const res = await listDeliveries({
          companyId: canFilter
            ? filterCompanyId === ''
              ? undefined
              : filterCompanyId
            : sessionCompanyId,
          departmentId: canFilter && filterDepartmentId !== '' ? filterDepartmentId : undefined,
          status,
          fulfillmentType: fulfillmentFilter || undefined,
          q: query || undefined,
          skip,
          take: 40,
        });
        setTotal(res.total);
        setItems((prev) => (opts?.append ? [...prev, ...res.items] : res.items));
      } catch (err) {
        if (!opts?.append) setItems([]);
        setError(formatApiError(err, 'Impossible de charger les livraisons'));
      }
    },
    [
      canFilter,
      filterCompanyId,
      filterDepartmentId,
      fulfillmentFilter,
      lockedScope,
      query,
      sessionCompanyId,
      status,
    ],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
      if (canFilter) {
        void getCompanies()
          .then((list) => {
            setCompanies(list);
            if (!isAdminRole(user?.role) && sessionCompanyId != null) {
              setFilterCompanyId((prev) => (prev === '' ? sessionCompanyId : prev));
            } else if (list.length === 1) {
              setFilterCompanyId((prev) => (prev === '' ? list[0].id : prev));
            }
          })
          .catch(() => setCompanies([]));
      }
      const cid = canFilter
        ? filterCompanyId === ''
          ? undefined
          : filterCompanyId
        : sessionCompanyId;
      if (cid != null) {
        void getDepartments(cid)
          .then((list) => {
            const scoped = canFilter ? departmentsForUser(list, user) : list;
            setDepartments(scoped);
            setHomeDepartments(scoped.filter((d) => d.offersHomeDelivery));
          })
          .catch(() => {
            setDepartments([]);
            setHomeDepartments([]);
          });
      } else {
        setDepartments([]);
        setHomeDepartments([]);
      }
    }, [load, canFilter, filterCompanyId, sessionCompanyId, user]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function onEndReached() {
    if (loadingMore || items.length >= total) return;
    setLoadingMore(true);
    await load({ append: true, currentCount: items.length });
    setLoadingMore(false);
  }

  async function openDetail(row: Delivery) {
    setDetailError(null);
    try {
      const full = await getDeliveryById(row.id);
      setDetail(full);
      const remainingItem =
        (full.items ?? []).find((it) => {
          const rem = Number(
            it.quantityRemaining ??
              Math.max(0, Number(it.quantityOrdered) - Number(it.quantityDelivered)),
          );
          return rem > 0.0001;
        }) ?? full.items?.[0];
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
      setExecutorDraft(full.executorName?.trim() ?? '');
      setStockDeptId(full.departmentId ?? '');
      const stops = full.sale?.deliveryStops ?? [];
      const remStop = stops.find((s) => Number(s.quantityRemaining ?? s.quantity) > 0.0001);
      setDropStopId(remStop?.id ?? stops[0]?.id ?? '');
      const cid =
        full.companyId ??
        (typeof filterCompanyId === 'number' ? filterCompanyId : sessionCompanyId);
      if (isHomeDelivery(full) && full.departmentId == null && cid != null) {
        const list = await getDepartments(cid);
        setHomeDepartments(departmentsForUser(list, user).filter((d) => d.offersHomeDelivery));
      }
    } catch (err) {
      setError(formatApiError(err, 'Impossible d’ouvrir la fiche'));
    }
  }

  async function reprintDelivery(delivery: Delivery) {
    const saleId = delivery.sale?.id ?? delivery.saleId;
    if (!saleId) {
      setError('Vente introuvable pour impression');
      return;
    }
    setPrintingId(delivery.id);
    setDetailError(null);
    try {
      const sale = await getSaleById(saleId);
      const departmentId =
        delivery.departmentId ??
        sale.items?.[0]?.product?.departmentId ??
        (typeof user?.departmentId === 'number' ? user.departmentId : undefined);
      const receipt = await buildSaleReceiptDataFromSale(sale, departmentId);
      await printReceipt(receipt);
      setError(null);
      if (detail?.id === delivery.id) {
        setDetailError(null);
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'Impossible de réimprimer la fiche';
      if (detail?.id === delivery.id) setDetailError(reason);
      else setError(reason);
    } finally {
      setPrintingId(null);
    }
  }

  async function saveDetail(markAll = false) {
    if (!detail || !canManageDelivery(detail) || detail.status === 'DELIVERED') return;
    const home = isHomeDelivery(detail);
    const deptId = typeof stockDeptId === 'number' ? stockDeptId : detail.departmentId;
    if (deptId == null) {
      setDetailError(
        home ? 'Choisissez le département qui livre à domicile' : 'Choisissez le département',
      );
      return;
    }
    if (home && !executorDraft.trim()) {
      setDetailError('Indiquez le livreur');
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
                  executorName: executorDraft.trim(),
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
                  executorName: executorDraft.trim(),
                  stopId: dropStopId === '' ? null : dropStopId,
                }
              : { executorName: executorDraft.trim() || null }),
          });
      setDetail(updated);
      setExecutorDraft(updated.executorName?.trim() ?? '');
      setStockDeptId(updated.departmentId ?? deptId);
      await load();
    } catch (e) {
      setDetailError(formatApiError(e, 'Enregistrement impossible'));
    } finally {
      setSaving(false);
    }
  }

  async function saveExecutorOnly() {
    if (!detail || (!canManageDelivery(detail) && !canChangeExecutor)) return;
    if (!isHomeDelivery(detail)) return;
    setSaving(true);
    setDetailError(null);
    try {
      const updated = await updateDelivery(detail.id, {
        executorName: executorDraft.trim() || null,
      });
      setDetail(updated);
      setExecutorDraft(updated.executorName?.trim() ?? '');
      await load();
    } catch (e) {
      setDetailError(formatApiError(e, 'Enregistrement impossible'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.search}
          placeholder="N° fiche ou client…"
          placeholderTextColor={BrandColors.textMuted}
          value={q}
          onChangeText={setQ}
          returnKeyType="search"
          onSubmitEditing={() => setQuery(q.trim())}
        />
        <Pressable style={styles.searchBtn} onPress={() => setQuery(q.trim())}>
          <Text style={styles.searchBtnText}>OK</Text>
        </Pressable>
      </View>
      <View style={styles.filterRow}>
        {(
          [
            { id: '', label: 'Toutes' },
            { id: 'ON_SITE', label: 'Sur place' },
            { id: 'HOME', label: 'À domicile' },
          ] as const
        ).map((opt) => (
          <Pressable
            key={opt.id || 'all'}
            style={[styles.filterChip, fulfillmentFilter === opt.id && styles.filterChipActive]}
            onPress={() => setFulfillmentFilter(opt.id)}>
            <Text
              style={[
                styles.filterChipText,
                fulfillmentFilter === opt.id && styles.filterChipTextActive,
              ]}>
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>
      {canFilter ? (
        <>
          {companies.length > 1 ? (
            <View style={styles.filterRow}>
              <Pressable
                style={[styles.filterChip, filterCompanyId === '' && styles.filterChipActive]}
                onPress={() => {
                  setFilterCompanyId('');
                  setFilterDepartmentId('');
                }}>
                <Text
                  style={[
                    styles.filterChipText,
                    filterCompanyId === '' && styles.filterChipTextActive,
                  ]}>
                  Entreprises
                </Text>
              </Pressable>
              {companies.map((c) => (
                <Pressable
                  key={c.id}
                  style={[styles.filterChip, filterCompanyId === c.id && styles.filterChipActive]}
                  onPress={() => {
                    setFilterCompanyId(c.id);
                    setFilterDepartmentId('');
                  }}>
                  <Text
                    style={[
                      styles.filterChipText,
                      filterCompanyId === c.id && styles.filterChipTextActive,
                    ]}
                    numberOfLines={1}>
                    {c.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {departments.length > 0 ? (
            <View style={styles.filterRow}>
              <Pressable
                style={[styles.filterChip, filterDepartmentId === '' && styles.filterChipActive]}
                onPress={() => setFilterDepartmentId('')}>
                <Text
                  style={[
                    styles.filterChipText,
                    filterDepartmentId === '' && styles.filterChipTextActive,
                  ]}>
                  Départements
                </Text>
              </Pressable>
              {departments.map((d) => (
                <Pressable
                  key={d.id}
                  style={[
                    styles.filterChip,
                    filterDepartmentId === d.id && styles.filterChipActive,
                  ]}
                  onPress={() => setFilterDepartmentId(d.id)}>
                  <Text
                    style={[
                      styles.filterChipText,
                      filterDepartmentId === d.id && styles.filterChipTextActive,
                    ]}
                    numberOfLines={1}>
                    {d.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Text style={styles.count}>{total} livraison(s)</Text>

      <FlatList
        data={items}
        numColumns={2}
        keyExtractor={(d) => String(d.id)}
        contentContainerStyle={styles.list}
        columnWrapperStyle={styles.cardRow}
        refreshing={refreshing}
        onRefresh={() => void onRefresh()}
        onEndReached={() => void onEndReached()}
        onEndReachedThreshold={0.4}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={styles.empty}>Aucune livraison</Text>}
        ListFooterComponent={
          loadingMore ? <ActivityIndicator color={BrandColors.primary} style={{ margin: 12 }} /> : null
        }
        renderItem={({ item }) => {
          const busyPrint = printingId === item.id;
          return (
            <View style={styles.card}>
              <Pressable onPress={() => void openDetail(item)}>
                <View style={styles.cardTop}>
                  <Text style={styles.cardRef}>
                    Vente #{item.saleRef ?? item.sale?.txnNumber ?? item.sale?.id ?? item.saleId}
                  </Text>
                  <View style={[styles.badge, { backgroundColor: `${STATUS_COLOR[item.status]}22` }]}>
                    <Text style={[styles.badgeText, { color: STATUS_COLOR[item.status] }]}>
                      {STATUS_LABEL[item.status]}
                    </Text>
                  </View>
                </View>
                <Text style={styles.client} numberOfLines={2}>
                  {item.sale?.clientName?.trim() || 'Client'}
                  {isHomeDelivery(item) ? ' · À domicile' : ''}
                </Text>
                <Text style={styles.meta} numberOfLines={2}>
                  {isHomeDelivery(item)
                    ? [
                        item.company?.name,
                        item.department?.name ? `Livré depuis ${item.department.name}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || '—'
                    : [item.company?.name, item.department?.name].filter(Boolean).join(' · ') || '—'}
                </Text>
                <View style={styles.cardFoot}>
                  <Text style={styles.meta}>
                    {formatDateTime(item.sale?.createdAt ?? item.createdAt)}
                  </Text>
                  <MoneyText value={item.sale?.total} style={styles.total} />
                </View>
              </Pressable>
              {canPrintFiche ? (
              <Pressable
                style={[styles.cardPrintBtn, (busyPrint || printingId != null) && styles.disabled]}
                disabled={busyPrint || printingId != null}
                onPress={() => void reprintDelivery(item)}>
                {busyPrint ? (
                  <ActivityIndicator color={BrandColors.primary} />
                ) : (
                  <Text style={styles.cardPrintText}>Imprimer</Text>
                )}
              </Pressable>
              ) : null}
            </View>
          );
        }}
      />

      <ModalShell
        visible={detail != null}
        onRequestClose={() => setDetail(null)}
        body={
          detail ? (
            <FlatList
              data={detail.items ?? []}
              keyExtractor={(it) => String(it.saleItemId)}
              contentContainerStyle={styles.detailList}
              ListHeaderComponent={
                <View style={styles.detailHeader}>
                  <Text style={styles.detailTitle}>
                    Vente #
                    {detail.saleRef ??
                      detail.sale?.txnNumber ??
                      detail.sale?.id ??
                      detail.saleId}
                  </Text>
                  <Text style={styles.client}>{detail.sale?.clientName?.trim() || 'Client'}</Text>
                  <Text style={styles.meta}>
                    {isHomeDelivery(detail) ? 'À domicile' : 'Sur place'} ·{' '}
                    {STATUS_LABEL[detail.status]} · {formatMoney(detail.sale?.total)}
                  </Text>
                  <Text style={styles.meta}>
                    {isHomeDelivery(detail)
                      ? [
                          detail.company?.name,
                          detail.department?.name
                            ? `Livré depuis ${detail.department.name}`
                            : null,
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
                    <Text key={st.id || st.address} style={styles.meta}>
                      {st.address}
                      {Number(st.quantity) > 0
                        ? ` · ${formatQuantity(Number(st.quantityDelivered ?? 0))} / ${formatQuantity(Number(st.quantity))}`
                        : ''}
                    </Text>
                  ))}
                  {canManageDelivery(detail) && detail.status !== 'DELIVERED' ? (
                    <View style={styles.executorBlock}>
                      <Text style={styles.meta}>
                        {isHomeDelivery(detail) ? 'Département de livraison' : 'Département'}
                      </Text>
                      {(() => {
                        const deptChoices = isHomeDelivery(detail) ? homeDepartments : departments;
                        if (!deptChoices.length) {
                          return (
                            <Text style={styles.meta}>
                              {isHomeDelivery(detail)
                                ? 'Aucun département n’est coché pour les livraisons à domicile.'
                                : 'Aucun département'}
                            </Text>
                          );
                        }
                        return deptChoices.map((d) => (
                          <Pressable
                            key={d.id}
                            onPress={() => setStockDeptId(d.id)}
                            style={[
                              styles.deptChip,
                              stockDeptId === d.id && styles.deptChipActive,
                            ]}>
                            <Text
                              style={[
                                styles.deptChipText,
                                stockDeptId === d.id && styles.deptChipTextActive,
                              ]}>
                              {d.name}
                            </Text>
                          </Pressable>
                        ));
                      })()}
                      <Text style={styles.meta}>Quantité livrée</Text>
                      <TextInput
                        style={styles.executorInput}
                        keyboardType="decimal-pad"
                        value={dropQty}
                        editable={!saving}
                        onChangeText={setDropQty}
                      />
                    </View>
                  ) : null}
                  {isHomeDelivery(detail) &&
                  (canManageDelivery(detail) ||
                    canChangeExecutor ||
                    detail.executorName?.trim()) ? (
                    <View style={styles.executorBlock}>
                      <Text style={styles.meta}>Exécuté par</Text>
                      <TextInput
                        style={styles.executorInput}
                        value={executorDraft}
                        editable={
                          !(Boolean(detail.executorName?.trim()) && !canChangeExecutor) && !saving
                        }
                        placeholder="Nom de la personne qui a livré"
                        onChangeText={setExecutorDraft}
                      />
                    </View>
                  ) : null}
                </View>
              }
              renderItem={({ item: it }) => {
                const label =
                  it.saleItem?.lineLabel ||
                  it.saleItem?.product?.name ||
                  `Article #${it.saleItemId}`;
                const remaining = Number(
                  it.quantityRemaining ??
                    Math.max(0, Number(it.quantityOrdered) - Number(it.quantityDelivered)),
                );
                const selectedLine = dropSaleItemId === it.saleItemId;
                const editable = canManageDelivery(detail) && detail.status !== 'DELIVERED';
                return (
                  <Pressable
                    style={styles.lineRow}
                    disabled={!editable}
                    onPress={() => {
                      setDropSaleItemId(it.saleItemId);
                      setDropQty(String(remaining));
                    }}>
                    <View style={styles.rowInfo}>
                      <Text style={styles.rowTitle} numberOfLines={2}>
                        {label}
                        {selectedLine && editable ? ' ·' : ''}
                      </Text>
                      <Text style={styles.meta}>
                        Livré {formatQuantity(it.quantityDelivered)} · Reste{' '}
                        {formatQuantity(remaining)}
                      </Text>
                    </View>
                  </Pressable>
                );
              }}
            />
          ) : null
        }
        footer={
          detail ? (
            <View style={styles.footer}>
              {detailError ? <Text style={styles.error}>{detailError}</Text> : null}
              <View style={styles.footerActions}>
                <Pressable style={styles.secondaryBtn} onPress={() => setDetail(null)}>
                  <Text style={styles.secondaryBtnText}>Fermer</Text>
                </Pressable>
                {canPrintFiche ? (
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
                {canManageDelivery(detail) && detail.status !== 'DELIVERED' ? (
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
                    <Text style={styles.secondaryBtnText}>Enregistrer le nom</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : null
        }>
        <View style={styles.modalTop}>
          <Text style={styles.modalTopTitle}>Livraison</Text>
          <Pressable onPress={() => setDetail(null)} hitSlop={12}>
            <Text style={styles.modalClose}>Fermer</Text>
          </Pressable>
        </View>
      </ModalShell>
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  filterChip: {
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: BrandColors.surface,
  },
  filterChipActive: {
    backgroundColor: BrandColors.primary,
    borderColor: BrandColors.primary,
  },
  filterChipText: { fontWeight: '700', color: BrandColors.text, fontSize: 13 },
  filterChipTextActive: { color: '#fff' },
  search: {
    flex: 1,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    backgroundColor: BrandColors.surface,
    color: BrandColors.text,
  },
  searchBtn: {
    backgroundColor: BrandColors.primary,
    borderRadius: 12,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  searchBtnText: { color: '#fff', fontWeight: '700' },
  error: {
    color: BrandColors.danger,
    fontWeight: '600',
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.two,
  },
  count: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    color: BrandColors.textMuted,
    fontSize: 13,
  },
  list: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.two },
  cardRow: { justifyContent: 'space-between', gap: Spacing.two },
  empty: { textAlign: 'center', color: BrandColors.textMuted, marginTop: Spacing.five },
  card: {
    width: '48.5%',
    backgroundColor: BrandColors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: Spacing.three,
    gap: 6,
  },
  cardPrintBtn: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: BrandColors.surfaceSoft,
  },
  cardPrintText: { fontWeight: '700', color: BrandColors.text },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardRef: { fontSize: 16, fontWeight: '700', color: BrandColors.text },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  client: { fontSize: 15, fontWeight: '600', color: BrandColors.text },
  meta: { fontSize: 12, color: BrandColors.textMuted },
  cardFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  total: { fontWeight: '700', color: BrandColors.text },
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: BrandColors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: Spacing.three,
    marginBottom: Spacing.two,
  },
  rowInfo: { flex: 1, gap: 2 },
  rowTitle: { fontWeight: '600', color: BrandColors.text },
  rowValue: { fontWeight: '700', color: BrandColors.text },
  qtyInput: {
    width: 88,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlign: 'right',
    color: BrandColors.text,
  },
  footer: { padding: Spacing.three, gap: Spacing.two, backgroundColor: BrandColors.bg },
  footerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  secondaryBtn: {
    flexGrow: 1,
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
    backgroundColor: BrandColors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.55 },
  executorBlock: { marginTop: Spacing.two, gap: 6 },
  deptChip: {
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: 8,
    backgroundColor: BrandColors.surface,
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
