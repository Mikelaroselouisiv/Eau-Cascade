/**
 * Groupes d’affichage pour l’éditeur de rôles.
 * Aligné sur `PERMISSION_GROUPS` dans apps/backend/src/common/permissions.ts.
 */
export const PERMISSION_GROUPS: ReadonlyArray<{ id: string; label: string; codes: string[] }> = [
  { id: 'access', label: 'Accès général', codes: ['*', 'dashboard.view', 'dashboard.synthesis', 'pos.use'] },
  {
    id: 'sales',
    label: 'Ventes & caisse',
    codes: [
      'sales.create',
      'sales.view',
      'sales.recent_totals',
      'sales.cancel',
      'sales.delete',
      'sales.special_price',
      'payments.manage',
    ],
  },
  {
    id: 'stock',
    label: 'Stock & produits',
    codes: [
      'stock.view',
      'stock.manage',
      'stock.adjust',
      'stock.global',
      'products.view',
      'products.manage',
      'inventory.physical',
      'purchasing.manage',
      'recipes.manage',
      'packaging.manage',
    ],
  },
  {
    id: 'money',
    label: 'Argent, banque & comptabilité',
    codes: [
      'banks.view',
      'banks.manage',
      'finance.view',
      'finance.write',
      'finance.expense',
      'accounting.view',
      'accounting.write',
      'accounting.manage',
      'reports.view',
      'credit.view',
      'credit.manage',
    ],
  },
  {
    id: 'ops',
    label: 'Livraisons & exploitation',
    codes: ['deliveries.view', 'deliveries.manage', 'stores.manage'],
  },
  {
    id: 'admin',
    label: 'Configuration & administration',
    codes: [
      'config.view',
      'config.manage',
      'company.manage',
      'departments.manage',
      'printer.manage',
      'users.view',
      'users.manage',
      'roles.manage',
      'audit.view',
    ],
  },
];
