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

export function parseIdList(raw?: string): number[] {
  if (!raw?.trim()) return [];
  return Array.from(
    new Set(
      raw
        .split(/[,\s]+/)
        .map((s) => Number.parseInt(s, 10))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  );
}

export type DepartmentScope =
  | { type: 'none' }
  | { type: 'empty' }
  | { type: 'ids'; ids: number[] };

/** Périmètre ventes / rapports : ADMIN sans filtre ; sinon départements affectés. */
export function departmentScopeForUser(
  user:
    | {
        role?: string | null;
        departmentId?: number | null;
        departmentIds?: number[] | null;
      }
    | undefined,
  requested?: { departmentId?: number; departmentIds?: number[] },
): DepartmentScope {
  const requestedIds = [
    ...(requested?.departmentId != null && requested.departmentId > 0
      ? [requested.departmentId]
      : []),
    ...(requested?.departmentIds ?? []).filter((id) => Number.isFinite(id) && id > 0),
  ];
  const uniqueRequested = Array.from(new Set(requestedIds));

  if (!user || isAdminRole(user.role)) {
    if (!uniqueRequested.length) return { type: 'none' };
    return { type: 'ids', ids: uniqueRequested };
  }

  const allowed = resolvedDepartmentIds(user);
  if (!allowed.length) {
    if (!uniqueRequested.length) return { type: 'none' };
    return { type: 'ids', ids: uniqueRequested };
  }

  const ids = uniqueRequested.length
    ? uniqueRequested.filter((id) => allowed.includes(id))
    : allowed;
  if (!ids.length) return { type: 'empty' };
  return { type: 'ids', ids };
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
