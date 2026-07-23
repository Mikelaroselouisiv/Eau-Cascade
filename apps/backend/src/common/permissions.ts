/** Catalogue des autorisations (modifiable par rôle dans l’admin, sans toucher au code). */
export const PERMISSIONS = [
  { code: '*', label: 'Accès complet (administrateur)' },
  { code: 'dashboard.view', label: 'Voir le tableau de bord' },
  { code: 'pos.use', label: 'Utiliser la caisse (POS)' },
  { code: 'stock.view', label: 'Consulter le stock et les mouvements' },
  { code: 'stock.manage', label: 'Gérer le stock (entrées, opérations)' },
  { code: 'stock.adjust', label: 'Ajuster / sortir du stock manuellement' },
  { code: 'products.view', label: 'Consulter le catalogue produits' },
  { code: 'products.manage', label: 'Créer / modifier / supprimer des produits' },
  { code: 'inventory.physical', label: 'Inventaire physique' },
  { code: 'purchasing.manage', label: 'Achats et réceptions' },
  { code: 'sales.create', label: 'Enregistrer des ventes' },
  { code: 'sales.view', label: 'Consulter les ventes' },
  { code: 'sales.cancel', label: 'Annuler ou rembourser des ventes' },
  { code: 'sales.delete', label: 'Supprimer définitivement des ventes' },
  { code: 'deliveries.view', label: 'Consulter les livraisons' },
  { code: 'deliveries.manage', label: 'Gérer les livraisons' },
  { code: 'finance.view', label: 'Consulter la finance' },
  { code: 'finance.write', label: 'Saisir des écritures financières' },
  { code: 'reports.view', label: 'Rapports et exports' },
  { code: 'config.view', label: 'Accéder à la configuration' },
  { code: 'config.manage', label: 'Modifier la configuration' },
  { code: 'company.manage', label: 'Gérer les entreprises' },
  { code: 'departments.manage', label: 'Gérer les départements' },
  { code: 'packaging.manage', label: 'Gérer les conditionnements' },
  { code: 'printer.manage', label: 'Configurer les imprimantes' },
  { code: 'recipes.manage', label: 'Gérer les recettes (composés)' },
  { code: 'users.view', label: 'Voir les utilisateurs' },
  { code: 'users.manage', label: 'Créer / modifier / supprimer des utilisateurs' },
  { code: 'roles.manage', label: 'Gérer les rôles et autorisations' },
  { code: 'audit.view', label: 'Journal d’audit' },
  { code: 'payments.manage', label: 'Gestion des paiements' },
  { code: 'credit.view', label: 'Consulter le crédit clients' },
  { code: 'credit.manage', label: 'Gérer le crédit clients (ventes & remboursements)' },
  { code: 'banks.view', label: 'Consulter les comptes bancaires' },
  { code: 'banks.manage', label: 'Gérer banques, comptes et transactions' },
  { code: 'stores.manage', label: 'Gérer magasins et caisses' },
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number]['code'];

export const ALL_PERMISSION_CODES = PERMISSIONS.map((p) => p.code).filter((c) => c !== '*');

/** Libellés français des rôles système (code technique inchangé en base). */
export const SYSTEM_ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrateur',
  MANAGER: 'Gérant',
  CASHIER: 'Caissier',
  STOCK_MANAGER: 'Responsable stock',
  ACCOUNTANT: 'Comptable',
  LIVREUR: 'Livreur',
};

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
    'sales.cancel',
    'deliveries.view',
    'deliveries.manage',
    'config.view',
    'config.manage',
    'company.manage',
    'departments.manage',
    'packaging.manage',
    'printer.manage',
    'recipes.manage',
    'users.view',
    'credit.view',
    'credit.manage',
    'banks.view',
    'banks.manage',
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
    'reports.view',
    'finance.view',
    'finance.write',
    'audit.view',
    'sales.view',
    'stock.view',
    'deliveries.view',
  ],
  LIVREUR: ['deliveries.view', 'deliveries.manage', 'products.view'],
};

export function permissionsSatisfy(userPerms: string[], requiredPerms: string[]): boolean {
  if (userPerms.includes('*')) return true;
  if (requiredPerms.includes('*')) {
    return userPerms.includes('*');
  }
  return requiredPerms.every((p) => userPerms.includes(p));
}
