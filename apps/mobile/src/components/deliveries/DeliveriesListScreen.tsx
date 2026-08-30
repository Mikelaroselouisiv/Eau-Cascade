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

import { Screen } from '@/components/Screen';
import { DeliveryExecuteModal } from '@/components/deliveries/DeliveryExecuteModal';
import { DeliveryFicheCard } from '@/components/deliveries/DeliveryFicheCard';
import { isHomeDelivery } from '@/components/deliveries/deliveryFiche';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import {
  getCompanies,
  getDepartments,
  getSaleById,
  listDeliveries,
} from '@/services/api';
import { formatApiError } from '@/services/api-errors';
import { printReceipt } from '@/services/bluetooth-printer';
import { buildSaleReceiptDataFromSale } from '@/services/receipt';
import type { CompanyListItem, Delivery, DeliveryStatus, Department } from '@/types/api';
import { canEditDeliveryExecutor, departmentsForUser, isAdminRole } from '@/utils/user-scope';

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

  const [selectedId, setSelectedId] = useState<number | null>(null);
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
          })
          .catch(() => {
            setDepartments([]);
          });
      } else {
        setDepartments([]);
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

  async function reprintDelivery(delivery: Delivery) {
    const saleId = delivery.sale?.id ?? delivery.saleId;
    if (!saleId) {
      setError('Vente introuvable pour impression');
      return;
    }
    setPrintingId(delivery.id);
    try {
      const sale = await getSaleById(saleId);
      const departmentId =
        delivery.departmentId ??
        sale.items?.[0]?.product?.departmentId ??
        (typeof user?.departmentId === 'number' ? user.departmentId : undefined);
      const receipt = await buildSaleReceiptDataFromSale(sale, departmentId);
      await printReceipt(receipt);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible de réimprimer la fiche');
    } finally {
      setPrintingId(null);
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
          (user?.role === 'CASHIER'
            ? [
                { id: '', label: 'Toutes' },
                { id: 'ON_SITE', label: 'Sur place' },
              ]
            : [
                { id: '', label: 'Toutes' },
                { id: 'ON_SITE', label: 'Sur place' },
                { id: 'HOME', label: 'À domicile' },
              ]) as const
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
        renderItem={({ item }) => (
          <DeliveryFicheCard
            delivery={item}
            canPrint={canPrintFiche}
            printing={printingId === item.id}
            printBusy={printingId != null}
            onOpen={(row) => setSelectedId(row.id)}
            onPrint={(row) => void reprintDelivery(row)}
          />
        )}
      />

      <DeliveryExecuteModal
        deliveryId={selectedId}
        canManage={canManageDelivery}
        canPrint={canPrintFiche}
        canChangeExecutor={canChangeExecutor}
        onClose={() => setSelectedId(null)}
        onUpdated={() => {
          void load();
        }}
      />
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
});
