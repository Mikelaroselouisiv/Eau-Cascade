export function resolveVolumeUnitPrice(
  defaultUnitPrice: number,
  tiers: { minQuantity: number; unitPrice: number }[],
  quantity: number,
): number {
  const q = Number(quantity);
  if (!Number.isFinite(q) || q <= 0) return defaultUnitPrice;
  let chosen = defaultUnitPrice;
  let bestMin = -Infinity;
  for (const t of tiers) {
    const minQ = Number(t.minQuantity);
    const up = Number(t.unitPrice);
    if (!Number.isFinite(minQ) || !Number.isFinite(up)) continue;
    if (q >= minQ && minQ > bestMin) {
      bestMin = minQ;
      chosen = up;
    }
  }
  return chosen;
}

/** Prix famille si un palier matche ; sinon null (repli prix produit). */
export function resolveFamilyUnitPrice(
  tiers: { minQuantity: number; unitPrice: number }[],
  familyTotalQuantity: number,
): number | null {
  const q = Number(familyTotalQuantity);
  if (!Number.isFinite(q) || q <= 0 || !tiers?.length) return null;
  let chosen: number | null = null;
  let bestMin = -Infinity;
  for (const t of tiers) {
    const minQ = Number(t.minQuantity);
    const up = Number(t.unitPrice);
    if (!Number.isFinite(minQ) || !Number.isFinite(up)) continue;
    if (q >= minQ && minQ > bestMin) {
      bestMin = minQ;
      chosen = up;
    }
  }
  return chosen;
}
