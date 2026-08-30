import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { confirmInternalTransfer, rejectInternalTransfer } from '@/services/api';
import type { InternalTransferRow } from '@/types/api';
import { formatQuantity } from '@/utils/quantity';

export function TransferInboxPanel({
  inbox,
  onChange,
}: {
  inbox: InternalTransferRow[];
  onChange: (rows: InternalTransferRow[]) => void;
}) {
  async function confirm(id: number) {
    await confirmInternalTransfer(id);
    onChange(inbox.filter((x) => x.id !== id));
  }

  async function reject(id: number) {
    await rejectInternalTransfer(id);
    onChange(inbox.filter((x) => x.id !== id));
  }

  if (inbox.length === 0) {
    return <Text style={styles.meta}>Aucune réception en attente.</Text>;
  }

  return (
    <>
      {inbox.map((t) => (
        <View key={t.id} style={styles.row}>
          <Text style={styles.title}>
            {t.fromDepartment.name} → {t.toDepartment.name}
          </Text>
          <Text style={styles.meta}>
            {t.items.map((i) => `${i.product.name} ${formatQuantity(i.quantity)}`).join(', ')}
          </Text>
          <View style={styles.actions}>
            <Pressable style={styles.confirm} onPress={() => void confirm(t.id)}>
              <Text style={styles.confirmText}>Confirmer</Text>
            </Pressable>
            <Pressable style={styles.reject} onPress={() => void reject(t.id)}>
              <Text style={styles.rejectText}>Refuser</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  row: { gap: 6, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: BrandColors.border },
  title: { color: BrandColors.text, fontWeight: '800', fontSize: 14 },
  meta: { color: BrandColors.textMuted, fontSize: 12 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  confirm: {
    backgroundColor: BrandColors.primary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  confirmText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  reject: {
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  rejectText: { color: BrandColors.text, fontWeight: '700', fontSize: 12 },
});
