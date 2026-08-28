export function isAdminRole(role?: string | null): boolean {
  return role === 'ADMIN';
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
