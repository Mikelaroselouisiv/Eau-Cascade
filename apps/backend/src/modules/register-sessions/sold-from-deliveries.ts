/** Agrégation « articles écoulés » d’une session caisse à partir des livraisons. */

export type SessionSoldWindow = {
  id: number;
  departmentId: number;
  openedAt: Date;
  closedAt: Date | null;
};

export type SoldProductRow = {
  productId: number;
  name: string;
  deliveredQty: number;
};

export function saleQtyToBase(
  saleQty: number,
  line: { quantity: number; baseQuantity: number },
): number {
  const q = Number(line.quantity);
  if (!Number.isFinite(saleQty) || Math.abs(saleQty) < 1e-12 || !(q > 0)) return 0;
  return (saleQty / q) * Number(line.baseQuantity);
}

export function eventBelongsToSession(
  eventAt: Date,
  departmentId: number,
  session: SessionSoldWindow,
): boolean {
  if (departmentId !== session.departmentId) return false;
  if (eventAt.getTime() < session.openedAt.getTime()) return false;
  if (session.closedAt && eventAt.getTime() > session.closedAt.getTime()) return false;
  return true;
}

export function addSoldQty(
  map: Map<number, SoldProductRow>,
  productId: number,
  name: string,
  qty: number,
) {
  if (!Number.isFinite(qty) || Math.abs(qty) < 1e-9) return;
  const cur = map.get(productId) ?? { productId, name, deliveredQty: 0 };
  cur.deliveredQty += qty;
  map.set(productId, cur);
}

export function emptySoldMaps(sessions: SessionSoldWindow[]): Map<number, Map<number, SoldProductRow>> {
  const maps = new Map<number, Map<number, SoldProductRow>>();
  for (const session of sessions) maps.set(session.id, new Map());
  return maps;
}

export function finalizeSoldMaps(
  maps: Map<number, Map<number, SoldProductRow>>,
): Map<number, SoldProductRow[]> {
  const out = new Map<number, SoldProductRow[]>();
  for (const [sessionId, byProduct] of maps) {
    out.set(
      sessionId,
      [...byProduct.values()]
        .filter((row) => Math.abs(row.deliveredQty) > 1e-9)
        .sort((a, b) => Math.abs(b.deliveredQty) - Math.abs(a.deliveredQty)),
    );
  }
  return out;
}
