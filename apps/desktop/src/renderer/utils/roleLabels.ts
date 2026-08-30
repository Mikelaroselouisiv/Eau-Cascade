/** Libellés français par défaut (secours si l’API n’a pas encore chargé le rôle). */
export const ROLE_LABELS_FALLBACK: Record<string, string> = {
  ADMIN: 'Administrateur',
  MANAGER: 'Gérant',
  CASHIER: 'Caissier',
  STOCK_MANAGER: 'Responsable stock',
  ACCOUNTANT: 'Comptable',
  LIVREUR: 'Livreur',
  CHEF_PRODUCTION: 'Chef de production',
};

export function formatRoleLabel(
  roleCode: string | null | undefined,
  roleLabel?: string | null,
): string {
  if (roleLabel?.trim()) return roleLabel.trim();
  if (!roleCode) return '—';
  return ROLE_LABELS_FALLBACK[roleCode] ?? roleCode;
}

/** Code technique : MAJUSCULES, `_`, sans accents. */
export function normalizeRoleCode(value: unknown): string {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^A-Z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}
