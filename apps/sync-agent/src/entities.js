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
  'User',
  'ExpenseCategory',
  'CreditCustomer',
  // Banques avant Payment / CreditPayment / BankTransaction (FK bankAccountId).
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
  'Payment',
  'Delivery',
  'DeliveryItem',
  'StockMovement',
  'FinanceEntry',
  'CreditPayment',
  // Dépôts POS/crédit : après comptes + paiements.
  'BankTransaction',
  'InventorySession',
  'InventoryLine',
  'PurchaseOrder',
  'PurchaseOrderLine',
  'GoodsReceipt',
  'GoodsReceiptLine',
  'CashClosure',
  'AuditLog',
];
