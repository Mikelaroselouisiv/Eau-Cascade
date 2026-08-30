import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { MoneyText } from '@/components/MoneyText';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import type { Delivery } from '@/types/api';
import { formatDateTime } from '@/utils/datetime';
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
  return (
    <View style={styles.card}>
      <Pressable onPress={() => onOpen(item)}>
        <View style={styles.cardTop}>
          <Text style={styles.cardRef}>Vente #{deliverySaleRef(item)}</Text>
          <View style={[styles.badge, { backgroundColor: `${DELIVERY_STATUS_COLOR[item.status]}22` }]}>
            <Text style={[styles.badgeText, { color: DELIVERY_STATUS_COLOR[item.status] }]}>
              {DELIVERY_STATUS_LABEL[item.status]}
            </Text>
          </View>
        </View>
        <Text style={styles.client} numberOfLines={2}>
          {item.sale?.clientName?.trim() || 'Client'}
          {isHomeDelivery(item) ? ' · À domicile' : ''}
        </Text>
        <Text style={styles.meta} numberOfLines={2}>
          {isHomeDelivery(item)
            ? [item.company?.name, item.department?.name ? `Livré depuis ${item.department.name}` : null]
                .filter(Boolean)
                .join(' · ') || '—'
            : [item.company?.name, item.department?.name].filter(Boolean).join(' · ') || '—'}
        </Text>
        <View style={styles.cardFoot}>
          <Text style={styles.meta}>{formatDateTime(item.sale?.createdAt ?? item.createdAt)}</Text>
          <MoneyText value={item.sale?.total} style={styles.total} />
        </View>
      </Pressable>
      {canPrint && onPrint ? (
        <Pressable
          style={[styles.cardPrintBtn, (printing || printBusy) && styles.disabled]}
          disabled={printing || printBusy}
          onPress={() => onPrint(item)}>
          {printing ? (
            <ActivityIndicator color={BrandColors.primary} />
          ) : (
            <Text style={styles.cardPrintText}>Imprimer</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
  disabled: { opacity: 0.55 },
});
