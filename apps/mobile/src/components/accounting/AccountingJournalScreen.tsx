import type { ReactNode } from 'react';
import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';

import { BrandColors } from '@/constants/brand';
import { useAccountingScope } from '@/context/AccountingScopeContext';
import { getAccountingJournal } from '@/services/api';
import { formatApiError } from '@/services/api-errors';
import type { JournalEntryRow } from '@/types/api';
import { ymdFromIso } from '@/utils/datetime';

import { AccountingEmptyState } from './AccountingEmptyState';
import { formatMoneyIfPositive, journalRef } from './accountingFormat';
import { AccountingPageShell } from './AccountingPageShell';
import { accountingStyles as styles } from './accountingStyles';

const PAGE_SIZE = 40;

export function AccountingJournalScreen({ extraHeader }: { extraHeader?: ReactNode }) {
  const { companyId, selectedYear, appliedDateFrom, appliedDateTo, canView, ready } =
    useAccountingScope();
  const [items, setItems] = useState<JournalEntryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const itemsRef = useRef<JournalEntryRow[]>([]);
  itemsRef.current = items;

  const load = useCallback(
    async (mode: 'replace' | 'append') => {
      if (!canView || companyId == null) return;
      if (!selectedYear?.id) {
        setItems([]);
        setTotal(0);
        setError(null);
        return;
      }
      try {
        setError(null);
        const skip = mode === 'append' ? itemsRef.current.length : 0;
        const journal = await getAccountingJournal({
          companyId,
          fiscalYearId: selectedYear.id,
          dateFrom: appliedDateFrom || undefined,
          dateTo: appliedDateTo || undefined,
          skip,
          take: PAGE_SIZE,
        });
        setTotal(journal.total);
        setItems((prev) => (mode === 'append' ? [...prev, ...journal.items] : journal.items));
      } catch (err) {
        if (mode === 'replace') setItems([]);
        setError(formatApiError(err, 'Impossible de charger le journal'));
      }
    },
    [canView, companyId, selectedYear?.id, appliedDateFrom, appliedDateTo],
  );

  useFocusEffect(
    useCallback(() => {
      if (!ready) return;
      void load('replace');
    }, [ready, load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load('replace');
    setRefreshing(false);
  }

  async function onLoadMore() {
    if (loadingMore || items.length >= total) return;
    setLoadingMore(true);
    await load('append');
    setLoadingMore(false);
  }

  return (
    <AccountingPageShell extraHeader={extraHeader} showDates>
      {!selectedYear ? (
        <AccountingEmptyState>Aucun exercice sélectionné.</AccountingEmptyState>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              tintColor={BrandColors.primary}
              colors={[BrandColors.primary]}
            />
          }
          contentContainerStyle={{ paddingBottom: 24, paddingHorizontal: 4 }}
          ListHeaderComponent={
            <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 6 }}>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Text style={styles.meta}>
                {items.length} affichée(s) sur {total}
              </Text>
              <View style={styles.tableHead}>
                <Text style={[styles.tableHeadText, styles.colDate]}>Date</Text>
                <Text style={[styles.tableHeadText, { width: 72 }]}>N°</Text>
                <Text style={[styles.tableHeadText, { flex: 1 }]}>Libellé</Text>
              </View>
            </View>
          }
          ListEmptyComponent={
            !error ? (
              <AccountingEmptyState>
                Aucune écriture sur la période (exercice ouvert requis).
              </AccountingEmptyState>
            ) : null
          }
          ListFooterComponent={
            items.length < total ? (
              <Pressable
                style={[styles.secondaryBtn, { margin: 16 }, loadingMore && styles.disabled]}
                disabled={loadingMore}
                onPress={() => void onLoadMore()}>
                {loadingMore ? (
                  <ActivityIndicator color={BrandColors.primary} />
                ) : (
                  <Text style={styles.secondaryBtnText}>Charger plus</Text>
                )}
              </Pressable>
            ) : null
          }
          renderItem={({ item }) => {
            const open = expandedId === item.id;
            return (
              <View>
                <Pressable
                  onPress={() => setExpandedId(open ? null : item.id)}
                  style={styles.entryHead}>
                  <Text style={styles.entryHeadTitle} numberOfLines={2}>
                    {ymdFromIso(item.entryDate)} · {journalRef(item.journalCode, item.entryNumber)}
                    {'\n'}
                    {item.description}
                  </Text>
                  <Text style={styles.meta}>{open ? 'Masquer' : 'Détail'}</Text>
                </Pressable>
                {open
                  ? item.lines.map((line) => (
                      <View key={line.id} style={styles.denseRow}>
                        <Text style={styles.colCode}>{line.account.code}</Text>
                        <Text style={styles.colName} numberOfLines={2}>
                          {line.label || line.account.name}
                        </Text>
                        <Text style={styles.colAmt}>{formatMoneyIfPositive(line.debit)}</Text>
                        <Text style={styles.colAmt}>{formatMoneyIfPositive(line.credit)}</Text>
                      </View>
                    ))
                  : null}
              </View>
            );
          }}
        />
      )}
    </AccountingPageShell>
  );
}
