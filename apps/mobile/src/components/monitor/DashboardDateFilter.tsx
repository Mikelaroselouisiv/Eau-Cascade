import { Ionicons } from '@expo/vector-icons';
import { createElement, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ChipScroll } from '@/components/ChipScroll';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import {
  businessTodayYmd,
  dashboardPresetRange,
  formatYmdDisplay,
  formatYmdParts,
  matchDashboardPreset,
  normalizeDateRange,
  parseYmd,
  type DashboardDatePreset,
} from '@/utils/datetime';

const PRESETS: { key: DashboardDatePreset; label: string }[] = [
  { key: 'today', label: 'Aujourd’hui' },
  { key: 'yesterday', label: 'Hier' },
  { key: 'dayBefore', label: 'Avant-hier' },
  { key: 'week', label: '7 jours' },
  { key: 'month', label: 'Mois' },
];

const WEEKDAYS = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'];

type PickerField = 'from' | 'to';

type Props = {
  dateFrom: string;
  dateTo: string;
  onChange: (dateFrom: string, dateTo: string) => void;
  minYmd?: string | null;
  maxYmd?: string | null;
};

function shiftMonth(ymd: string, delta: number): string {
  const parts = parseYmd(ymd);
  if (!parts) return ymd;
  const next = new Date(Date.UTC(parts.year, parts.month - 1 + delta, 1));
  return formatYmdParts(next.getUTCFullYear(), next.getUTCMonth() + 1, 1);
}

