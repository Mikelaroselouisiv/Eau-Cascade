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
