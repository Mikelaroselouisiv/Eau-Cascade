import type { SyncEntityName } from './sync.entities';

/** Référence FK : champ uuid transporté sur le fil → id local du nœud cible. */
export type SyncFkRef = {
  /** Champ dans le payload sync (ex. companyUuid). */
  uuidField: string;
  /** FK Int Prisma (ex. companyId). */
  idField: string;
  /** Entité parent avec `uuid` unique. */
  parent: SyncEntityName;
  /** Si true, parent introuvable → erreur (pas d’apply, curseur n’avance pas). */
  required: boolean;
};

/**
 * Carte des FK à remapper en sync.
 * Les Int du nœud source ne doivent jamais être appliqués tels quels.
 */
export const ENTITY_FK_MAP: Partial<Record<SyncEntityName, SyncFkRef[]>> = {
  Department: [
    { uuidField: 'companyUuid', idField: 'companyId', parent: 'Company', required: true },
  ],
  DepartmentPrinterProfile: [
    { uuidField: 'departmentUuid', idField: 'departmentId', parent: 'Department', required: true },
  ],
  PackagingUnit: [
    { uuidField: 'departmentUuid', idField: 'departmentId', parent: 'Department', required: true },
  ],
  Store: [
    { uuidField: 'companyUuid', idField: 'companyId', parent: 'Company', required: false },
  ],
  Register: [
    { uuidField: 'storeUuid', idField: 'storeId', parent: 'Store', required: true },
    { uuidField: 'departmentUuid', idField: 'departmentId', parent: 'Department', required: false },
  ],
  Product: [
    { uuidField: 'companyUuid', idField: 'companyId', parent: 'Company', required: true },
    { uuidField: 'departmentUuid', idField: 'departmentId', parent: 'Department', required: false },
    {
      uuidField: 'productFamilyUuid',
      idField: 'productFamilyId',
      parent: 'ProductFamily',
      required: false,
    },
    { uuidField: 'createdByUuid', idField: 'createdById', parent: 'User', required: false },
    { uuidField: 'updatedByUuid', idField: 'updatedById', parent: 'User', required: false },
  ],
  ProductSaleUnit: [
    { uuidField: 'productUuid', idField: 'productId', parent: 'Product', required: true },
    { uuidField: 'packagingUnitUuid', idField: 'packagingUnitId', parent: 'PackagingUnit', required: true },
  ],
  ProductVolumePrice: [
    {
      uuidField: 'productSaleUnitUuid',
      idField: 'productSaleUnitId',
      parent: 'ProductSaleUnit',
      required: true,
    },
  ],
  ProductFamily: [
    { uuidField: 'companyUuid', idField: 'companyId', parent: 'Company', required: true },
  ],
  ProductFamilyTier: [
    {
      uuidField: 'productFamilyUuid',
      idField: 'productFamilyId',
      parent: 'ProductFamily',
      required: true,
    },
  ],
  ProductRecipe: [
    { uuidField: 'parentProductUuid', idField: 'parentProductId', parent: 'Product', required: true },
  ],
  RecipeComponent: [
    { uuidField: 'recipeUuid', idField: 'recipeId', parent: 'ProductRecipe', required: true },
    {
      uuidField: 'componentProductUuid',
      idField: 'componentProductId',
      parent: 'Product',
      required: true,
    },
  ],
  User: [
    { uuidField: 'companyUuid', idField: 'companyId', parent: 'Company', required: false },
    { uuidField: 'departmentUuid', idField: 'departmentId', parent: 'Department', required: false },
  ],
  ExpenseCategory: [
    { uuidField: 'companyUuid', idField: 'companyId', parent: 'Company', required: true },
  ],
  CreditCustomer: [
    { uuidField: 'companyUuid', idField: 'companyId', parent: 'Company', required: true },
    { uuidField: 'departmentUuid', idField: 'departmentId', parent: 'Department', required: false },
  ],
  Sale: [
    { uuidField: 'userUuid', idField: 'userId', parent: 'User', required: false },
    { uuidField: 'storeUuid', idField: 'storeId', parent: 'Store', required: false },
    { uuidField: 'registerUuid', idField: 'registerId', parent: 'Register', required: false },
    {
      uuidField: 'creditCustomerUuid',
      idField: 'creditCustomerId',
      parent: 'CreditCustomer',
      required: false,
    },
  ],
  SaleItem: [
    { uuidField: 'saleUuid', idField: 'saleId', parent: 'Sale', required: true },
    { uuidField: 'productUuid', idField: 'productId', parent: 'Product', required: true },
    {
      uuidField: 'productSaleUnitUuid',
      idField: 'productSaleUnitId',
      parent: 'ProductSaleUnit',
      required: false,
    },
  ],
  Payment: [
    { uuidField: 'saleUuid', idField: 'saleId', parent: 'Sale', required: true },
    {
      uuidField: 'bankAccountUuid',
      idField: 'bankAccountId',
      parent: 'BankAccount',
      required: false,
    },
  ],
  Bank: [
    { uuidField: 'companyUuid', idField: 'companyId', parent: 'Company', required: true },
  ],
  BankAccount: [
    { uuidField: 'companyUuid', idField: 'companyId', parent: 'Company', required: true },
    { uuidField: 'bankUuid', idField: 'bankId', parent: 'Bank', required: true },
  ],
  BankTransaction: [
    {
      uuidField: 'bankAccountUuid',
      idField: 'bankAccountId',
      parent: 'BankAccount',
      required: true,
    },
    { uuidField: 'userUuid', idField: 'userId', parent: 'User', required: false },
  ],
  Delivery: [
    { uuidField: 'saleUuid', idField: 'saleId', parent: 'Sale', required: true },
    { uuidField: 'companyUuid', idField: 'companyId', parent: 'Company', required: true },
    { uuidField: 'departmentUuid', idField: 'departmentId', parent: 'Department', required: false },
    { uuidField: 'deliveredByUuid', idField: 'deliveredById', parent: 'User', required: false },
  ],
  DeliveryItem: [
    { uuidField: 'deliveryUuid', idField: 'deliveryId', parent: 'Delivery', required: true },
    { uuidField: 'saleItemUuid', idField: 'saleItemId', parent: 'SaleItem', required: true },
  ],
  StockMovement: [
    { uuidField: 'productUuid', idField: 'productId', parent: 'Product', required: true },
    { uuidField: 'createdByUuid', idField: 'createdById', parent: 'User', required: false },
    {
      uuidField: 'inventorySessionUuid',
      idField: 'inventorySessionId',
      parent: 'InventorySession',
      required: false,
    },
    {
      uuidField: 'goodsReceiptUuid',
      idField: 'goodsReceiptId',
      parent: 'GoodsReceipt',
      required: false,
    },
  ],
  FinanceEntry: [
    { uuidField: 'categoryUuid', idField: 'categoryId', parent: 'ExpenseCategory', required: false },
    { uuidField: 'userUuid', idField: 'userId', parent: 'User', required: false },
    { uuidField: 'saleUuid', idField: 'saleId', parent: 'Sale', required: false },
  ],
  CreditPayment: [
    {
      uuidField: 'creditCustomerUuid',
      idField: 'creditCustomerId',
      parent: 'CreditCustomer',
      required: true,
    },
    { uuidField: 'saleUuid', idField: 'saleId', parent: 'Sale', required: false },
    { uuidField: 'userUuid', idField: 'userId', parent: 'User', required: false },
    {
      uuidField: 'financeEntryUuid',
      idField: 'financeEntryId',
      parent: 'FinanceEntry',
      required: false,
    },
    {
      uuidField: 'bankAccountUuid',
      idField: 'bankAccountId',
      parent: 'BankAccount',
      required: false,
    },
  ],
  InventorySession: [
    { uuidField: 'departmentUuid', idField: 'departmentId', parent: 'Department', required: true },
    { uuidField: 'createdByUuid', idField: 'createdById', parent: 'User', required: false },
    { uuidField: 'completedByUuid', idField: 'completedById', parent: 'User', required: false },
    { uuidField: 'cancelledByUuid', idField: 'cancelledById', parent: 'User', required: false },
  ],
  InventoryLine: [
    {
      uuidField: 'inventorySessionUuid',
      idField: 'sessionId',
      parent: 'InventorySession',
      required: true,
    },
    { uuidField: 'productUuid', idField: 'productId', parent: 'Product', required: true },
  ],
  PurchaseOrder: [
    { uuidField: 'companyUuid', idField: 'companyId', parent: 'Company', required: true },
    { uuidField: 'departmentUuid', idField: 'departmentId', parent: 'Department', required: true },
    { uuidField: 'createdByUuid', idField: 'createdById', parent: 'User', required: false },
  ],
  PurchaseOrderLine: [
    {
      uuidField: 'purchaseOrderUuid',
      idField: 'purchaseOrderId',
      parent: 'PurchaseOrder',
      required: true,
    },
    { uuidField: 'productUuid', idField: 'productId', parent: 'Product', required: true },
  ],
  GoodsReceipt: [
    {
      uuidField: 'purchaseOrderUuid',
      idField: 'purchaseOrderId',
      parent: 'PurchaseOrder',
      required: false,
    },
    { uuidField: 'departmentUuid', idField: 'departmentId', parent: 'Department', required: true },
    { uuidField: 'createdByUuid', idField: 'createdById', parent: 'User', required: false },
  ],
  GoodsReceiptLine: [
    {
      uuidField: 'goodsReceiptUuid',
      idField: 'goodsReceiptId',
      parent: 'GoodsReceipt',
      required: true,
    },
    { uuidField: 'productUuid', idField: 'productId', parent: 'Product', required: true },
  ],
  CashClosure: [
    { uuidField: 'registerUuid', idField: 'registerId', parent: 'Register', required: false },
    { uuidField: 'createdByUuid', idField: 'createdById', parent: 'User', required: false },
  ],
  AuditLog: [
    { uuidField: 'userUuid', idField: 'userId', parent: 'User', required: false },
  ],
};

/** Champs relationnels Prisma à exclure du payload sync. */
export const RELATION_OBJECT_KEYS = new Set([
  'company',
  'department',
  'store',
  'register',
  'product',
  'packagingUnit',
  'productSaleUnit',
  'sale',
  'user',
  'createdBy',
  'parentProduct',
  'componentProduct',
  'recipe',
  'category',
  'session',
  'inventorySession',
  'purchaseOrder',
  'goodsReceipt',
  'items',
  'payments',
  'lines',
  'components',
  'entries',
  'financeEntry',
  'creditCustomer',
  'creditPayment',
  'creditPayments',
  'delivery',
  'deliveryItem',
  'deliveredBy',
  'saleItem',
  'stockMovements',
  'saleUnits',
  'volumePrices',
  'productFamily',
  'tiers',
  'products',
  'users',
  'departments',
  'stores',
  'printerProfile',
  'packagingUnits',
  'bank',
  'banks',
  'bankAccount',
  'accounts',
  'transactions',
]);