function monthCells(year: number, month: number): (string | null)[] {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const mondayBased = (firstDow + 6) % 7;
  const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < mondayBased; i += 1) cells.push(null);
  for (let day = 1; day <= dim; day += 1) cells.push(formatYmdParts(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function monthTitle(year: number, month: number): string {
  return new Intl.DateTimeFormat('fr-HT', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

export function DashboardDateFilter({
  dateFrom,
  dateTo,
  onChange,
  minYmd,
  maxYmd,
}: Props) {
  const today = businessTodayYmd();
  const maxBound = maxYmd ?? today;
  const activePreset = matchDashboardPreset(dateFrom, dateTo);
  const [picker, setPicker] = useState<PickerField | null>(null);
  const [cursor, setCursor] = useState(dateFrom || today);

  const cursorParts = parseYmd(cursor) ?? parseYmd(today)!;
  const cells = useMemo(
    () => monthCells(cursorParts.year, cursorParts.month),
    [cursorParts.month, cursorParts.year],
  );

  function emit(from: string, to: string) {
    const next = normalizeDateRange(from, to, minYmd, maxBound);
    onChange(next.dateFrom, next.dateTo);
  }

  function applyPreset(preset: DashboardDatePreset) {
    const range = dashboardPresetRange(preset);
    emit(range.dateFrom, range.dateTo);
  }

  function openPicker(field: PickerField) {
    setCursor(field === 'from' ? dateFrom : dateTo);
    setPicker(field);
  }

  function selectDay(ymd: string) {
    if (picker === 'from') emit(ymd, dateTo);
    else emit(dateFrom, ymd);
    setPicker(null);
  }

  const canPrevMonth = !minYmd || shiftMonth(cursor, 0) > monthStartOf(minYmd);
  const canNextMonth = shiftMonth(cursor, 1) <= monthStartOf(maxBound);

  return (
    <View style={styles.root}>
      <ChipScroll>
        {PRESETS.filter((opt) => {
          if (!minYmd) return true;
          return dashboardPresetRange(opt.key).dateFrom >= minYmd;
        }).map((opt) => {
          const active = opt.key === activePreset;
          return (
            <Pressable
              key={opt.key}
              onPress={() => applyPreset(opt.key)}
              style={[styles.chip, active && styles.chipActive]}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </ChipScroll>

      <View style={styles.fields}>
        <DateField
          label="Du"
          value={dateFrom}
          min={minYmd ?? undefined}
          max={maxBound}
          onPress={() => openPicker('from')}
          onChange={(ymd) => emit(ymd, dateTo)}
        />
        <DateField
          label="Au"
          value={dateTo}
          min={minYmd ?? undefined}
          max={maxBound}
          onPress={() => openPicker('to')}
          onChange={(ymd) => emit(dateFrom, ymd)}
        />
      </View>

      <Modal
        visible={picker != null}
        transparent
        animationType="fade"
        onRequestClose={() => setPicker(null)}>
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPicker(null)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Pressable
                onPress={() => canPrevMonth && setCursor(shiftMonth(cursor, -1))}
                style={[styles.monthNav, !canPrevMonth && styles.monthNavDisabled]}
                disabled={!canPrevMonth}
                hitSlop={8}>
                <Ionicons
                  name="chevron-back"
                  size={20}
                  color={canPrevMonth ? BrandColors.text : BrandColors.borderStrong}
                />
              </Pressable>
              <Text style={styles.monthTitle}>{monthTitle(cursorParts.year, cursorParts.month)}</Text>
              <Pressable
                onPress={() => canNextMonth && setCursor(shiftMonth(cursor, 1))}
                style={[styles.monthNav, !canNextMonth && styles.monthNavDisabled]}
                disabled={!canNextMonth}
                hitSlop={8}>
                <Ionicons
                  name="chevron-forward"
                  size={20}
                  color={canNextMonth ? BrandColors.text : BrandColors.borderStrong}
                />
              </Pressable>
            </View>

            <View style={styles.weekRow}>
              {WEEKDAYS.map((day) => (
                <Text key={day} style={styles.weekday}>
                  {day}
                </Text>
              ))}
            </View>

            <View style={styles.grid}>
              {cells.map((ymd, index) => {
                if (!ymd) return <View key={`empty-${index}`} style={styles.dayCell} />;
                const disabled = (minYmd != null && ymd < minYmd) || ymd > maxBound;
                const selected = ymd === (picker === 'from' ? dateFrom : dateTo);
                const inRange = ymd >= dateFrom && ymd <= dateTo;
                return (
                  <Pressable
                    key={ymd}
                    disabled={disabled}
                    onPress={() => selectDay(ymd)}
                    style={[
                      styles.dayCell,
                      inRange && !selected && styles.dayInRange,
                      selected && styles.daySelected,
                      disabled && styles.dayDisabled,
                    ]}>
                    <Text
                      style={[
                        styles.dayText,
                        selected && styles.dayTextSelected,
                        disabled && styles.dayTextDisabled,
                      ]}>
                      {Number(ymd.slice(8))}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function monthStartOf(ymd: string): string {
  const parts = parseYmd(ymd);
  if (!parts) return ymd;
  return formatYmdParts(parts.year, parts.month, 1);
}

function DateField({
  label,
  value,
  min,
  max,
  onPress,
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  max?: string;
  onPress: () => void;
  onChange: (ymd: string) => void;
}) {
  if (Platform.OS === 'web') {
    return (
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {createElement('input', {
          type: 'date',
          value,
          min: min || undefined,
          max: max || undefined,
          onChange: (event: { target: { value: string } }) => {
            if (event.target.value) onChange(event.target.value);
          },
          style: {
            width: '100%',
            boxSizing: 'border-box',
            border: `1px solid ${BrandColors.borderStrong}`,
            borderRadius: 12,
            padding: '10px 12px',
            fontSize: 15,
            fontWeight: '600',
            color: BrandColors.text,
            backgroundColor: BrandColors.surface,
            fontFamily: 'inherit',
          },
        })}
      </View>
    );
  }

  return (
    <Pressable style={styles.field} onPress={onPress}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldValue}>
        <Ionicons name="calendar-outline" size={16} color={BrandColors.primary} />
        <Text style={styles.fieldValueText}>{formatYmdDisplay(value)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { gap: Spacing.two },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    backgroundColor: BrandColors.surface,
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: 'flex-start',
  },
  chipActive: {
    backgroundColor: BrandColors.primary,
    borderColor: BrandColors.primary,
  },
  chipText: { fontSize: 13, fontWeight: '600', color: BrandColors.text },
  chipTextActive: { color: '#fff' },
  fields: { flexDirection: 'row', gap: Spacing.two },
  field: { flex: 1, gap: 4 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: BrandColors.textMuted },
  fieldValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    backgroundColor: BrandColors.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  fieldValueText: { fontSize: 15, fontWeight: '600', color: BrandColors.text },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(10, 37, 64, 0.45)',
    justifyContent: 'center',
    padding: Spacing.three,
  },
  sheet: {
    backgroundColor: BrandColors.surface,
    borderRadius: 18,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  monthNav: { padding: 6 },
  monthNavDisabled: { opacity: 0.4 },
  monthTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
    color: BrandColors.text,
    textTransform: 'capitalize',
  },
  weekRow: { flexDirection: 'row' },
  weekday: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
    color: BrandColors.textMuted,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: {
    width: '14.285%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  dayInRange: { backgroundColor: BrandColors.primarySoft },
  daySelected: { backgroundColor: BrandColors.primary },
  dayDisabled: { opacity: 0.35 },
  dayText: { fontSize: 14, fontWeight: '600', color: BrandColors.text },
  dayTextSelected: { color: '#fff' },
  dayTextDisabled: { color: BrandColors.textMuted },
});
