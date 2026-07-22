import {
  nowBusinessYmd,
  ymdToBusinessDayEnd,
  ymdToBusinessDayStart,
  zonedLocalToUtc,
} from './business-timezone';

describe('business-timezone', () => {
  it('maps Haiti midnight to 04:00 UTC (UTC-4)', () => {
    const start = ymdToBusinessDayStart('2026-07-21');
    expect(start.toISOString()).toBe('2026-07-21T04:00:00.000Z');
  });

  it('maps Haiti end-of-day so 22:00 Haiti stays on the same calendar day', () => {
    const end = ymdToBusinessDayEnd('2026-07-21');
    expect(end.toISOString()).toBe('2026-07-22T03:59:59.999Z');

    // Sale at 22:00 Haiti on July 21 = 02:00 UTC July 22
    const saleAt22Haiti = zonedLocalToUtc(2026, 7, 21, 22, 0, 0, 0);
    expect(saleAt22Haiti.toISOString()).toBe('2026-07-22T02:00:00.000Z');
    expect(saleAt22Haiti.getTime()).toBeGreaterThanOrEqual(ymdToBusinessDayStart('2026-07-21').getTime());
    expect(saleAt22Haiti.getTime()).toBeLessThanOrEqual(end.getTime());
    expect(saleAt22Haiti.getTime()).toBeLessThan(ymdToBusinessDayStart('2026-07-22').getTime());
  });

  it('does not put evening Haiti sales into the next filter day', () => {
    const sale = zonedLocalToUtc(2026, 7, 21, 22, 30, 0, 0);
    const jul21 = {
      from: ymdToBusinessDayStart('2026-07-21').getTime(),
      to: ymdToBusinessDayEnd('2026-07-21').getTime(),
    };
    const jul22 = {
      from: ymdToBusinessDayStart('2026-07-22').getTime(),
      to: ymdToBusinessDayEnd('2026-07-22').getTime(),
    };
    expect(sale.getTime() >= jul21.from && sale.getTime() <= jul21.to).toBe(true);
    expect(sale.getTime() >= jul22.from && sale.getTime() <= jul22.to).toBe(false);
  });

  it('reports business YMD for late Haiti evening when process is UTC', () => {
    // 2026-07-22 02:00 UTC = 2026-07-21 22:00 Haiti
    const instant = new Date('2026-07-22T02:00:00.000Z');
    expect(nowBusinessYmd(instant)).toBe('2026-07-21');
  });
});
