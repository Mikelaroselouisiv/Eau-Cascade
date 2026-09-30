/** Affichage ticket : txnNumber métier, fallback id technique (API = toujours `id`). */
export function saleDisplayRef(sale: {
  id: number;
  txnNumber?: number | null;
}): number {
  return sale.txnNumber ?? sale.id;
}

export function isSaleDeleted(sale: { deletedAt?: string | Date | null }): boolean {
  return sale.deletedAt != null && String(sale.deletedAt).length > 0;
}

/** Ligne encore visible mais hors CA : annulée, remboursée ou soft-delete (comme le journal PC). */
export function isSaleVoided(sale: {
  status?: string | null;
  deletedAt?: string | Date | null;
}): boolean {
  return isSaleDeleted(sale) || sale.status === 'CANCELLED' || sale.status === 'REFUNDED';
}
