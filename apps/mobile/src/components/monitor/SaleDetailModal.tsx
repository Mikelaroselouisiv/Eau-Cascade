import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ModalShell } from '@/components/ModalShell';
import { MoneyText } from '@/components/MoneyText';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import type { Sale } from '@/types/api';
import { formatDateTime } from '@/utils/datetime';
import { paymentMethodLabel } from '@/utils/paymentLabels';
import { formatQuantity } from '@/utils/quantity';
import { saleDisplayRef } from '@/utils/saleRef';

type Props = {
  sale: Sale | null;
  busy?: boolean;
  canManage?: boolean;
  canDelete?: boolean;
  onCancel: (sale: Sale) => void;
  onRefund: (sale: Sale) => void;
  onDelete: (sale: Sale) => void;
  onClose: () => void;
};

const STATUS_LABEL: Record<Sale['status'], string> = {
  COMPLETED: 'Complétée',
  CANCELLED: 'Annulée',
  REFUNDED: 'Remboursée',
};

function paymentLabel(method: string) {
  return paymentMethodLabel(method);
}

export function SaleDetailModal({
  sale,
  busy = false,
  canManage = false,
  canDelete = false,
  onCancel,
  onRefund,
  onDelete,
  onClose,
}: Props) {
  const completed = sale?.status === 'COMPLETED';

  return (
    <ModalShell
      visible={sale != null}
      onRequestClose={onClose}
      body={
        sale ? (
          <ScrollView contentContainerStyle={styles.body}>
            <View style={styles.identityCard}>
              <InfoLine label="Client" value={sale.clientName?.trim() || 'Client inconnu'} />
              <InfoLine
                label="Caissier"
                value={sale.user?.fullName?.trim() || sale.cashier || sale.user?.phone || '—'}
              />
              <InfoLine label="Statut" value={STATUS_LABEL[sale.status]} />
            </View>

            <Text style={styles.sectionTitle}>Articles</Text>
            {(sale.items ?? []).map((item, index) => (
              <View key={`${item.product?.id ?? 'line'}-${index}`} style={styles.itemRow}>
                <View style={styles.itemInfo}>
                  <Text style={styles.itemName} numberOfLines={2}>
                    {item.lineLabel || item.product?.name || 'Article'}
                  </Text>
                  <Text style={styles.itemMeta}>
                    {formatQuantity(item.quantity)} ×{' '}
                    <MoneyText value={item.unitPrice} style={styles.inlineMoney} />
                  </Text>
                </View>
                <MoneyText value={item.subtotal} style={styles.itemTotal} />
              </View>
            ))}

            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>Total</Text>
              <MoneyText value={sale.total} style={styles.totalValue} currencyStyle={styles.totalCurrency} />
            </View>

            {sale.payments?.length ? (
              <>
                <Text style={styles.sectionTitle}>Paiements</Text>
                {sale.payments.map((payment, index) => (
                  <View key={payment.id ?? index} style={styles.paymentRow}>
                    <Text style={styles.paymentLabel}>{paymentLabel(payment.method)}</Text>
                    <MoneyText value={payment.amount} style={styles.paymentAmount} />
                  </View>
                ))}
              </>
            ) : null}
          </ScrollView>
        ) : null
      }
      footer={
        sale ? (
          <View style={styles.footer}>
            {canManage && completed ? (
              <View style={styles.actionRow}>
                <Pressable
                  disabled={busy}
                  style={[styles.secondaryButton, busy && styles.disabled]}
                  onPress={() => onCancel(sale)}>
                  <Text style={styles.secondaryText}>Annuler</Text>
                </Pressable>
                <Pressable
                  disabled={busy}
                  style={[styles.dangerOutlineButton, busy && styles.disabled]}
                  onPress={() => onRefund(sale)}>
                  <Text style={styles.dangerText}>Rembourser</Text>
                </Pressable>
              </View>
            ) : null}
            {canDelete ? (
              <Pressable
                disabled={busy}
                style={[styles.deleteButton, busy && styles.disabled]}
                onPress={() => onDelete(sale)}>
                <Ionicons name="trash-outline" size={17} color={BrandColors.danger} />
                <Text style={styles.dangerText}>Supprimer définitivement</Text>
              </Pressable>
            ) : null}
            <Pressable disabled={busy} style={styles.closeButton} onPress={onClose}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.closeText}>Fermer</Text>}
            </Pressable>
          </View>
        ) : null
      }>
      <View style={styles.header}>
        <View style={styles.headerInfo}>
          <Text style={styles.eyebrow}>TRANSACTION DE VENTE</Text>
          <Text style={styles.title}>
            Vente #{sale ? saleDisplayRef(sale) : ''}
          </Text>
          <Text style={styles.date}>{formatDateTime(sale?.createdAt)}</Text>
        </View>
        <Pressable onPress={onClose} disabled={busy} hitSlop={12}>
          <Ionicons name="close" size={26} color={BrandColors.text} />
        </Pressable>
      </View>
    </ModalShell>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoLine}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: 1,
    borderBottomColor: BrandColors.border,
  },
  headerInfo: { flex: 1 },
  eyebrow: { color: BrandColors.primary, fontSize: 10, fontWeight: '800', letterSpacing: 0.7 },
  title: { color: BrandColors.text, fontSize: 20, fontWeight: '800', marginTop: 2 },
  date: { color: BrandColors.textMuted, fontSize: 11, marginTop: 2 },
  body: { padding: Spacing.three, gap: Spacing.two },
  identityCard: {
    backgroundColor: BrandColors.surfaceSoft,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  infoLine: { flexDirection: 'row', gap: Spacing.three, justifyContent: 'space-between' },
  infoLabel: { color: BrandColors.textMuted, fontSize: 12 },
  infoValue: { flex: 1, color: BrandColors.text, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  sectionTitle: { color: BrandColors.text, fontSize: 15, fontWeight: '800', marginTop: Spacing.two },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderBottomWidth: 1,
    borderBottomColor: BrandColors.border,
    paddingVertical: 8,
  },
  itemInfo: { flex: 1, gap: 3 },
  itemName: { color: BrandColors.text, fontWeight: '700', fontSize: 13 },
  itemMeta: { color: BrandColors.textMuted, fontSize: 11 },
  inlineMoney: { color: BrandColors.textMuted, fontSize: 11 },
  itemTotal: { color: BrandColors.text, fontWeight: '800' },
  totalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: BrandColors.primarySoft,
    borderRadius: 13,
    padding: Spacing.three,
    marginTop: Spacing.two,
  },
  totalLabel: { color: BrandColors.text, fontSize: 15, fontWeight: '800' },
  totalValue: { color: BrandColors.text, fontSize: 22, fontWeight: '900' },
  totalCurrency: { fontSize: 11 },
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: BrandColors.border,
  },
  paymentLabel: { color: BrandColors.text, fontSize: 13, fontWeight: '600' },
  paymentAmount: { color: BrandColors.text, fontWeight: '800' },
  footer: { padding: Spacing.three, gap: Spacing.two, backgroundColor: BrandColors.bg },
  actionRow: { flexDirection: 'row', gap: Spacing.two },
  secondaryButton: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BrandColors.borderStrong,
    alignItems: 'center',
    paddingVertical: 12,
    backgroundColor: BrandColors.surface,
  },
  secondaryText: { color: BrandColors.text, fontWeight: '700' },
  dangerOutlineButton: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BrandColors.danger,
    alignItems: 'center',
    paddingVertical: 12,
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 12,
    paddingVertical: 11,
  },
  dangerText: { color: BrandColors.danger, fontWeight: '700' },
  closeButton: {
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: BrandColors.primary,
    paddingVertical: 13,
  },
  closeText: { color: '#fff', fontWeight: '800' },
  disabled: { opacity: 0.55 },
});
