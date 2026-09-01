import { DepartmentKind, ProductNature } from '@prisma/client';
import {
  holdsFinishedGoodsStock,
  isProductionDepartment,
  shouldEnforceFinishedGoodsAvailability,
  shouldEnforceOnHandStock,
} from './department-kind';

describe('department-kind stock rules', () => {
  it('treats PRODUCTION_DISTRIBUTION as a plant without finished-goods warehouse', () => {
    expect(isProductionDepartment(DepartmentKind.PRODUCTION_DISTRIBUTION)).toBe(true);
    expect(holdsFinishedGoodsStock(DepartmentKind.PRODUCTION_DISTRIBUTION)).toBe(false);
    expect(holdsFinishedGoodsStock(DepartmentKind.DISTRIBUTION)).toBe(true);
  });

  it('does not block plant finished-goods sales even if trackStock is still true', () => {
    expect(
      shouldEnforceFinishedGoodsAvailability({
        departmentKind: DepartmentKind.PRODUCTION_DISTRIBUTION,
        nature: ProductNature.FINISHED_GOOD,
        trackStock: true,
      }),
    ).toBe(false);
  });

  it('enforces on-hand stock for shop finished goods and plant raw materials', () => {
    expect(
      shouldEnforceOnHandStock({
        departmentKind: DepartmentKind.DISTRIBUTION,
        nature: ProductNature.FINISHED_GOOD,
        trackStock: true,
      }),
    ).toBe(true);
    expect(
      shouldEnforceOnHandStock({
        departmentKind: DepartmentKind.PRODUCTION_DISTRIBUTION,
        nature: ProductNature.RAW_MATERIAL,
        trackStock: true,
      }),
    ).toBe(true);
    expect(
      shouldEnforceOnHandStock({
        departmentKind: DepartmentKind.PRODUCTION_DISTRIBUTION,
        nature: ProductNature.FINISHED_GOOD,
        trackStock: true,
      }),
    ).toBe(false);
  });
});
