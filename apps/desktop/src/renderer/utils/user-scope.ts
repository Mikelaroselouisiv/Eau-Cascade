/** Gérant : peut contrôler plusieurs départements. */
export function isManagerRole(role?: string | null): boolean {
  return role === 'MANAGER';
}

export function isAdminRole(role?: string | null): boolean {
  return role === 'ADMIN';
}

export function canEditDeliveryExecutor(role?: string | null): boolean {
  return role === 'ADMIN' || role === 'MANAGER';
}

export function departmentsForUser<T extends { id: number }>(
  depts: T[],
  user: {
    role?: string | null;
    departmentId?: number | null;
    departmentIds?: number[] | null;
  } | null,
): T[] {
  if (!user || !isManagerRole(user.role)) return depts;
  const ids = (user.departmentIds?.length
    ? user.departmentIds
    : user.departmentId != null
      ? [user.departmentId]
      : []
  ).filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) return depts;
  const allowed = new Set(ids);
  return depts.filter((d) => allowed.has(d.id));
}
