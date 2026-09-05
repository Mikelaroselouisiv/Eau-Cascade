import { FulfillmentType } from '@prisma/client';
import {
  cashierCanAccessDelivery,
  cashierListWhere,
  cashierSeesHomePool,
  chefCanAccessDelivery,
  departmentListClause,
  resolveDeliveryScope,
  seesHomeDeliveryPool,
} from './deliveries-scope';

describe('deliveries-scope', () => {
  const shopCashier = { id: 11, role: 'CASHIER' as const, departmentIds: [2], productionDepartmentIds: [] };
  const plantCashier = {
    id: 12,
    role: 'CASHIER' as const,
    departmentIds: [4, 2],
    productionDepartmentIds: [4],
  };
  const chef = { id: 20, role: 'CHEF_PRODUCTION' as const, companyId: 1, departmentIds: [4] };
  const chefNoDept = { id: 21, role: 'CHEF_PRODUCTION' as const, companyId: 1, departmentIds: [] };

  it('shop cashiers do not see the HOME pool', () => {
    expect(seesHomeDeliveryPool(shopCashier)).toBe(false);
    expect(cashierSeesHomePool(shopCashier)).toBe(false);
    expect(cashierListWhere(shopCashier)).toEqual({ sale: { userId: 11 } });
  });

  it('denies cashiers without a user id instead of opening the company pool', () => {
    expect(cashierListWhere({ role: 'CASHIER' })).toBe('deny');
  });

  it('plant cashiers see their own sales plus HOME for their plant and the unassigned queue', () => {
    expect(cashierSeesHomePool(plantCashier)).toBe(true);
    expect(cashierListWhere(plantCashier)).toEqual({
      OR: [
        { sale: { userId: 12 } },
        {
          fulfillmentType: FulfillmentType.HOME,
          OR: [{ departmentId: null }, { departmentId: { in: [4] } }],
        },
      ],
    });
    expect(
      cashierCanAccessDelivery(plantCashier, {
        fulfillmentType: 'HOME',
        departmentId: null,
        saleUserId: 99,
      }),
    ).toBe(true);
    expect(
      cashierCanAccessDelivery(shopCashier, {
        fulfillmentType: 'HOME',
        departmentId: null,
        saleUserId: 99,
      }),
    ).toBe(false);
  });

  it('chef scope stays on assigned departments even when the list is empty', () => {
    expect(resolveDeliveryScope(chef, {})).toEqual({ companyId: 1, departmentIds: [4] });
    expect(resolveDeliveryScope(chefNoDept, {})).toEqual({ companyId: 1, departmentIds: [] });
    expect(departmentListClause({ departmentIds: [4] }, true)).toEqual({
      OR: [
        { departmentId: { in: [4] } },
        { fulfillmentType: FulfillmentType.HOME, departmentId: null },
      ],
    });
    expect(departmentListClause({ departmentIds: [] }, true)).toEqual({
      fulfillmentType: FulfillmentType.HOME,
      departmentId: null,
    });
  });

  it('chef can open HOME queue and own-department cards, not other plants ON_SITE', () => {
    expect(chefCanAccessDelivery(chef, { fulfillmentType: 'HOME', departmentId: null })).toBe(true);
    expect(chefCanAccessDelivery(chef, { fulfillmentType: 'HOME', departmentId: 4 })).toBe(true);
    expect(chefCanAccessDelivery(chef, { fulfillmentType: 'ON_SITE', departmentId: 4 })).toBe(true);
    expect(chefCanAccessDelivery(chef, { fulfillmentType: 'ON_SITE', departmentId: 9 })).toBe(false);
    expect(chefCanAccessDelivery(chefNoDept, { fulfillmentType: 'ON_SITE', departmentId: 4 })).toBe(
      false,
    );
  });
});
