import { DepartmentKind, ProductNature } from '@prisma/client';

export function isProductionDepartment(
  kind?: DepartmentKind | string | null,
): boolean {
  return kind === DepartmentKind.PRODUCTION_DISTRIBUTION;
}

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
