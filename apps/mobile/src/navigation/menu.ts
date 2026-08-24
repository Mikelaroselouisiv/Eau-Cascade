import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

import type { UserRole } from '@/types/api';

export type IoniconName = ComponentProps<typeof Ionicons>['name'];

export type MenuItem = {
  key: string;
  label: string;
  href: string;
  icon: IoniconName;
  /** Fallback rôles si pas de permission / Accueil. */
  roles: UserRole[];
  /** Permission fine (parité sidebar desktop). */
  permission?: string;
};

export type SectionTab = {
  name: string;
  title: string;
  icon: IoniconName;
  roles?: UserRole[];
  permission?: string;
};

/** Options du menu (= sidebar desktop remote) + Accueil mobile. */
export const MENU_ITEMS: MenuItem[] = [
  {
    key: 'home',
    label: 'Accueil',
    href: '/(app)/home',
    icon: 'home-outline',
    roles: ['ADMIN', 'MANAGER', 'CASHIER', 'STOCK_MANAGER', 'ACCOUNTANT', 'LIVREUR'],
  },
  {
    key: 'pos',
    label: 'Caisse',
    href: '/(app)/pos',
    icon: 'cart-outline',
    roles: ['ADMIN', 'MANAGER', 'CASHIER'],
    permission: 'pos.use',
  },
  {
    key: 'deliveries',
    label: 'Livraisons',
    href: '/(app)/deliveries',
    icon: 'bicycle-outline',
    roles: ['ADMIN', 'MANAGER', 'CASHIER', 'LIVREUR', 'ACCOUNTANT'],
    permission: 'deliveries.view',
  },
  {
    key: 'dashboard',
    label: 'Tableau de bord',
    href: '/(app)/dashboard',
    icon: 'stats-chart-outline',
    roles: ['ADMIN', 'MANAGER', 'ACCOUNTANT'],
    permission: 'dashboard.view',
  },
  {
    key: 'credit',
    label: 'Crédit',
    href: '/(app)/credit',
    icon: 'wallet-outline',
    roles: ['ADMIN', 'MANAGER'],
    permission: 'credit.view',
  },
  {
    key: 'stock',
    label: 'Stocks',
    href: '/(app)/stock',
    icon: 'cube-outline',
    roles: ['ADMIN', 'MANAGER', 'STOCK_MANAGER'],
    permission: 'stock.view',
  },
  {
    key: 'accounting',
    label: 'Comptabilité',
    href: '/(app)/accounting',
    icon: 'book-outline',
    roles: ['ADMIN', 'ACCOUNTANT'],
    permission: 'accounting.view',
  },
  {
    key: 'config',
    label: 'Configuration',
    href: '/(app)/config',
    icon: 'settings-outline',
    roles: ['ADMIN', 'MANAGER'],
    permission: 'config.view',
  },
];

