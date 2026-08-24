import { AccountNature } from '@prisma/client';

/**
 * Plan comptable commerce — logique PCG France / Plan Comptable National haïtien.
 * Classes 1–5 = bilan ; 6 = charges ; 7 = produits.
 *
 * Source de vérité en production : ce fichier (édition UI désactivée).
 * Pour ajouter un compte → modifier ici, déployer, puis « Synchroniser » dans l’app.
 */
export type ChartAccountDef = {
  code: string;
  name: string;
  classNumber: number;
  nature: AccountNature;
  isDebitNormal: boolean;
  systemKey?: string;
};

export const SYSTEM_KEYS = {
  CAPITAL: 'CAPITAL',
  NET_RESULT: 'NET_RESULT',
  RETAINED: 'RETAINED',
  FIXED_ASSETS: 'FIXED_ASSETS',
  ACCUM_DEPR: 'ACCUM_DEPR',
  INVENTORY: 'INVENTORY',
  SUPPLIERS: 'SUPPLIERS',
  CUSTOMERS: 'CUSTOMERS',
  BANK: 'BANK',
  CASH: 'CASH',
  PURCHASES: 'PURCHASES',
  COGS: 'COGS',
  SALES: 'SALES',
  EXPENSE_OTHER: 'EXPENSE_OTHER',
} as const;

export type SystemKey = (typeof SYSTEM_KEYS)[keyof typeof SYSTEM_KEYS];

