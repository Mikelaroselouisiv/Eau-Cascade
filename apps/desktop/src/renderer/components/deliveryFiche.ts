import type { Delivery } from '../types/api';
import { saleTxnNumber } from '../utils/saleTxnNumber';

export const DELIVERY_STATUS_LABEL: Record<Delivery['status'], string> = {
  PENDING: 'Non livré',
  PARTIAL: 'Partiel',
  DELIVERED: 'Livré',
};

export function deliveryStatusClass(status: Delivery['status']) {
  if (status === 'DELIVERED') return 'delivery-card--done';
  if (status === 'PARTIAL') return 'delivery-card--partial';
  return 'delivery-card--pending';
}

export function isHomeDelivery(d: Delivery) {
  return d.fulfillmentType === 'HOME' || d.sale?.fulfillmentType === 'HOME';
}

export function deliverySaleRef(d: Delivery) {
  return d.saleRef ?? (d.sale ? saleTxnNumber(d.sale) : d.saleId);
}
