import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { MoneyText } from '@/components/MoneyText';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import type { Delivery } from '@/types/api';
import { formatDateTimeShort } from '@/utils/datetime';
import {
  DELIVERY_STATUS_COLOR,
  DELIVERY_STATUS_LABEL,
  deliverySaleRef,
  isHomeDelivery,
} from './deliveryFiche';

type Props = {
  delivery: Delivery;
  canPrint?: boolean;
  printing?: boolean;
  printBusy?: boolean;
  onOpen: (d: Delivery) => void;
  onPrint?: (d: Delivery) => void;
};

export function DeliveryFicheCard({
  delivery: item,
  canPrint,
  printing,
  printBusy,
  onOpen,
  onPrint,
}: Props) {
  const home = isHomeDelivery(item);
  const statusColor = DELIVERY_STATUS_COLOR[item.status];
  const place = home
    ? item.department?.name
      ? `Depuis ${item.department.name}`
      : item.company?.name ?? ''
    : [item.department?.name, item.company?.name].filter(Boolean).join(' · ');

  return (
    <View style={styles.card}>
      <View style={[styles.rail, { backgroundColor: statusColor }]} />
      <Pressable style={styles.body} onPress={() => onOpen(item)}>
        <View style={styles.top}>
          <Text style={styles.ref} numberOfLines={1}>
            #{deliverySaleRef(item)}
          </Text>
          <View style={styles.chips}>
            <View style={[styles.chip, { backgroundColor: `${statusColor}22` }]}>
              <Text style={[styles.chipText, { color: statusColor }]} numberOfLines={1}>
                {DELIVERY_STATUS_LABEL[item.status]}
              </Text>
            </View>
            <View style={[styles.chip, home ? styles.chipHome : styles.chipOnSite]}>
              <Text style={[styles.chipText, home ? styles.chipHomeText : styles.chipOnSiteText]} numberOfLines={1}>
                {home ? 'Domicile' : 'Sur place'}
              </Text>
            </View>
          </View>
        </View>
        <Text style={styles.client} numberOfLines={1}>
          {item.sale?.clientName?.trim() || 'Client'}
        </Text>
        {place ? (
          <Text style={styles.meta} numberOfLines={1}>
            {place}
          </Text>
        ) : null}
        {home && item.sale?.clientPhone?.trim() ? (
          <Text style={styles.meta} numberOfLines={1}>
            {item.sale.clientPhone.trim()}
          </Text>
        ) : null}
        <View style={styles.foot}>
          <Text style={styles.when} numberOfLines={1}>
            {formatDateTimeShort(item.sale?.createdAt ?? item.createdAt)}
          </Text>
          <MoneyText value={item.sale?.total} style={styles.total} numberOfLines={1} />
        </View>
        {home && item.executorName?.trim() ? (
          <Text style={styles.executor} numberOfLines={1}>
            {item.executorName.trim()}
          </Text>
        ) : null}
      </Pressable>
      {canPrint && onPrint ? (
        <Pressable
          style={[styles.printBtn, (printing || printBusy) && styles.disabled]}
          disabled={printing || printBusy}
          onPress={() => onPrint(item)}
          hitSlop={8}>
          {printing ? (
            <ActivityIndicator color={BrandColors.primary} />
          ) : (
            <Text style={styles.printText}>Imprimer</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: BrandColors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BrandColors.border,
    overflow: 'hidden',
  },
  rail: { width: 4 },
  body: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 3,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ref: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 12,
    fontWeight: '700',
    color: BrandColors.textMuted,
  },
  chips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 'auto',
    flexShrink: 0,
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  chipText: { fontSize: 11, fontWeight: '700' },
  chipHome: { backgroundColor: BrandColors.primarySoft },
  chipHomeText: { color: BrandColors.primary },
  chipOnSite: { backgroundColor: BrandColors.surfaceSoft },
  chipOnSiteText: { color: BrandColors.textMuted },
  client: {
    fontSize: 16,
    fontWeight: '700',
    color: BrandColors.text,
  },
  meta: { fontSize: 12, color: BrandColors.textMuted },
  foot: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 4,
  },
  when: { flex: 1, minWidth: 0, fontSize: 12, color: BrandColors.textMuted },
  total: { flexShrink: 0, fontWeight: '700', color: BrandColors.text },
  executor: { fontSize: 12, fontWeight: '600', color: BrandColors.text },
  printBtn: {
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderLeftWidth: 1,
    borderLeftColor: BrandColors.border,
    backgroundColor: BrandColors.surfaceSoft,
  },
  printText: { fontSize: 11, fontWeight: '700', color: BrandColors.primary },
  disabled: { opacity: 0.55 },
});
