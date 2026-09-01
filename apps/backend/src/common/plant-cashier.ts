/** Permissions extra pour un caissier affecté à au moins une usine (PRODUCTION_DISTRIBUTION). */
export const PLANT_CASHIER_PERMISSIONS = [
  'credit.view',
  'credit.manage',
  'donation.view',
  'donation.manage',
  'finance.expense',
] as const;

export function isPlantCashier(user: {
  role?: string | null;
  productionDepartmentIds?: number[] | null;
} | null | undefined): boolean {
  return (
    user?.role === 'CASHIER' &&
    (user.productionDepartmentIds ?? []).some((id) => Number.isFinite(id) && id > 0)
  );
}

export function mergePlantCashierPermissions(
  role: string | null | undefined,
  permissions: string[],
  productionDepartmentIds?: number[] | null,
): string[] {
  if (!isPlantCashier({ role, productionDepartmentIds })) return permissions;
  if (permissions.includes('*')) return permissions;
  return Array.from(new Set([...permissions, ...PLANT_CASHIER_PERMISSIONS]));
}
