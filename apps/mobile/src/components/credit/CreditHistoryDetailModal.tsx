import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ModalShell } from '@/components/ModalShell';
import { MoneyText } from '@/components/MoneyText';
import { BrandColors } from '@/constants/brand';
import { Spacing } from '@/constants/theme';
import type {
  CreditCustomerDetail,
  CreditRepaymentRow,
  CreditSaleRow,
  CreditTimelineEvent,
  Sale,
} from '@/types/api';
import { formatDateTime } from '@/utils/datetime';
import { paymentMethodLabel } from '@/utils/paymentLabels';
import { formatQuantity } from '@/utils/quantity';
import { saleDisplayRef } from '@/utils/saleRef';

type SaleLike = Sale | CreditSaleRow;

type Props = {
  visible: boolean;
  customer: CreditCustomerDetail | null;
  event: CreditTimelineEvent | null;
  sale: SaleLike | null;
  payment: CreditRepaymentRow | null;
  registerLabel?: string | null;
  busy?: boolean;
  onClose: () => void;
};

function personLabel(
  user?: { fullName?: string | null; phone?: string | null } | null,
  fallback?: string | null,
) {
  return user?.fullName?.trim() || user?.phone?.trim() || fallback?.trim() || '—';
}

function fulfillmentLabel(value?: string | null) {
  if (value === 'HOME') return 'Domicile';
  if (value === 'ON_SITE') return 'Sur place';
  return value?.trim() || '—';
}

function departmentLabel(sale: SaleLike | null, customer: CreditCustomerDetail | null) {
  const fromItems = new Set<string>();
  for (const item of sale?.items ?? []) {
    const name = item.product?.department?.name?.trim();
    if (name) fromItems.add(name);
  }
  if (fromItems.size > 0) return [...fromItems].join(', ');
  return customer?.department?.name?.trim() || '—';
}

function saleBalance(sale: SaleLike | null, event: CreditTimelineEvent | null) {
  if (sale && 'balanceDue' in sale && sale.balanceDue != null) return Number(sale.balanceDue);
  if (event?.meta?.balanceDue != null) return Number(event.meta.balanceDue);
  return null;
}

function salePaid(sale: SaleLike | null, event: CreditTimelineEvent | null) {
  if (sale?.amountPaid != null) return Number(sale.amountPaid);
  if (event?.meta?.paid != null) return Number(event.meta.paid);
  return null;
}

