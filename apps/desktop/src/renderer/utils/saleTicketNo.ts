/** Numéro de fiche affiché / imprimé — jamais l’id local (diverge au sync). */
export function saleTicketNo(sale: {
  ticketNo?: string | null;
  id?: number | null;
}): string {
  const t = sale.ticketNo?.trim();
  if (t) return t;
  if (sale.id != null) return String(sale.id);
  return '—';
}

export function saleTicketLabel(sale: {
  ticketNo?: string | null;
  id?: number | null;
}): string {
  return `#${saleTicketNo(sale)}`;
}
