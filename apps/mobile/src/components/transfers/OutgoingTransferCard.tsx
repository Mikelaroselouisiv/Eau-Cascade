import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import { updateInternalTransfer } from '@/services/api';
import { formatApiError } from '@/services/api-errors';
import type { InternalTransferRow, SessionUser } from '@/types/api';
import { formatDateTime } from '@/utils/datetime';
import { formatQuantity } from '@/utils/quantity';

const STATUS_LABEL: Record<InternalTransferRow['status'], string> = {
  PENDING: 'En attente',
  CONFIRMED: 'Confirmé',
  REJECTED: 'Refusé',
};

const STATUS_COLOR: Record<InternalTransferRow['status'], string> = {
  PENDING: '#B45309',
  CONFIRMED: BrandColors.ok,
  REJECTED: BrandColors.danger,
};

function whoLabel(u?: { fullName?: string | null; phone?: string | null } | null) {
  return u?.fullName?.trim() || u?.phone?.trim() || '';
}

function parseQty(raw: string): number | null {
  const trimmed = raw.trim().replace(/\s/g, '').replace(',', '.');
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0.0001) return null;
  return n;
}

export function canEditOutgoingTransfer(transfer: InternalTransferRow, user: SessionUser | null) {
  if (!user || transfer.status !== 'PENDING') return false;
  if (user.role === 'ADMIN' || user.role === 'MANAGER') return true;
  if (transfer.createdBy?.id != null) return transfer.createdBy.id === user.id;
  return true;
}

type Props = {
  transfer: InternalTransferRow;
  showFrom?: boolean;
  canEdit?: boolean;
  onUpdated: (row: InternalTransferRow) => void;
};

export function OutgoingTransferCard({ transfer, showFrom, canEdit, onUpdated }: Props) {
  const [qtyDraft, setQtyDraft] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const next: Record<number, string> = {};
    for (const item of transfer.items) next[item.id] = String(item.quantity);
    setQtyDraft(next);
    setError('');
  }, [transfer.id, transfer.items]);

  const dirty = useMemo(() => {
    return transfer.items.some((item) => {
      const parsed = parseQty(qtyDraft[item.id] ?? '');
      return parsed != null && parsed !== Number(item.quantity);
    });
  }, [qtyDraft, transfer.items]);

  async function save() {
    const items: Array<{ id: number; quantity: number }> = [];
    for (const item of transfer.items) {
      const parsed = parseQty(qtyDraft[item.id] ?? '');
      if (parsed == null) {
        setError('Quantité invalide');
        return;
      }
      items.push({ id: item.id, quantity: parsed });
    }
    setSaving(true);
    setError('');
    try {
      const updated = await updateInternalTransfer(transfer.id, { items });
      onUpdated(updated);
    } catch (e) {
      setError(formatApiError(e, 'Enregistrement impossible'));
    } finally {
      setSaving(false);
    }
  }

  const statusColor = STATUS_COLOR[transfer.status];
  const sentBy = whoLabel(transfer.createdBy);
  const receivedBy = whoLabel(transfer.confirmedBy);
  const receivedAt =
    transfer.status === 'REJECTED' ? transfer.rejectedAt : transfer.confirmedAt;
  const receivedVerb = transfer.status === 'REJECTED' ? 'Refusé' : 'Reçu';

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <Text style={styles.title} numberOfLines={2}>
          {showFrom ? `${transfer.fromDepartment.name} → ` : ''}
          {transfer.toDepartment.name}
        </Text>
        <View style={[styles.badge, { backgroundColor: `${statusColor}22` }]}>
          <Text style={[styles.badgeText, { color: statusColor }]}>
            {STATUS_LABEL[transfer.status]}
          </Text>
        </View>
      </View>

      <Text style={styles.meta} numberOfLines={2}>
        Envoyé {formatDateTime(transfer.createdAt)}
        {sentBy ? ` · ${sentBy}` : ''}
      </Text>
      {transfer.carrier?.name?.trim() ? (
        <Text style={styles.meta} numberOfLines={1}>
          {transfer.carrier.name.trim()}
        </Text>
      ) : null}
      {transfer.status !== 'PENDING' && receivedAt ? (
        <Text style={styles.meta} numberOfLines={2}>
          {receivedVerb} {formatDateTime(receivedAt)}
          {receivedBy ? ` · ${receivedBy}` : ''}
        </Text>
      ) : null}

      {transfer.items.map((item) => (
        <View key={item.id} style={styles.itemRow}>
          <Text style={styles.itemName} numberOfLines={2}>
            {item.product.name}
          </Text>
          {canEdit ? (
            <TextInput
              style={styles.qtyInput}
              keyboardType="decimal-pad"
              editable={!saving}
              value={qtyDraft[item.id] ?? ''}
              onChangeText={(v) => setQtyDraft((prev) => ({ ...prev, [item.id]: v }))}
            />
          ) : (
            <Text style={styles.qtyRead}>{formatQuantity(item.quantity)}</Text>
          )}
        </View>
      ))}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {canEdit ? (
        <Pressable
          style={[styles.saveBtn, (!dirty || saving) && styles.saveDisabled]}
          disabled={!dirty || saving}
          onPress={() => void save()}>
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveText}>Enregistrer</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: BrandColors.border,
    borderRadius: 12,
    backgroundColor: BrandColors.bg,
    padding: Spacing.three,
    gap: 6,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  title: { flex: 1, fontWeight: '800', fontSize: 14, color: BrandColors.text },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontWeight: '800', fontSize: 11 },
  meta: { color: BrandColors.textMuted, fontSize: 12, fontWeight: '600' },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  itemName: { flex: 1, color: BrandColors.text, fontWeight: '600' },
  qtyRead: { fontWeight: '800', color: BrandColors.text, minWidth: 48, textAlign: 'right' },
  qtyInput: {
    width: 88,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
    color: BrandColors.text,
    backgroundColor: BrandColors.surface,
    textAlign: 'right',
    fontWeight: '700',
  },
  saveBtn: {
    marginTop: 4,
    backgroundColor: BrandColors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  saveDisabled: { opacity: 0.5 },
  saveText: { color: '#fff', fontWeight: '800' },
  error: { color: BrandColors.danger, fontWeight: '600', fontSize: 12 },
});
