/**
 * Résolution des droits à partir de la session (table AppRole).
 * Pas de matrice gérant/caissier en dur : Config → Rôles est la source de vérité.
 */
export function resolveUserPermissions(user: {
  role: string;
  permissions?: string[] | null;
}): string[] {
  if (Array.isArray(user.permissions)) {
    return user.permissions;
  }
  // Filet ADMIN uniquement si l’ancien cache n’a pas encore hydraté les droits.
  if (user.role === 'ADMIN') return ['*'];
  return [];
}

export function permissionsInclude(perms: string[], permission: string): boolean {
  if (perms.includes('*')) return true;
  if (perms.includes(permission)) return true;
  if (
    (permission === 'deliveries.manage_onsite' || permission === 'deliveries.manage_home') &&
    perms.includes('deliveries.manage')
  ) {
    return true;
  }
  return false;
}
