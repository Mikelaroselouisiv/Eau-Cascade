import { isAssignedToDepartment, isManagerRole, resolvedDepartmentIds } from './user-scope';

describe('user-scope assignment', () => {
  it('does not treat an empty assignment list as all departments', () => {
    expect(isAssignedToDepartment({ role: 'CASHIER', departmentIds: [] }, 3)).toBe(false);
    expect(isAssignedToDepartment({ role: 'CHEF_PRODUCTION' }, 3)).toBe(false);
    expect(isAssignedToDepartment({ role: 'CASHIER', departmentIds: [3] }, 3)).toBe(true);
    expect(isAssignedToDepartment({ role: 'CASHIER', departmentIds: [3] }, 9)).toBe(false);
    expect(isAssignedToDepartment({ role: 'ADMIN' }, 3)).toBe(true);
  });

  it('identifies managers without granting them cashier reception rights', () => {
    expect(isManagerRole('MANAGER')).toBe(true);
    expect(isManagerRole('CASHIER')).toBe(false);
    expect(resolvedDepartmentIds({ departmentIds: [1, 2, 2] })).toEqual([1, 2]);
  });
});
