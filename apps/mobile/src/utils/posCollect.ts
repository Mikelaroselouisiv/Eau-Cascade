import { isPlantCashier } from '@/utils/user-scope';

export type PosCollectMethod = 'CASH' | 'BANK';

/** Caissier de magasin (pas d’usine) : espèces seulement. */
export function cashierMustCollectCashOnly(user: {
  role?: string | null;
  productionDepartmentIds?: number[] | null;
} | null | undefined): boolean {
  return user?.role === 'CASHIER' && !isPlantCashier(user);
}

export function allowedPosPaymentMethods(user: {
  role?: string | null;
  productionDepartmentIds?: number[] | null;
} | null | undefined): PosCollectMethod[] {
  if (cashierMustCollectCashOnly(user)) return ['CASH'];
  return ['CASH', 'BANK'];
}

export const POS_PAYMENT_OPTION_META: {
  method: PosCollectMethod;
  label: string;
  icon: 'cash-outline' | 'business-outline';
}[] = [
  { method: 'CASH', label: 'Espèces', icon: 'cash-outline' },
  { method: 'BANK', label: 'Banque', icon: 'business-outline' },
];

export function posPaymentOptions(user: {
  role?: string | null;
  productionDepartmentIds?: number[] | null;
} | null | undefined) {
  const allowed = new Set(allowedPosPaymentMethods(user));
  return POS_PAYMENT_OPTION_META.filter((opt) => allowed.has(opt.method));
}
