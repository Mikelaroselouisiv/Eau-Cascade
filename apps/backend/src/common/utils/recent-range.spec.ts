import { clampToRecentTotalsRange, mustClampRecentExpenses, mustClampRecentTotals } from './recent-range';

describe('recent-range', () => {
  it('does not clamp roles with reports.view or *', () => {
    expect(mustClampRecentTotals(['reports.view'])).toBe(false);
    expect(mustClampRecentTotals(['*'])).toBe(false);
  });

  it('clamps manager-style permissions', () => {
    expect(mustClampRecentTotals(['dashboard.view', 'sales.recent_totals'])).toBe(true);
  });

  it('does not clamp expense journal for finance.view, finance.write or *', () => {
    expect(mustClampRecentExpenses(['finance.view'])).toBe(false);
    expect(mustClampRecentExpenses(['finance.write'])).toBe(false);
    expect(mustClampRecentExpenses(['*'])).toBe(false);
  });

  it('clamps expense journal without finance.view', () => {
    expect(mustClampRecentExpenses(['dashboard.view', 'finance.recent_expenses'])).toBe(true);
  });

  it('clamps an old range to today + yesterday (Port-au-Prince)', () => {
    const now = new Date('2026-09-05T16:00:00.000Z');
    expect(clampToRecentTotalsRange('2026-08-01', '2026-09-05', now)).toEqual({
      dateFrom: '2026-09-04',
      dateTo: '2026-09-05',
    });
  });
});
