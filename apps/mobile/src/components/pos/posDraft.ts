import type { FulfillmentType } from '@/types/api';
import type { CartLine } from '@/utils/posCart';
import type { PosCollectMethod } from '@/utils/posCollect';

export type PaymentMethod = PosCollectMethod;

export type SaleDraft = {
  id: string;
  cart: CartLine[];
  paymentMethod: PaymentMethod;
  name: string;
  fulfillmentType: FulfillmentType;
  clientPhone: string;
  clientAddress: string;
  deliveryStops: { address: string; quantity: string }[];
  bankId: number | '';
  bankAccountId: number | '';
};

export function emptyDraft(id = `d${Date.now()}`): SaleDraft {
  return {
    id,
    cart: [],
    paymentMethod: 'CASH',
    name: 'Client',
    fulfillmentType: 'ON_SITE',
    clientPhone: '',
    clientAddress: '',
    deliveryStops: [{ address: '', quantity: '' }],
    bankId: '',
    bankAccountId: '',
  };
}
