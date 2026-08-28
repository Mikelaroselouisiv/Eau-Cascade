/** Administrateur global : pas de périmètre département. */
export function isAdminRole(role?: string | null): boolean {
  return role === 'ADMIN';
}

/** @deprecated Préférer les départements affectés (UserDepartment), pas le code MANAGER. */
export function isManagerRole(role?: string | null): boolean {
  return role === 'MANAGER';
}

export function canEditDeliveryExecutor(role?: string | null): boolean {
  return role === 'ADMIN' || role === 'MANAGER';
}

export function resolvedDepartmentIds(user: {
  role?: string | null;
  departmentId?: number | null;
  departmentIds?: number[] | null;
}): number[] {
  const fromList = (user.departmentIds ?? []).filter((id) => Number.isFinite(id) && id > 0);
  if (fromList.length) return Array.from(new Set(fromList));
  if (user.departmentId != null && user.departmentId > 0) return [user.departmentId];
  return [];
}

export function canAccessAssignedDepartment(
  user: {
    role?: string | null;
    departmentId?: number | null;
    departmentIds?: number[] | null;
  },
  departmentId: number | null | undefined,
): boolean {
  if (isAdminRole(user.role)) return true;
  if (departmentId == null) return true;
  const ids = resolvedDepartmentIds(user);
  if (!ids.length) return true;
  return ids.includes(departmentId);
}

/** Alias : le périmètre n’est plus réservé au code MANAGER. */
export const managerCanAccessDepartment = canAccessAssignedDepartment;
