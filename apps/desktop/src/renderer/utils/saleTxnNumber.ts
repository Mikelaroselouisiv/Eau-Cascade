/** Numéro métier affiché / imprimé (stable après sync). */
export function saleTxnNumber(sale: {
  id: number;
  txnNumber?: number | null;
}): number {
  return sale.txnNumber ?? sale.id;
}
