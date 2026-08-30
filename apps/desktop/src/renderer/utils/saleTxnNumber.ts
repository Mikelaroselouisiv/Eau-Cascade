/** Numéro métier affiché / imprimé (stable après sync). */
export function saleTxnNumber(sale: {
  id: number;
  txnNumber?: number | null;
}): number {
  return sale.txnNumber ?? sale.id;
}

export function isSaleDeleted(sale: { deletedAt?: string | Date | null }): boolean {
  return sale.deletedAt != null && String(sale.deletedAt).length > 0;
}
