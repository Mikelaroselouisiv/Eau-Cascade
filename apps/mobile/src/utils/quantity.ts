/** Affichage lisible des quantités stock (fr-FR). */
export function formatQuantity(value: number | string | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}
