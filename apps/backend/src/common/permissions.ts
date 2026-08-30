/** Catalogue des autorisations (modifiable par rôle dans l’admin, sans toucher au code). */
export const PERMISSIONS = [
  { code: '*', label: 'Accès complet (administrateur)' },
  { code: 'dashboard.view', label: 'Voir le tableau de bord (base)' },
  { code: 'dashboard.synthesis', label: 'Voir la synthèse globale (chiffres entreprise)' },
  { code: 'pos.use', label: 'Utiliser la caisse (POS)' },
  { code: 'stock.view', label: 'Consulter le stock et les mouvements' },
  { code: 'stock.manage', label: 'Gérer le stock (entrées, opérations)' },
  { code: 'stock.adjust', label: 'Ajuster / sortir du stock manuellement' },
  {
    code: 'stock.raw_in',
    label: 'Entrer des matières premières (usine) — caissier central / gérant',
  },
  { code: 'stock.global', label: 'Voir le stock vendu / inventaire global entreprise' },
  { code: 'products.view', label: 'Consulter le catalogue produits' },
  { code: 'products.manage', label: 'Créer / modifier / supprimer des produits' },
  { code: 'inventory.physical', label: 'Inventaire physique' },
  { code: 'purchasing.manage', label: 'Achats et réceptions' },
  { code: 'sales.create', label: 'Enregistrer des ventes' },
  { code: 'sales.view', label: 'Consulter les ventes' },
  {
    code: 'sales.recent_totals',
    label: 'Voir le total des ventes (2 derniers jours max)',
  },
  { code: 'sales.cancel', label: 'Annuler ou rembourser des ventes' },
  { code: 'sales.delete', label: 'Supprimer définitivement des ventes' },
  { code: 'sales.special_price', label: 'Vente spéciale / prix manuel' },
  { code: 'deliveries.view', label: 'Consulter les livraisons' },
  { code: 'deliveries.manage', label: 'Gérer toutes les livraisons (sur place et à domicile)' },
  { code: 'deliveries.manage_onsite', label: 'Gérer seulement les livraisons sur place' },
  { code: 'deliveries.manage_home', label: 'Gérer seulement les livraisons à domicile' },
  { code: 'deliveries.print', label: 'Imprimer les fiches depuis Livraisons' },
  { code: 'production.use', label: 'Ouvrir / fermer la production' },
  { code: 'transfers.manage', label: 'Créer des livraisons internes' },
  { code: 'transfers.confirm', label: 'Confirmer une livraison interne reçue' },
  { code: 'finance.view', label: 'Consulter la finance (journal, totaux)' },
  { code: 'finance.write', label: 'Saisir / modifier toute écriture financière' },
  { code: 'finance.expense', label: 'Enregistrer des dépenses uniquement (sans voir la finance)' },
  { code: 'accounting.view', label: 'Consulter la comptabilité' },
  { code: 'accounting.write', label: 'Saisir des écritures comptables' },
  { code: 'accounting.manage', label: 'Gérer exercices et plan comptable' },
  { code: 'reports.view', label: 'Rapports, exports et analyse des bénéfices' },
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

/** Groupes d’affichage pour l’éditeur de rôles (frontend). */
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
      'stock.raw_in',
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
    codes: [
      'deliveries.view',
      'deliveries.manage',
      'deliveries.manage_onsite',
      'deliveries.manage_home',
      'deliveries.print',
      'production.use',
      'transfers.manage',
      'transfers.confirm',
      'stores.manage',
    ],
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
  CHEF_PRODUCTION: 'Chef de production',
};

/**
 * Nombre de jours calendaires (fuseau Port-au-Prince) pour `sales.recent_totals`
 * : aujourd’hui + veille = 2 jours.
 */
export const SALES_RECENT_TOTALS_DAYS = 2;

/**
 * Valeurs initiales **uniquement** à la création d’un rôle système manquant.
 * Une fois la ligne `AppRole` existante, Config → Rôles (table) est la source de vérité.
 * Ne jamais réécrire / fusionner ces listes sur un rôle déjà enregistré.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  ADMIN: ['*'],
  /**
   * Bootstrap gérant (premier insert seulement).
   * Périmètre multi-départements = code de rôle MANAGER (UserDepartment), pas cette liste.
   */
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
    'production.use',
    'transfers.manage',
    'transfers.confirm',
  ],
  CASHIER: [
    'pos.use',
    'products.view',
    'sales.create',
    'sales.view',
    'transfers.confirm',
    'stock.raw_in',
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
    'transfers.confirm',
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
  CHEF_PRODUCTION: [
    'production.use',
    'transfers.manage',
    'transfers.confirm',
    'deliveries.view',
    'deliveries.manage',
    'deliveries.manage_onsite',
    'deliveries.manage_home',
    'products.view',
  ],
};

/** `deliveries.manage` couvre les deux modes ; `*` couvre tout. */
export function permissionGranted(userPerms: string[] | null | undefined, required: string): boolean {
  if (!userPerms?.length) return false;
  if (userPerms.includes('*')) return true;
  if (userPerms.includes(required)) return true;
  if (
    (required === 'deliveries.manage_onsite' || required === 'deliveries.manage_home') &&
    userPerms.includes('deliveries.manage')
  ) {
    return true;
  }
  return false;
}

export function canManageDeliveryFulfillment(
  userPerms: string[] | null | undefined,
  fulfillmentType: string | null | undefined,
): boolean {
  if (permissionGranted(userPerms, 'deliveries.manage')) return true;
  if (fulfillmentType === 'HOME') return permissionGranted(userPerms, 'deliveries.manage_home');
  return permissionGranted(userPerms, 'deliveries.manage_onsite');
}

export function permissionsSatisfy(userPerms: string[], requiredPerms: string[]): boolean {
  if (userPerms.includes('*')) return true;
  if (requiredPerms.includes('*')) {
    return userPerms.includes('*');
  }
  return requiredPerms.every((p) => permissionGranted(userPerms, p));
}
