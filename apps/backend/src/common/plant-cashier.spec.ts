import {
  isPlantCashier,
  mergePlantCashierPermissions,
  PLANT_CASHIER_PERMISSIONS,
} from './plant-cashier';

describe('plant-cashier', () => {
  it('identifies cashiers assigned to a production/distribution plant', () => {
    expect(isPlantCashier({ role: 'CASHIER', productionDepartmentIds: [4] })).toBe(true);
    expect(isPlantCashier({ role: 'CASHIER', productionDepartmentIds: [] })).toBe(false);
    expect(isPlantCashier({ role: 'MANAGER', productionDepartmentIds: [4] })).toBe(false);
  });

  it('grants credit + expense permissions only to plant cashiers', () => {
    const base = ['pos.use', 'products.view'];
    expect(mergePlantCashierPermissions('CASHIER', base, [])).toEqual(base);
    expect(mergePlantCashierPermissions('MANAGER', base, [4])).toEqual(base);
    expect(mergePlantCashierPermissions('CASHIER', base, [4])).toEqual(
      expect.arrayContaining([...base, ...PLANT_CASHIER_PERMISSIONS]),
    );
  });
});
