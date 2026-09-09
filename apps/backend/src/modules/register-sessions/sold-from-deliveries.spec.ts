import {
  addSoldQty,
  eventBelongsToSession,
  finalizeSoldMaps,
  saleQtyToBase,
  type SessionSoldWindow,
} from './sold-from-deliveries';

describe('sold-from-deliveries', () => {
  const session: SessionSoldWindow = {
    id: 1,
    departmentId: 10,
    openedAt: new Date('2026-09-08T12:00:00.000Z'),
    closedAt: new Date('2026-09-08T20:00:00.000Z'),
  };

  it('converts sale units to base quantity', () => {
    expect(saleQtyToBase(2, { quantity: 4, baseQuantity: 20 })).toBe(10);
  });

  it('keeps delivery events inside the session window and department', () => {
    expect(eventBelongsToSession(new Date('2026-09-08T15:00:00.000Z'), 10, session)).toBe(true);
    expect(eventBelongsToSession(new Date('2026-09-08T15:00:00.000Z'), 11, session)).toBe(false);
    expect(eventBelongsToSession(new Date('2026-09-08T11:00:00.000Z'), 10, session)).toBe(false);
    expect(eventBelongsToSession(new Date('2026-09-08T21:00:00.000Z'), 10, session)).toBe(false);
  });

  it('sums delivered qty per product independently of opening/closing stock', () => {
    const map = new Map();
    addSoldQty(map, 3, 'Bonbonne', 10);
    addSoldQty(map, 3, 'Bonbonne', 15);
    addSoldQty(map, 8, 'Sachet', 4);
    const rows = finalizeSoldMaps(new Map([[1, map]])).get(1) ?? [];
    expect(rows).toEqual([
      { productId: 3, name: 'Bonbonne', deliveredQty: 25 },
      { productId: 8, name: 'Sachet', deliveredQty: 4 },
    ]);
  });
});
