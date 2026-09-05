import { FulfillmentType, Prisma } from '@prisma/client';
import { isPlantCashier } from '../../common/plant-cashier';
import { isAssignedToDepartment, resolvedDepartmentIds } from '../../common/user-scope';

export type DeliveryScopeUser = {
  id?: number;
  role?: string;
  companyId?: number | null;
  departmentId?: number | null;
  departmentIds?: number[] | null;
  productionDepartmentIds?: number[] | null;
};

const NO_MATCH: Prisma.DeliveryWhereInput = { id: -1 };

export function isCashierRole(user: DeliveryScopeUser): boolean {
  return user.role === 'CASHIER';
}

export function isChefProductionRole(user: DeliveryScopeUser): boolean {
  return user.role === 'CHEF_PRODUCTION';
}

/** Caissier d’usine (dépt Production et distribution) : file HOME en plus de ses ventes. */
export function cashierSeesHomePool(user: DeliveryScopeUser): boolean {
  return isCashierRole(user) && isPlantCashier(user);
}

export function seesHomeDeliveryPool(user: DeliveryScopeUser): boolean {
  if (isCashierRole(user)) return cashierSeesHomePool(user);
  return true;
}

export function plantIdsOf(user: DeliveryScopeUser): number[] {
  return (user.productionDepartmentIds ?? []).filter((id) => Number.isFinite(id) && id > 0);
}

/** Caissier sans id JWT : aucune fiche (évite d’ouvrir tout le pool). */
export function cashierHasIdentity(user: DeliveryScopeUser): boolean {
  return isCashierRole(user) && user.id != null;
}

export function homePoolClause(): Prisma.DeliveryWhereInput {
  return { fulfillmentType: FulfillmentType.HOME, departmentId: null };
}

export function cashierListWhere(user: DeliveryScopeUser): Prisma.DeliveryWhereInput | 'deny' {
  if (!isCashierRole(user)) return {};
  if (user.id == null) return 'deny';
  const ownSales: Prisma.DeliveryWhereInput = { sale: { userId: user.id } };
  if (!cashierSeesHomePool(user)) return ownSales;
  const plants = plantIdsOf(user);
  const home: Prisma.DeliveryWhereInput = plants.length
    ? {
        fulfillmentType: FulfillmentType.HOME,
        OR: [{ departmentId: null }, { departmentId: { in: plants } }],
      }
    : homePoolClause();
  return { OR: [ownSales, home] };
}

export function departmentListClause(
  scope: {
    departmentId?: number;
    departmentIds?: number[];
  },
  includeHomePool: boolean,
): Prisma.DeliveryWhereInput {
  const homePending: Prisma.DeliveryWhereInput | null = includeHomePool ? homePoolClause() : null;
  if (scope.departmentId != null) {
    return homePending
      ? { OR: [{ departmentId: scope.departmentId }, homePending] }
      : { departmentId: scope.departmentId };
  }
  if (scope.departmentIds && scope.departmentIds.length) {
    return homePending
      ? { OR: [{ departmentId: { in: scope.departmentIds } }, homePending] }
      : { departmentId: { in: scope.departmentIds } };
  }
  if (Array.isArray(scope.departmentIds)) {
    return homePending ?? NO_MATCH;
  }
  return {};
}

export function resolveDeliveryScope(
  user: DeliveryScopeUser,
  filters: { companyId?: number; departmentId?: number },
): { companyId?: number; departmentId?: number; departmentIds?: number[] } {
  const role = user.role ?? '';
  if (role === 'ADMIN') {
    return {
      companyId: filters.companyId,
      departmentId: filters.departmentId,
    };
  }

  const allowed = resolvedDepartmentIds(user);
  const companyId = filters.companyId ?? user.companyId ?? undefined;
  if (filters.departmentId != null) {
    return { companyId, departmentId: filters.departmentId };
  }
  if (isChefProductionRole(user)) {
    return { companyId, departmentIds: allowed };
  }
  return {
    companyId,
    departmentIds: allowed.length ? allowed : undefined,
  };
}

export function cashierCanAccessDelivery(
  user: DeliveryScopeUser,
  opts: {
    fulfillmentType?: FulfillmentType | string | null;
    departmentId?: number | null;
    saleUserId?: number | null;
  },
): boolean {
  if (!isCashierRole(user)) return false;
  if (user.id != null && opts.saleUserId === user.id) return true;
  const isHome = opts.fulfillmentType === FulfillmentType.HOME || opts.fulfillmentType === 'HOME';
  if (!isHome || !cashierSeesHomePool(user)) return false;
  if (opts.departmentId == null) return true;
  return plantIdsOf(user).includes(opts.departmentId);
}

export function chefCanAccessDelivery(
  user: DeliveryScopeUser,
  opts: {
    fulfillmentType?: FulfillmentType | string | null;
    departmentId?: number | null;
  },
): boolean {
  if (!isChefProductionRole(user)) return false;
  const isHome = opts.fulfillmentType === FulfillmentType.HOME || opts.fulfillmentType === 'HOME';
  if (isHome && opts.departmentId == null) return true;
  return isAssignedToDepartment(user, opts.departmentId);
}
