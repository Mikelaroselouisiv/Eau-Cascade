/**
 * Entités syncées dans l’ordre (parents avant enfants).
 * Les payloads transportent des *Uuid parents ; le backend cible
 * résout uuid → id local (voir SyncService.resolveForeignKeys).
 */
export const ENTITY_ORDER = [
  'Company',
  'Department',
  'DepartmentPrinterProfile',
  'PackagingUnit',
  'Store',
  'Register',
  // AppRole: seulement quand local ET GCP exposent l'entité via /sync/entities
  'User',
  'ExpenseCategory',
  'CreditCustomer',
  'Product',
  'ProductSaleUnit',
  'ProductVolumePrice',
  'ProductRecipe',
  'RecipeComponent',
  'Sale',
  'SaleItem',
  'Payment',
  'Delivery',
  'DeliveryItem',
  'StockMovement',
  'FinanceEntry',
  'CreditPayment',
  'InventorySession',
  'InventoryLine',
  'PurchaseOrder',
  'PurchaseOrderLine',
  'GoodsReceipt',
  'GoodsReceiptLine',
  'CashClosure',
  'AuditLog',
];