export const DEFAULT_CHART_OF_ACCOUNTS: ChartAccountDef[] = [
  // ——— Classe 1 : Capitaux ———
  {
    code: '101',
    name: 'Capital',
    classNumber: 1,
    nature: AccountNature.BALANCE_SHEET,
    isDebitNormal: false,
    systemKey: SYSTEM_KEYS.CAPITAL,
  },
  {
    code: '120',
    name: "Résultat de l'exercice",
    classNumber: 1,
    nature: AccountNature.BALANCE_SHEET,
    isDebitNormal: false,
    systemKey: SYSTEM_KEYS.NET_RESULT,
  },
  {
    code: '110',
    name: 'Report à nouveau',
    classNumber: 1,
    nature: AccountNature.BALANCE_SHEET,
    isDebitNormal: false,
    systemKey: SYSTEM_KEYS.RETAINED,
  },

  // ——— Classe 2 : Immobilisations ———
  {
    code: '215',
    name: 'Matériel, outillage et mobilier',
    classNumber: 2,
    nature: AccountNature.BALANCE_SHEET,
    isDebitNormal: true,
    systemKey: SYSTEM_KEYS.FIXED_ASSETS,
  },
  {
    code: '218',
    name: 'Autres immobilisations corporelles',
    classNumber: 2,
    nature: AccountNature.BALANCE_SHEET,
    isDebitNormal: true,
  },
  {
    code: '281',
    name: 'Amortissements des immobilisations corporelles',
    classNumber: 2,
    nature: AccountNature.BALANCE_SHEET,
    isDebitNormal: false,
    systemKey: SYSTEM_KEYS.ACCUM_DEPR,
  },

  // ——— Classe 3 : Stocks ———
  {
    code: '37',
    name: 'Stocks de marchandises',
    classNumber: 3,
    nature: AccountNature.BALANCE_SHEET,
    isDebitNormal: true,
    systemKey: SYSTEM_KEYS.INVENTORY,
  },

  // ——— Classe 4 : Tiers ———
  {
    code: '401',
    name: 'Fournisseurs',
    classNumber: 4,
    nature: AccountNature.BALANCE_SHEET,
    isDebitNormal: false,
    systemKey: SYSTEM_KEYS.SUPPLIERS,
  },
  {
    code: '411',
    name: 'Clients',
    classNumber: 4,
    nature: AccountNature.BALANCE_SHEET,
    isDebitNormal: true,
    systemKey: SYSTEM_KEYS.CUSTOMERS,
  },
  {
    code: '421',
    name: 'Personnel — rémunérations dues',
    classNumber: 4,
    nature: AccountNature.BALANCE_SHEET,
    isDebitNormal: false,
  },

  // ——— Classe 5 : Trésorerie ———
  {
    code: '512',
    name: 'Banques',
    classNumber: 5,
    nature: AccountNature.BALANCE_SHEET,
    isDebitNormal: true,
    systemKey: SYSTEM_KEYS.BANK,
  },
  {
    code: '530',
    name: 'Caisse',
    classNumber: 5,
    nature: AccountNature.BALANCE_SHEET,
    isDebitNormal: true,
    systemKey: SYSTEM_KEYS.CASH,
  },

  // ——— Classe 6 : Charges ———
  {
    code: '607',
    name: 'Achats de marchandises',
    classNumber: 6,
    nature: AccountNature.INCOME_STATEMENT,
    isDebitNormal: true,
    systemKey: SYSTEM_KEYS.PURCHASES,
  },
  {
    code: '6037',
    name: 'Variation des stocks de marchandises',
    classNumber: 6,
    nature: AccountNature.INCOME_STATEMENT,
    isDebitNormal: true,
    systemKey: SYSTEM_KEYS.COGS,
  },
  {
    code: '613',
    name: 'Locations (loyers)',
    classNumber: 6,
    nature: AccountNature.INCOME_STATEMENT,
    isDebitNormal: true,
  },
  {
    code: '615',
    name: 'Entretien et réparations',
    classNumber: 6,
    nature: AccountNature.INCOME_STATEMENT,
    isDebitNormal: true,
  },
  {
    code: '616',
    name: "Primes d'assurance",
    classNumber: 6,
    nature: AccountNature.INCOME_STATEMENT,
    isDebitNormal: true,
  },
  {
    code: '622',
    name: 'Rémunérations d’intermédiaires et honoraires',
    classNumber: 6,
    nature: AccountNature.INCOME_STATEMENT,
    isDebitNormal: true,
  },
  {
    code: '623',
    name: 'Publicité, publications, relations publiques',
    classNumber: 6,
    nature: AccountNature.INCOME_STATEMENT,
    isDebitNormal: true,
  },
  {
    code: '624',
    name: 'Transports de biens et transport collectif',
    classNumber: 6,
    nature: AccountNature.INCOME_STATEMENT,
    isDebitNormal: true,
  },
  {
    code: '625',
    name: 'Déplacements, missions et réceptions',
    classNumber: 6,
    nature: AccountNature.INCOME_STATEMENT,
    isDebitNormal: true,
  },
  {
    code: '626',
    name: 'Frais postaux et de télécommunications',
    classNumber: 6,
    nature: AccountNature.INCOME_STATEMENT,
    isDebitNormal: true,
  },
  {
    code: '627',
    name: 'Services bancaires et assimilés',
    classNumber: 6,
    nature: AccountNature.INCOME_STATEMENT,
    isDebitNormal: true,
  },
  {
    code: '6061',
    name: 'Fournitures non stockables (eau, énergie, carburant)',
    classNumber: 6,
    nature: AccountNature.INCOME_STATEMENT,
    isDebitNormal: true,
  },
  {
    code: '6063',
    name: 'Fournitures d’entretien et de petit équipement',
    classNumber: 6,
    nature: AccountNature.INCOME_STATEMENT,
    isDebitNormal: true,
  },
  {
    code: '6064',
    name: 'Fournitures administratives',
    classNumber: 6,
    nature: AccountNature.INCOME_STATEMENT,
    isDebitNormal: true,
  },
  {
    code: '641',
    name: 'Rémunérations du personnel',
    classNumber: 6,
    nature: AccountNature.INCOME_STATEMENT,
    isDebitNormal: true,
  },
  {
    code: '681',
    name: 'Dotations aux amortissements',
    classNumber: 6,
    nature: AccountNature.INCOME_STATEMENT,
    isDebitNormal: true,
  },
  {
    code: '628',
    name: 'Divers — autres services extérieurs',
    classNumber: 6,
    nature: AccountNature.INCOME_STATEMENT,
    isDebitNormal: true,
    systemKey: SYSTEM_KEYS.EXPENSE_OTHER,
  },

  // ——— Classe 7 : Produits ———
  {
    code: '707',
    name: 'Ventes de marchandises',
    classNumber: 7,
    nature: AccountNature.INCOME_STATEMENT,
    isDebitNormal: false,
    systemKey: SYSTEM_KEYS.SALES,
  },
];

/** Mapping libellés dépenses POS → comptes de charge. */
export const EXPENSE_LABEL_TO_ACCOUNT: Record<string, string> = {
  SALAIRE: '641',
  CARBURANT: '6061',
  LOYER: '613',
  'MATERIEL DE BUREAU': '6064',
  'FOURNITURE DE BUREAU': '6064',
  'ENTRETIEN ET REPARATION': '615',
  'PUBLICITE ET PROMOTION': '623',
  ASSURANCE: '616',
  "FRAIS D'ADMINISTRATION": '628',
  'FRAIS DE COMMUNICATION': '626',
  "FRAIS D'INTERNET": '626',
  'FRAIS DE BANQUE': '627',
  TRANSPORT: '624',
  'EAU PORTABLE': '6061',
  'EAU DINEPA': '6061',
  AMORTISSEMENT: '681',
  'FRAIS DE CONSULTATION': '622',
  'AUTRES DEPENSES': '628',
};
