export function isAdminRole(role?: string | null): boolean {
  return role === 'ADMIN';
}

export function canEditDeliveryExecutor(role?: string | null): boolean {
  return role === 'ADMIN' || role === 'MANAGER';
}

export function resolvedDepartmentIds(user: {
  departmentId?: number | null;
  departmentIds?: number[] | null;
} | null | undefined): number[] {
  const fromList = (user?.departmentIds ?? []).filter((id) => Number.isFinite(id) && id > 0);
  if (fromList.length) return Array.from(new Set(fromList));
  if (user?.departmentId != null && user.departmentId > 0) return [user.departmentId];
  return [];
}

export function departmentsForUser<T extends { id: number }>(
  depts: T[],
  user: {
    role?: string | null;
    departmentId?: number | null;
    departmentIds?: number[] | null;
  } | null,
): T[] {
  if (!user || isAdminRole(user.role)) return depts;
  const ids = resolvedDepartmentIds(user);
  if (!ids.length) return depts;
  const allowed = new Set(ids);
  return depts.filter((d) => allowed.has(d.id));
}

export function salesQueryDepartmentParams(user: {
  role?: string | null;
  departmentId?: number | null;
  departmentIds?: number[] | null;
} | null): { departmentId?: number; departmentIds?: number[] } {
  if (!user || isAdminRole(user.role)) return {};
  const ids = resolvedDepartmentIds(user);
  if (!ids.length) return {};
  if (ids.length === 1) return { departmentId: ids[0] };
  return { departmentIds: ids };
}

export function isProductionKind(kind?: string | null): boolean {
  return kind === 'PRODUCTION_DISTRIBUTION';
}

/** Caissier (ou autre) affecté uniquement à des magasins DISTRIBUTION — pas d’usine. */
export function isDistributionOnlyUser(user: {
  departmentId?: number | null;
  departmentIds?: number[] | null;
  productionDepartmentIds?: number[] | null;
} | null | undefined): boolean {
  const assigned = resolvedDepartmentIds(user);
  if (!assigned.length) return false;
  const plants = new Set((user?.productionDepartmentIds ?? []).filter((id) => id > 0));
  if (!plants.size) return true;
  return !assigned.some((id) => plants.has(id));
}

export function assignedProductionDepartmentIds<
  T extends { id: number; kind?: string | null },
>(
  depts: T[],
  user: {
    role?: string | null;
    departmentId?: number | null;
    departmentIds?: number[] | null;
  } | null,
): number[] {
  const plants = depts.filter((d) => isProductionKind(d.kind));
  if (!user || isAdminRole(user.role)) return plants.map((d) => d.id);
  const ids = new Set(resolvedDepartmentIds(user));
  if (!ids.size) return plants.map((d) => d.id);
  return plants.filter((d) => ids.has(d.id)).map((d) => d.id);
}

type ScopeUser = {
  role?: string | null;
  departmentId?: number | null;
  departmentIds?: number[] | null;
} | null;

/** Harmonisation : usines seulement (entrée MP caissier) ou tout le périmètre (ajustements). */
export function harmonisationDepartments<T extends { id: number; kind?: string | null }>(
  depts: T[],
  user: ScopeUser,
  plantsOnly: boolean,
): T[] {
  if (plantsOnly) {
    const plantIds = new Set(assignedProductionDepartmentIds(depts, user));
    return depts.filter((d) => plantIds.has(d.id));
  }
  return departmentsForUser(depts, user);
}
