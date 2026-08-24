/** Affichage ticket : txnNumber métier, fallback id technique (API = toujours `id`). */
export function saleDisplayRef(sale: {
  id: number;
  txnNumber?: number | null;
}): number {
  return sale.txnNumber ?? sale.id;
}