export function CreditHistoryDetailModal({
  visible,
  customer,
  event,
  sale,
  payment,
  registerLabel,
  busy = false,
  onClose,
}: Props) {
  const isPayment = event?.kind === 'PAYMENT';
  const linkedSale = sale;
  const salePayments = linkedSale && 'payments' in linkedSale ? linkedSale.payments : undefined;
  const balanceDue = saleBalance(linkedSale, event);
  const amountPaid = salePaid(linkedSale, event);
  const saleTotal = linkedSale ? Number(linkedSale.total) : event?.amount ?? 0;
  const settled = balanceDue != null && balanceDue <= 0.009;

  return (
    <ModalShell
      visible={visible}
      onRequestClose={onClose}
      body={
        event ? (
          <ScrollView contentContainerStyle={styles.body}>
            {busy ? (
              <View style={styles.loading}>
                <ActivityIndicator color={BrandColors.accent} />
              </View>
            ) : null}

            <View style={styles.identityCard}>
              <InfoLine label="Client" value={customer?.name?.trim() || '—'} />
              <InfoLine label="Téléphone" value={customer?.phone?.trim() || '—'} />
              {customer?.address?.trim() ? (
                <InfoLine label="Adresse" value={customer.address.trim()} />
              ) : null}
              <InfoLine
                label="Caissier"
                value={
                  isPayment
                    ? personLabel(payment?.user)
                    : personLabel(linkedSale?.user, linkedSale?.cashier)
                }
              />
              <InfoLine label="Caisse" value={registerLabel?.trim() || '—'} />
              <InfoLine label="Département" value={departmentLabel(linkedSale, customer)} />
              {linkedSale ? (
                <InfoLine label="Type" value={fulfillmentLabel(linkedSale.fulfillmentType)} />
              ) : null}
              {isPayment ? (
                <>
                  <InfoLine label="Mode" value={paymentMethodLabel(payment?.method ?? '')} />
                  {payment?.reference?.trim() ? (
                    <InfoLine label="Référence" value={payment.reference.trim()} />
                  ) : null}
                  {payment?.note?.trim() ? <InfoLine label="Note" value={payment.note.trim()} /> : null}
                  <InfoLine
                    label="Fiche"
                    value={
                      payment?.saleId != null || linkedSale
                        ? `#${saleDisplayRef(linkedSale ?? { id: payment?.saleId ?? 0 })}`
                        : '—'
                    }
                  />
                </>
              ) : (
                <InfoLine label="Fiche" value={settled ? 'Soldée' : 'Ouverte'} />
              )}
            </View>

            {isPayment ? (
              <View style={styles.totalCard}>
                <Text style={styles.totalLabel}>Encaissé</Text>
                <MoneyText
                  value={payment?.amount ?? event.amount}
                  style={styles.totalValue}
                  currencyStyle={styles.totalCurrency}
                />
              </View>
            ) : null}

            {linkedSale?.items?.length ? (
              <>
                <Text style={styles.sectionTitle}>Articles</Text>
                {linkedSale.items.map((item, index) => (
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
              </>
            ) : null}

            {linkedSale ? (
              <View style={styles.totalsBlock}>
                <View style={styles.totalLine}>
                  <Text style={styles.metaLabel}>Total</Text>
                  <MoneyText value={saleTotal} style={styles.totalLineValue} />
                </View>
                {amountPaid != null ? (
                  <View style={styles.totalLine}>
                    <Text style={styles.metaLabel}>Payé</Text>
                    <MoneyText value={amountPaid} style={styles.totalLineValue} />
                  </View>
                ) : null}
                {balanceDue != null ? (
                  <View style={styles.totalLine}>
                    <Text style={styles.metaLabel}>Reste</Text>
                    <MoneyText
                      value={balanceDue}
                      style={[styles.totalLineValue, !settled && styles.dueValue]}
                    />
                  </View>
                ) : null}
              </View>
            ) : null}

            {salePayments?.length ? (
              <>
                <Text style={styles.sectionTitle}>Paiements</Text>
                {salePayments.map((row, index) => (
                  <View key={row.id ?? index} style={styles.paymentRow}>
                    <Text style={styles.paymentLabel}>{paymentMethodLabel(row.method)}</Text>
                    <MoneyText value={row.amount} style={styles.paymentAmount} />
                  </View>
                ))}
              </>
            ) : null}
          </ScrollView>
        ) : null
      }
      footer={
        <View style={styles.footer}>
          <Pressable style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeText}>Fermer</Text>
          </Pressable>
        </View>
      }>
      <View style={styles.header}>
        <View style={styles.headerInfo}>
          <Text style={styles.eyebrow}>{isPayment ? 'ENCAISSEMENT CRÉDIT' : 'VENTE À CRÉDIT'}</Text>
          <Text style={styles.title} numberOfLines={2}>
            {isPayment
              ? 'Paiement'
              : `Vente #${linkedSale ? saleDisplayRef(linkedSale) : ''}`}
          </Text>
          <Text style={styles.date}>{formatDateTime(event?.at ?? linkedSale?.createdAt)}</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={12}>
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
      <Text style={styles.infoValue} numberOfLines={3}>
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
  loading: { paddingVertical: Spacing.two, alignItems: 'center' },
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
  totalsBlock: {
    backgroundColor: BrandColors.surfaceSoft,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: BrandColors.border,
    padding: Spacing.three,
    gap: 8,
    marginTop: Spacing.two,
  },
  totalLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metaLabel: { color: BrandColors.textMuted, fontSize: 13, fontWeight: '600' },
  totalLineValue: { color: BrandColors.text, fontWeight: '800' },
  dueValue: { color: BrandColors.primaryHover },
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: BrandColors.border,
  },
  paymentLabel: { color: BrandColors.text, fontSize: 13, fontWeight: '600' },
  paymentAmount: { color: BrandColors.text, fontWeight: '800' },
  footer: { padding: Spacing.three, backgroundColor: BrandColors.bg },
  closeButton: {
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: BrandColors.primary,
    paddingVertical: 13,
  },
  closeText: { color: '#fff', fontWeight: '800' },
});
