import type { Delivery, DeliveryDrop, DeliveryStatus } from '@/types/api';
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

function userShortName(u?: { fullName?: string | null; phone?: string | null } | null) {
  return u?.fullName?.trim() || u?.phone?.trim() || '';
}

/** Livreur saisi, sinon l’utilisateur qui a enregistré le passage. */
export function deliveryDropWho(drop: DeliveryDrop) {
  const named = drop.executorName?.trim() || '';
  const recorded = userShortName(drop.deliveredBy) || userShortName(drop.createdBy);
  if (named && recorded && named.toLowerCase() !== recorded.toLowerCase()) {
    return `${named} · ${recorded}`;
  }
  return named || recorded;
}
