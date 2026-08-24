/** Entités exposées à /sync/pull et /sync/push. */
export const SYNC_ENTITIES = [
  'Company',
  'Department',
  'DepartmentPrinterProfile',
  'PackagingUnit',
  'Store',
  'Register',
  'ProductFamily',
  'ProductFamilyTier',
  'Product',
  'ProductSaleUnit',
  'ProductVolumePrice',
  'ProductRecipe',
  'RecipeComponent',
  'User',
  'ExpenseCategory',
  'CreditCustomer',
  'Sale',
  'SaleItem',
  'Payment',
  'Delivery',
  'DeliveryItem',
  'StockMovement',
  'FinanceEntry',
  'CreditPayment',
  'Bank',
  'BankAccount',
  'BankTransaction',
  'InventorySession',
  'InventoryLine',
  'PurchaseOrder',
  'PurchaseOrderLine',
  'GoodsReceipt',
  'GoodsReceiptLine',
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
]);

/** Config mutable : LWW symétrique sur max(updatedAt, deletedAt) — admin depuis n’importe quel nœud. */
export const CONFIG_ENTITIES = new Set<SyncEntityName>([
  'Company',
  'Department',
  'DepartmentPrinterProfile',
  'PackagingUnit',
  'User',
  'Store',
  'Register',
  'CreditCustomer',
  'Bank',
  'BankAccount',
]);
