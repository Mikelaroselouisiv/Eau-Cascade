import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MoneyText } from '@/components/MoneyText';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import type { Sale } from '@/types/api';
import { formatDateTime } from '@/utils/datetime';
import { formatQuantity } from '@/utils/quantity';
import { isSaleDeleted, saleDisplayRef } from '@/utils/saleRef';

type Props = {
  sale: Sale;
  canCancel?: boolean;
  cancelBusy?: boolean;
  onPress: (sale: Sale) => void;
  onCancel?: (sale: Sale) => void;
};

function statusMeta(sale: Sale) {
  if (isSaleDeleted(sale)) {
    return { label: 'Supprimée', tone: styles.statusDeleted, deleted: true };
  }
  if (sale.status === 'COMPLETED') {
    return { label: 'Complétée', tone: styles.statusCompleted, deleted: false };
  }
  if (sale.status === 'REFUNDED') {
    return { label: 'Remboursée', tone: styles.statusRefunded, deleted: false };
  }
  return { label: 'Annulée', tone: styles.statusCancelled, deleted: false };
}

function itemName(item: NonNullable<Sale['items']>[number]) {
  return item.lineLabel?.trim() || item.product?.name?.trim() || 'Article';
}

export function SaleTransactionRow({ sale, canCancel = false, cancelBusy = false, onPress, onCancel }: Props) {
  const status = statusMeta(sale);
  const items = sale.items ?? [];
  const cashier = sale.user?.fullName?.trim() || sale.cashier || sale.user?.phone || '—';
  const showCancel =
    canCancel && sale.status === 'COMPLETED' && !status.deleted && onCancel != null;

  return (
    <View style={[styles.card, status.deleted && styles.cardDeleted]}>
      <Pressable
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
        onPress={() => onPress(sale)}>
        <View style={styles.top}>
          <Text style={[styles.ref, status.deleted && styles.deletedText]}>
            #{saleDisplayRef(sale)}
          </Text>
          <View style={[styles.statusBadge, status.tone]}>
            <Text style={[styles.statusText, status.deleted && styles.statusDeletedText]}>
              {status.label}
            </Text>
          </View>
        </View>

        {items.length === 0 ? (
          <Text style={[styles.emptyItems, status.deleted && styles.deletedText]}>Aucun article</Text>
        ) : (
          items.map((item, index) => (
            <View key={`${item.product?.id ?? 'line'}-${index}`} style={styles.itemRow}>
              <Text
                style={[styles.itemName, status.deleted && styles.deletedText]}
                numberOfLines={2}>
                {itemName(item)}
              </Text>
              <Text style={[styles.itemQty, status.deleted && styles.deletedText]}>
                × {formatQuantity(item.quantity)}
              </Text>
              <View style={styles.itemAmountWrap}>
                <MoneyText
                  value={item.subtotal}
                  style={[styles.itemAmount, status.deleted && styles.deletedText]}
                  numberOfLines={1}
                />
              </View>
            </View>
          ))
        )}

        {items.length > 1 ? (
          <View style={styles.ticketTotal}>
            <MoneyText
              value={sale.total}
              style={[styles.ticketTotalValue, status.deleted && styles.deletedText]}
            />
          </View>
        ) : null}

        <View style={styles.bottom}>
          <Text style={[styles.meta, status.deleted && styles.deletedText]} numberOfLines={1}>
            {cashier}
          </Text>
          <Text style={[styles.metaRight, status.deleted && styles.deletedText]}>
            {formatDateTime(sale.createdAt)}
          </Text>
        </View>
      </Pressable>

      {showCancel ? (
        <Pressable
          disabled={cancelBusy}
          style={[styles.cancelButton, cancelBusy && styles.cancelDisabled]}
          onPress={() => onCancel(sale)}>
          <Text style={styles.cancelText}>Annuler</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: BrandColors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BrandColors.border,
    overflow: 'hidden',
  },
  cardDeleted: {
    borderColor: BrandColors.danger,
    backgroundColor: '#FEF2F2',
  },
  body: { padding: Spacing.three, gap: 8 },
  pressed: { opacity: 0.72 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ref: { color: BrandColors.text, fontSize: 15, fontWeight: '900' },
  statusBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  statusCompleted: { backgroundColor: '#DCFCE7' },
  statusRefunded: { backgroundColor: '#FEF3C7' },
  statusCancelled: { backgroundColor: '#FEE2E2' },
  statusDeleted: { backgroundColor: '#FEE2E2' },
  statusText: { fontSize: 9, fontWeight: '800', color: BrandColors.text },
  statusDeletedText: { color: BrandColors.danger },
  deletedText: {
    color: BrandColors.danger,
    textDecorationLine: 'line-through',
  },
  emptyItems: { color: BrandColors.textMuted, fontSize: 12 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  itemName: { flex: 1, color: BrandColors.text, fontSize: 13, fontWeight: '600' },
  itemQty: {
    width: 58,
    color: BrandColors.textMuted,
    fontSize: 13,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  itemAmountWrap: { width: 118, alignItems: 'flex-end' },
  itemAmount: {
    color: BrandColors.text,
    fontSize: 13,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  ticketTotal: {
    borderTopWidth: 1,
    borderTopColor: BrandColors.border,
    paddingTop: 8,
    alignItems: 'flex-end',
  },
  ticketTotalValue: { color: BrandColors.text, fontSize: 15, fontWeight: '900' },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  meta: { flex: 1, color: BrandColors.textMuted, fontSize: 10 },
  metaRight: { color: BrandColors.textMuted, fontSize: 10, textAlign: 'right' },
  cancelButton: {
    borderTopWidth: 1,
    borderTopColor: BrandColors.border,
    paddingVertical: 11,
    alignItems: 'center',
    backgroundColor: BrandColors.surface,
  },
  cancelDisabled: { opacity: 0.55 },
  cancelText: { color: BrandColors.danger, fontWeight: '800', fontSize: 13 },
});
