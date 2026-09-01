import { DepartmentKind, ProductNature } from '@prisma/client';

export function isProductionDepartment(
  kind?: DepartmentKind | string | null,
): boolean {
  return kind === DepartmentKind.PRODUCTION_DISTRIBUTION;
}

/** Livraison à domicile = usine uniquement (pas un magasin DISTRIBUTION). */
export function departmentAllowsHomeDelivery(
  kind?: DepartmentKind | string | null,
): boolean {
  return isProductionDepartment(kind);
}

/**
 * Magasin DISTRIBUTION : stock PF entreposé (à connaître pour renflouer).
 * Usine PRODUCTION_DISTRIBUTION : pas de stock PF — écoulement via la session de production.
 */
export function holdsFinishedGoodsStock(
  kind?: DepartmentKind | string | null,
): boolean {
  return !isProductionDepartment(kind);
}

export function isRawMaterial(nature?: ProductNature | string | null): boolean {
  return nature === ProductNature.RAW_MATERIAL;
}

export function isFinishedGood(nature?: ProductNature | string | null): boolean {
  return nature !== ProductNature.RAW_MATERIAL;
}

/** MP usine, ou PF magasin — jamais le PF d’une usine. */
export function shouldEnforceOnHandStock(opts: {
  departmentKind?: DepartmentKind | string | null;
  nature?: ProductNature | string | null;
  trackStock?: boolean | null;
  isService?: boolean | null;
}): boolean {
  if (opts.isService) return false;
  if (opts.trackStock === false) return false;
  if (isRawMaterial(opts.nature)) return true;
  return holdsFinishedGoodsStock(opts.departmentKind);
}

/** Caisse / vente : limiter la quantité seulement pour le PF d’un magasin. */
export function shouldEnforceFinishedGoodsAvailability(opts: {
  departmentKind?: DepartmentKind | string | null;
  nature?: ProductNature | string | null;
  trackStock?: boolean | null;
  isService?: boolean | null;
}): boolean {
  if (opts.isService) return false;
  if (isRawMaterial(opts.nature)) return false;
  if (opts.trackStock === false) return false;
  return holdsFinishedGoodsStock(opts.departmentKind);
}
