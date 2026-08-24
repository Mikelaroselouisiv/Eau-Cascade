import type { Product } from '@/types/api';

export function defaultSaleUnitForProduct(p: Product) {
  return p.saleUnits?.find((s) => s.isDefault) ?? p.saleUnits?.[0];
}

export function stockPackagingLabel(p: Product): string {
  const su = defaultSaleUnitForProduct(p);
  if (!su?.packagingUnit) return '—';
  const lo = su.labelOverride?.trim();
  const base = lo || su.packagingUnit.label;
  return `${base} (${su.packagingUnit.code})`;
}

export function defaultUnitPrice(p: Product): number | null {
  const u = defaultSaleUnitForProduct(p);
  return u ? Number(u.salePrice) : null;
}
