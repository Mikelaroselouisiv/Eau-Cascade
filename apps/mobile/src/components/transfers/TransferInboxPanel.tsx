import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { confirmInternalTransfer, rejectInternalTransfer } from '@/services/api';
import type { InternalTransferRow } from '@/types/api';
import { formatDateTime } from '@/utils/datetime';
import { formatQuantity } from '@/utils/quantity';

function whoLabel(u?: { fullName?: string | null; phone?: string | null } | null) {
  return u?.fullName?.trim() || u?.phone?.trim() || '';
}

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
      {inbox.map((t) => {
        const sentBy = whoLabel(t.createdBy);
        return (
          <View key={t.id} style={styles.row}>
            <Text style={styles.title}>
              {t.fromDepartment.name} → {t.toDepartment.name}
            </Text>
            <Text style={styles.meta} numberOfLines={2}>
              Envoyé {formatDateTime(t.createdAt)}
              {sentBy ? ` · ${sentBy}` : ''}
            </Text>
            {t.items.map((i) => (
              <Text key={i.id} style={styles.item}>
                {i.product.name} · {formatQuantity(i.quantity)}
              </Text>
            ))}
            <View style={styles.actions}>
              <Pressable style={styles.confirm} onPress={() => void confirm(t.id)}>
                <Text style={styles.confirmText}>Confirmer</Text>
              </Pressable>
              <Pressable style={styles.reject} onPress={() => void reject(t.id)}>
                <Text style={styles.rejectText}>Refuser</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  row: { gap: 6, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: BrandColors.border },
  title: { color: BrandColors.text, fontWeight: '800', fontSize: 14 },
  meta: { color: BrandColors.textMuted, fontSize: 12, fontWeight: '600' },
  item: { color: BrandColors.text, fontSize: 13, fontWeight: '600' },
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
