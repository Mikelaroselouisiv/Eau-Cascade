/**
 * Catalogue / défauts alignés sur `apps/backend/src/common/permissions.ts`.
 * Utilisé en fallback si `user.permissions` n’est pas encore hydraté (cache offline).
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  ADMIN: ['*'],
  MANAGER: [
    'dashboard.view',
    'pos.use',
    'stock.view',
    'stock.manage',
    'products.view',
    'products.manage',
    'inventory.physical',
    'purchasing.manage',
    'sales.create',
    'sales.view',
    'sales.recent_totals',
    'sales.cancel',
    'sales.special_price',
    'deliveries.view',
    'deliveries.manage',
    'config.view',
    'config.manage',
    'departments.manage',
    'packaging.manage',
    'printer.manage',
    'recipes.manage',
    'users.view',
    'credit.view',
    'credit.manage',
  ],
  CASHIER: [
    'pos.use',
    'products.view',
    'sales.create',
    'sales.view',
    'deliveries.view',
    'deliveries.manage',
  ],
  STOCK_MANAGER: [
    'stock.view',
    'stock.manage',
    'products.view',
    'products.manage',
    'inventory.physical',
    'purchasing.manage',
    'recipes.manage',
    'packaging.manage',
    'config.view',
  ],
  ACCOUNTANT: [
    'dashboard.view',
    'dashboard.synthesis',
    'reports.view',
    'finance.view',
    'finance.write',
    'accounting.view',
    'accounting.write',
    'accounting.manage',
    'audit.view',
    'sales.view',
    'stock.view',
    'stock.global',
    'deliveries.view',
    'credit.view',
    'banks.view',
  ],
  LIVREUR: ['deliveries.view', 'deliveries.manage', 'products.view'],
};

export function resolveUserPermissions(user: {
  role: string;
  permissions?: string[] | null;
}): string[] {
  if (Array.isArray(user.permissions) && user.permissions.length > 0) {
    return user.permissions;
  }
  if (user.role === 'ADMIN') return ['*'];
  return DEFAULT_ROLE_PERMISSIONS[user.role] ?? [];
}

export function permissionsInclude(perms: string[], permission: string): boolean {
  return perms.includes('*') || perms.includes(permission);
}
