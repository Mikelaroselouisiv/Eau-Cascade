import { Pressable, Text, TextInput, View } from 'react-native';

import { ChipScroll } from '@/components/ChipScroll';
import { BrandColors } from '@/constants/brand';
import { useAccountingScope } from '@/context/AccountingScopeContext';
import { ymdFromIso } from '@/utils/datetime';

import { accountingStyles as styles } from './accountingStyles';

export function FiscalYearBar({ showDates = false }: { showDates?: boolean }) {
  const {
    years,
    selectedYear,
    setSelectedYearId,
    dateFrom,
    dateTo,
    setDateFrom,
    setDateTo,
    applyDates,
    loadingOverview,
  } = useAccountingScope();

  if (years.length === 0) {
    return (
      <View style={styles.stickyHeader}>
        <Text style={styles.empty}>
          {loadingOverview
            ? 'Chargement des exercices…'
            : 'Aucun exercice. Ouvrez-en un dans Plus → Exercices.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.stickyHeader}>
      <ChipScroll contentStyle={styles.fyChipScroll}>
        {years.map((year) => {
          const active = year.id === selectedYear?.id;
          return (
            <Pressable
              key={year.id}
              onPress={() => setSelectedYearId(year.id)}
              style={[styles.chip, active && styles.chipActive]}>
              <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                {year.label}
                {year.status === 'CLOSED' ? ' · clôturé' : ''}
              </Text>
            </Pressable>
          );
        })}
      </ChipScroll>
      {selectedYear ? (
        <Text style={styles.fyMeta}>
          {ymdFromIso(selectedYear.startDate)} → {ymdFromIso(selectedYear.endDate)}
          {selectedYear.status === 'OPEN' ? ' · ouvert' : ' · clôturé'}
        </Text>
      ) : null}
      {showDates && selectedYear ? (
        <>
          <View style={styles.row}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.fieldLabel}>Du</Text>
              <TextInput
                style={styles.input}
                value={dateFrom}
                onChangeText={setDateFrom}
                placeholder="AAAA-MM-JJ"
                placeholderTextColor={BrandColors.textMuted}
                autoCapitalize="none"
              />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.fieldLabel}>Au</Text>
              <TextInput
                style={styles.input}
                value={dateTo}
                onChangeText={setDateTo}
                placeholder="AAAA-MM-JJ"
                placeholderTextColor={BrandColors.textMuted}
                autoCapitalize="none"
              />
            </View>
          </View>
          <Pressable style={styles.secondaryBtn} onPress={applyDates}>
            <Text style={styles.secondaryBtnText}>Actualiser</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}
