/** Libellés français par défaut pour les codes rôle. */
export const ROLE_LABELS_FALLBACK: Record<string, string> = {
  ADMIN: 'Administrateur',
  MANAGER: 'Gérant',
  CASHIER: 'Caissier',
  STOCK_MANAGER: 'Responsable stock',
  ACCOUNTANT: 'Comptable',
  LIVREUR: 'Livreur',
};

export function formatRoleLabel(
  roleCode: string | null | undefined,
  roleLabel?: string | null,
): string {
  if (roleLabel?.trim()) return roleLabel.trim();
  if (!roleCode) return '—';
  return ROLE_LABELS_FALLBACK[roleCode] ?? roleCode;
}