export const SECTION_TABS: Record<string, SectionTab[]> = {
  pos: [
    { name: 'classic', title: 'Classique', icon: 'grid-outline', permission: 'pos.use' },
    {
      name: 'special',
      title: 'Spéciale',
      icon: 'sparkles-outline',
      permission: 'sales.special_price',
      roles: ['ADMIN', 'MANAGER'],
    },
  ],
  deliveries: [
    { name: 'all', title: 'Tous', icon: 'list-outline', permission: 'deliveries.view' },
    { name: 'undelivered', title: 'Non livré', icon: 'time-outline', permission: 'deliveries.view' },
    { name: 'partial', title: 'Partiel', icon: 'git-commit-outline', permission: 'deliveries.view' },
    {
      name: 'delivered',
      title: 'Livré',
      icon: 'checkmark-done-outline',
      permission: 'deliveries.view',
    },
  ],
  dashboard: [
    {
      name: 'synthese',
      title: 'Synthèse',
      icon: 'pie-chart-outline',
      permission: 'dashboard.synthesis',
      roles: ['ADMIN'],
    },
    { name: 'ventes', title: 'Ventes', icon: 'receipt-outline', permission: 'sales.view' },
    {
      name: 'stock',
      title: 'Stock',
      icon: 'cube-outline',
      permission: 'stock.global',
      roles: ['ADMIN'],
    },
    {
      name: 'depenses',
      title: 'Dépenses',
      icon: 'cash-outline',
      permission: 'finance.view',
      roles: ['ADMIN'],
    },
    {
      name: 'banque',
      title: 'Banque',
      icon: 'business-outline',
      permission: 'banks.view',
      roles: ['ADMIN', 'MANAGER'],
    },
    {
      name: 'benefices',
      title: 'Bénéfices',
      icon: 'trending-up-outline',
      permission: 'reports.view',
      roles: ['ADMIN', 'MANAGER'],
    },
  ],
  credit: [
    {
      name: 'overview',
      title: 'Vue d’ensemble',
      icon: 'people-outline',
      permission: 'credit.view',
      roles: ['ADMIN', 'MANAGER'],
    },
    {
      name: 'dettes',
      title: 'En dette',
      icon: 'alert-circle-outline',
      permission: 'credit.view',
      roles: ['ADMIN', 'MANAGER'],
    },
    {
      name: 'retard',
      title: 'Retard',
      icon: 'warning-outline',
      permission: 'credit.view',
      roles: ['ADMIN', 'MANAGER'],
    },
  ],
  stock: [
    {
      name: 'achats',
      title: 'Achats',
      icon: 'cart-outline',
      permission: 'purchasing.manage',
      roles: ['ADMIN', 'MANAGER', 'STOCK_MANAGER'],
    },
    {
      name: 'produits',
      title: 'Produits',
      icon: 'pricetags-outline',
      permission: 'products.view',
      roles: ['ADMIN', 'MANAGER', 'STOCK_MANAGER'],
    },
    {
      name: 'familles',
      title: 'Familles',
      icon: 'layers-outline',
      permission: 'products.view',
      roles: ['ADMIN', 'MANAGER', 'STOCK_MANAGER'],
    },
    {
      name: 'harmonisation',
      title: 'Harmonisation',
      icon: 'swap-vertical-outline',
      permission: 'stock.adjust',
      roles: ['ADMIN'],
    },
  ],
  config: [
    {
      name: 'entreprise',
      title: 'Entreprise',
      icon: 'business-outline',
      permission: 'config.view',
      roles: ['ADMIN', 'MANAGER'],
    },
    {
      name: 'imprimante',
      title: 'Imprimante',
      icon: 'print-outline',
      permission: 'printer.manage',
      roles: ['ADMIN', 'MANAGER'],
    },
    {
      name: 'conditionnement',
      title: 'Conditionnement',
      icon: 'layers-outline',
      permission: 'packaging.manage',
      roles: ['ADMIN', 'MANAGER', 'STOCK_MANAGER'],
    },
    {
      name: 'banques',
      title: 'Banques',
      icon: 'card-outline',
      permission: 'banks.manage',
      roles: ['ADMIN', 'MANAGER'],
    },
    {
      name: 'utilisateurs',
      title: 'Utilisateurs',
      icon: 'people-outline',
      permission: 'users.manage',
      roles: ['ADMIN'],
    },
    {
      name: 'roles',
      title: 'Rôles',
      icon: 'key-outline',
      permission: 'roles.manage',
      roles: ['ADMIN'],
    },
  ],
  accounting: [
    {
      name: 'consulter',
      title: 'Consulter',
      icon: 'book-outline',
      permission: 'accounting.view',
      roles: ['ADMIN', 'ACCOUNTANT'],
    },
    {
      name: 'saisie',
      title: 'Saisie OD',
      icon: 'create-outline',
      permission: 'accounting.write',
      roles: ['ADMIN', 'ACCOUNTANT'],
    },
    {
      name: 'plus',
      title: 'Plus',
      icon: 'ellipsis-horizontal-outline',
      permission: 'accounting.view',
      roles: ['ADMIN', 'ACCOUNTANT'],
    },
  ],
};

export const SECTION_TITLES: Record<string, string> = {
  home: 'Accueil',
  pos: 'Caisse',
  deliveries: 'Livraisons',
  dashboard: 'Tableau de bord',
  credit: 'Crédit',
  stock: 'Stocks',
  accounting: 'Comptabilité',
  config: 'Configuration',
};

export function defaultAppHref(role: UserRole | undefined): string {
  switch (role) {
    case 'CASHIER':
      return '/(app)/pos';
    case 'LIVREUR':
      return '/(app)/deliveries';
    case 'STOCK_MANAGER':
      return '/(app)/stock';
    case 'ACCOUNTANT':
      return '/(app)/accounting';
    case 'ADMIN':
    case 'MANAGER':
    default:
      return '/(app)/home';
  }
}

type AccessFns = {
  can: (roles: UserRole[]) => boolean;
  canPerm: (permission: string) => boolean;
};

export function canAccessMenuItem(item: MenuItem, access: AccessFns): boolean {
  if (item.key === 'home') return true;
  if (item.permission) {
    if (item.permission === 'credit.view') {
      return access.can(['ADMIN', 'MANAGER']) || access.canPerm('credit.view');
    }
    return access.canPerm(item.permission);
  }
  return access.can(item.roles);
}

export function filterMenuItems(items: MenuItem[], access: AccessFns): MenuItem[] {
  return items.filter((item) => canAccessMenuItem(item, access));
}

export function canAccessTab(tab: SectionTab, access: AccessFns): boolean {
  const byPerm = tab.permission ? access.canPerm(tab.permission) : false;
  const byRole = tab.roles ? access.can(tab.roles) : false;
  if (tab.name === 'synthese') {
    return byRole || access.canPerm('dashboard.synthesis') || access.canPerm('reports.view');
  }
  if (tab.name === 'stock' && tab.title === 'Stock') {
    return byRole || access.canPerm('stock.global') || access.canPerm('reports.view');
  }
  if (tab.name === 'depenses') {
    return (
      byRole ||
      access.canPerm('finance.view') ||
      access.canPerm('finance.write') ||
      access.canPerm('finance.expense')
    );
  }
  if (tab.permission && tab.roles) return byPerm || byRole;
  if (tab.permission) return byPerm;
  if (tab.roles) return byRole;
  return true;
}

export function filterTabsForAccess(tabs: SectionTab[], access: AccessFns): SectionTab[] {
  return tabs.filter((tab) => canAccessTab(tab, access));
}

/** @deprecated Prefer filterTabsForAccess with can/canPerm. */
export function filterTabsForRole(tabs: SectionTab[], role: UserRole | undefined): SectionTab[] {
  return tabs.filter((tab) => !tab.roles || (role != null && tab.roles.includes(role)));
}
