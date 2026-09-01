/** Entités exposées à /sync/pull et /sync/push. */
export const SYNC_ENTITIES = [
  'Company',
  'Department',
  'DepartmentPrinterProfile',
  'PackagingUnit',
  'Store',
  'Register',
  'AppRole',
  'User',
  'UserDepartment',
  'ExpenseCategory',
  'CreditCustomer',
  'DonationBeneficiary',
  'Bank',
  'BankAccount',
  'ProductFamily',
  'ProductFamilyTier',
  'Product',
  'ProductSaleUnit',
  'ProductVolumePrice',
  'ProductRecipe',
  'RecipeComponent',
  'Sale',
  'SaleItem',
  'SaleDeliveryStop',
  'Payment',
  'Delivery',
  'DeliveryItem',
  'DeliveryDrop',
  'InventorySession',
  'InventoryLine',
  'RegisterSession',
  'ProductionSession',
  'InternalTransfer',
  'InternalTransferItem',
  'Donation',
  'DonationItem',
  'PurchaseOrder',
  'PurchaseOrderLine',
  'GoodsReceipt',
  'GoodsReceiptLine',
  'StockMovement',
  'ProductionFlow',
  'FinanceEntry',
  'CreditPayment',
  'BankTransaction',
  'CashClosure',
  'AuditLog',
] as const;

export type SyncEntityName = (typeof SYNC_ENTITIES)[number];

export function isSyncEntity(name: string): name is SyncEntityName {
  return (SYNC_ENTITIES as readonly string[]).includes(name);
}

/** Append-only : insert si uuid inconnu, jamais écraser. */
export const APPEND_ONLY_ENTITIES = new Set<SyncEntityName>([
  // Sale / SaleItem / Payment / FinanceEntry : LWW pour propager deletedAt (tombstones).
  'StockMovement',
  'AuditLog',
  'CashClosure',
  'CreditPayment',
  'DeliveryDrop',
  'ProductionFlow',
]);

/** Config mutable : LWW symétrique sur max(updatedAt, deletedAt) — admin depuis n’importe quel nœud. */
export const CONFIG_ENTITIES = new Set<SyncEntityName>([
  'Company',
  'Department',
  'DepartmentPrinterProfile',
  'PackagingUnit',
  'AppRole',
  'User',
  'UserDepartment',
  'Store',
  'Register',
  'CreditCustomer',
  'DonationBeneficiary',
  'Bank',
  'BankAccount',
]);
