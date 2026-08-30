import type { Delivery, DeliveryStatus } from '@/types/api';
import { BrandColors } from '@/constants/brand';

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  PENDING: 'Non livré',
  PARTIAL: 'Partiel',
  DELIVERED: 'Livré',
};

export const DELIVERY_STATUS_COLOR: Record<DeliveryStatus, string> = {
  PENDING: BrandColors.primaryHover,
  PARTIAL: '#B45309',
  DELIVERED: BrandColors.ok,
};

export function isHomeDelivery(d: Delivery) {
  return d.fulfillmentType === 'HOME' || d.sale?.fulfillmentType === 'HOME';
}

export function deliverySaleRef(d: Delivery) {
  return d.saleRef ?? d.sale?.txnNumber ?? d.sale?.id ?? d.saleId;
}
