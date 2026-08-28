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
  'AppRole',
  'User',
  'UserDepartment',
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
  'SaleDeliveryStop',
  'Payment',
  'Delivery',
  'DeliveryItem',
  'DeliveryDrop',
  'StockMovement',
  'FinanceEntry',
  'CreditPayment',
  // Dépôts POS/crédit : après comptes + paiements.
  'BankTransaction',
  'InventorySession',
  'InventoryLine',
  'RegisterSession',
  'PurchaseOrder',
  'PurchaseOrderLine',
  'GoodsReceipt',
  'GoodsReceiptLine',
  'CashClosure',
  'AuditLog',
];
