export type UserRole =
  | 'ADMIN'
  | 'MANAGER'
  | 'CASHIER'
  | 'STOCK_MANAGER'
  | 'ACCOUNTANT'
  | 'LIVREUR'
  | (string & {});

export interface UserAttribution {
  id: number;
  fullName?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface SessionUser {
  id: number;
  phone: string;
  email?: string | null;
  role: UserRole;
  roleLabel?: string | null;
  permissions?: string[];
  fullName?: string | null;
  isActive?: boolean;
  companyId?: number | null;
  departmentId?: number | null;
  createdAt?: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: SessionUser;
}

export interface PermissionDefinition {
  code: string;
  label: string;
}

export interface AppRoleRow {
  id: number;
  code: string;
  label: string;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
  isActive: boolean;
}

export type StockMovementKind = 'IN' | 'OUT' | 'ADJUSTMENT';

export type PurchaseOrderStatus = 'DRAFT' | 'ORDERED' | 'CLOSED' | 'CANCELLED';
export type GoodsReceiptStatus = 'DRAFT' | 'POSTED';

export interface StockMovementRow {
  id: number;
  productId: number;
  quantity: string | number;
  type: StockMovementKind;
  reason: string | null;
  createdAt: string;
  product: {
    id: number;
    name: string;
    saleUnits?: Array<{
      isDefault: boolean;
      labelOverride: string | null;
      packagingUnit: { id: number; code: string; label: string };
    }>;
  };
  createdBy: UserAttribution | null;
  inventorySession?: { id: number; label: string | null; departmentId: number } | null;
  goodsReceipt?: { id: number; departmentId: number; status: GoodsReceiptStatus } | null;
}

export type InventorySessionStatus = 'DRAFT' | 'COMPLETED' | 'CANCELLED';
export type InventorySessionKind = 'OPENING' | 'CLOSING' | 'AD_HOC';

export interface InventorySessionListItem {
  id: number;
  departmentId: number;
  kind?: InventorySessionKind;
  status: InventorySessionStatus;
  label: string | null;
  note: string | null;
  completedAt: string | null;
  createdAt: string;
  department: { id: number; name: string; company: { id: number; name: string } };
  createdBy?: UserAttribution | null;
  completedBy?: UserAttribution | null;
  cancelledBy?: UserAttribution | null;
  _count: { lines: number };
}

export interface InventorySessionDetail {
  id: number;
  departmentId: number;
  kind?: InventorySessionKind;
  status: InventorySessionStatus;
  label: string | null;
  note: string | null;
  completedAt: string | null;
  createdAt: string;
  createdBy?: UserAttribution | null;
  completedBy?: UserAttribution | null;
  cancelledBy?: UserAttribution | null;
  department: { id: number; name: string; company: { id: number; name: string } };
  lines: InventoryLineRow[];
}

export interface InventoryLineRow {
  id: number;
  productId: number;
  systemQtyAtOpen: string | number;
  countedQty: string | number | null;
  note: string | null;
  product: { id: number; name: string; sku?: string | null; stock?: string | number };
}

export interface InventoryCountSheetRow {
  id: number;
  name: string;
  sku: string | null;
  stock: number;
  unitLabel: string;
}

export interface InventoryCountSheet {
  generatedAt: string;
  /** Instant rétrospectif (ISO) si filtré par date ; sinon null/absent = stock actuel. */
  asOf?: string | null;
  department: { id: number; name: string; company: { id: number; name: string } };
  products: InventoryCountSheetRow[];
}

export type RegisterSessionStatus = 'OPEN' | 'CLOSED';

export interface RegisterListItem {
  id: number;
  code: string;
  storeId: number;
  departmentId?: number | null;
  store: { id: number; name: string; companyId: number | null };
  department?: { id: number; name: string } | null;
}

export interface RegisterInventoryLinePayload {
  productId: number;
  countedQty: number;
}

export interface RegisterSessionDetail {
  id: number;
  registerId: number;
  departmentId: number;
  status: RegisterSessionStatus;
  openedAt: string;
  closedAt: string | null;
  openingCashAmount: string | number | null;
  closingCashExpected: string | number | null;
  closingCashCounted: string | number | null;
  cashVariance: string | number | null;
  register: RegisterListItem;
  department: { id: number; name: string; company: { id: number; name: string } };
  openedBy: UserAttribution | null;
  closedBy: UserAttribution | null;
  openingInventorySession: InventorySessionDetail;
  closingInventorySession: InventorySessionDetail | null;
}

export interface GlobalStockSnapshotItem {
  id: number;
  name: string;
  sku: string | null;
  stock: number;
  stockMin: number;
  company: { id: number; name: string } | null;
  department: { id: number; name: string } | null;
  unitLabel: string;
  lowStock: boolean;
}

export interface GlobalStockSnapshot {
  generatedAt: string;
  /** Instant rétrospectif (ISO) si filtré ; sinon null = stock actuel. */
  asOf?: string | null;
  items: GlobalStockSnapshotItem[];
}

export type ReceptionStatus = 'pending' | 'partial' | 'complete';

export interface PurchaseOrderLineProgress {
  productId: number;
  quantityOrdered: number;
  quantityReceived: number;
  quantityRemaining: number;
}

export interface PurchaseOrderListItem {
  id: number;
  companyId: number;
  departmentId: number;
  supplierName: string | null;
  status: PurchaseOrderStatus;
  reference: string | null;
  createdAt: string;
  department: { id: number; name: string };
  createdBy?: UserAttribution | null;
  receptionStatus?: ReceptionStatus;
  lineProgress?: PurchaseOrderLineProgress[];
  /** Estimation : Σ (qté commandée × prix unitaire) — hors caisse. */
  amountOrderedEst?: number;
  /** Montant réellement réceptionné : Σ (qté reçue × coût unitaire). */
  amountReceived?: number;
  /** Estimation du reste à recevoir : Σ (reste × prix unitaire). */
  amountPendingEst?: number;
  orderedLinesMissingPrice?: number;
  _count: { lines: number; goodsReceipts?: number };
}

export interface PurchaseOrdersAmountSummary {
  companyId: number;
  orderCount: number;
  pendingCount: number;
  partialCount: number;
  completeCount: number;
  ordersMissingPrice: number;
  amountOrderedEst: number;
  amountReceived: number;
  amountPendingEst: number;
}

export interface PurchaseOrderLineDetail {
  id: number;
  productId: number;
  quantityOrdered: number;
  quantityReceived: number;
  quantityRemaining: number;
  unitPriceEst: number | null;
  product: { id: number; name: string; sku?: string | null };
}

export interface PurchaseOrderDetail extends PurchaseOrderListItem {
  lines: PurchaseOrderLineDetail[];
  goodsReceipts?: Array<{
    id: number;
    receivedAt: string;
    createdBy?: UserAttribution | null;
    lines: Array<{
      productId: number;
      quantity: string | number;
      unitCost: string | number;
      product: { id: number; name: string };
    }>;
  }>;
}

export interface GoodsReceiptListItem {
  id: number;
  departmentId: number;
  purchaseOrderId: number | null;
  status: GoodsReceiptStatus;
  receivedAt: string;
  createdAt: string;
  department: { id: number; name: string; companyId: number };
  createdBy?: UserAttribution | null;
  _count: { lines: number };
  purchaseOrder: { id: number; reference: string | null } | null;
}

export interface AuditLogRow {
  id: number;
  action: string;
  entity: string;
  entityId: string | null;
  metadata: unknown;
  createdAt: string;
  user: UserAttribution | null;
}

export interface ProductRecipeDetail {
  id: number;
  parentProductId: number;
  components: Array<{
    id: number;
    componentProductId: number;
    quantityPerParentBaseUnit: string | number;
    componentProduct: { id: number; name: string; sku?: string | null };
  }>;
  parentProduct: { id: number; name: string; isService: boolean };
}

export interface PackagingUnit {
  id: number;
  departmentId: number;
  code: string;
  label: string;
  sortOrder: number;
  department?: {
    id: number;
    name: string;
    companyId: number;
    company?: { id: number; name: string };
  };
}

export interface ProductVolumePrice {
  id: number;
  productSaleUnitId: number;
  minQuantity: string | number;
  unitPrice: string | number;
  sortOrder: number;
}

export interface ProductFamilyTier {
  id: number;
  productFamilyId: number;
  minQuantity: string | number;
  unitPrice: string | number;
  sortOrder: number;
}

export interface ProductFamily {
  id: number;
  uuid?: string;
  companyId: number;
  name: string;
  tiers: ProductFamilyTier[];
  products?: Array<{
    id: number;
    name: string;
    companyId?: number;
    departmentId?: number | null;
  }>;
}

export interface ProductSaleUnit {
  id: number;
  productId: number;
  packagingUnitId: number;
  labelOverride: string | null;
  unitsPerPackage: string | number;
  salePrice: string | number;
  isDefault: boolean;
  packagingUnit: PackagingUnit;
  volumePrices?: ProductVolumePrice[];
}

export interface Product {
  id: number;
  companyId?: number;
  productFamilyId?: number | null;
  productFamily?: ProductFamily | null;
  name: string;
  cardColor?: string | null;
  sku?: string | null;
  barcode?: string | null;
  description?: string | null;
  isService: boolean;
  trackStock: boolean;
  cost: string | number;
  stock: string | number;
  stockMin: string | number;
  saleUnits: ProductSaleUnit[];
  company?: { id: number; name: string; currency?: string } | null;
  department?: { id: number; name: string } | null;
}

export interface SaleItemPayload {
  productSaleUnitId: number;
  quantity: number;
  /** Prix unitaire manuel (vente spéciale). */
  unitPrice?: number;
}

export interface PaymentPayload {
  method: 'CASH' | 'CARD' | 'MOBILE_MONEY' | 'SPLIT' | 'CREDIT' | 'BANK';
  amount: number;
  reference?: string;
  /** Requis si method = BANK. */
  bankAccountId?: number;
}

export interface CreateSalePayload {
  items: SaleItemPayload[];
  payments: PaymentPayload[];
  clientName?: string | null;
  /** UUID client pour idempotence (offline / rejeu). */
  clientUuid?: string;
  registerId?: number;
  /** Vente spéciale (prix manuels) — ADMIN / MANAGER. */
  specialSale?: boolean;
  /** Espèces tendues (vente classique) — peut différer du total. */
  amountReceived?: number;
}

export interface SaleCashGapRow {
  id: number;
  /** Numéro ticket / livraison (stable après sync). */
  txnNumber?: number;
  clientName?: string | null;
  cashier?: string | null;
  createdAt: string;
  total: number;
  amountReceived: number;
  amountPaid: number;
  changeDue: number;
  balanceDue: number;
  kind: 'CHANGE_OWED' | 'BALANCE_OWED';
}

export interface SaleCashGaps {
  changeOwed: SaleCashGapRow[];
  balanceOwed: SaleCashGapRow[];
}

export interface SalePaymentRow {
  id?: number;
  amount: string | number;
  method: 'CASH' | 'CARD' | 'MOBILE_MONEY' | 'SPLIT' | 'CREDIT' | 'BANK';
  reference?: string | null;
  bankAccountId?: number | null;
  createdAt?: string;
}

export interface Sale {
  id: number;
  /** Numéro métier (impression / tableau) — stable après sync. */
  txnNumber?: number | null;
  total: number | string;
  subtotal?: number | string;
  tax?: number | string;
  status: 'COMPLETED' | 'CANCELLED' | 'REFUNDED';
  createdAt: string;
  clientName?: string | null;
  cashier?: string | null;
  amountPaid?: number | string;
  amountReceived?: number | string;
  changeDue?: number | string;
  changeSettledAt?: string | null;
  cashBalanceSettledAt?: string | null;
  /** Présent si la vente vient du board Crédit (hors caisse POS). */
  creditCustomerId?: number | null;
  userId?: number | null;
  user?: {
    id: number;
    fullName?: string | null;
    phone?: string | null;
    email?: string | null;
    role?: string;
  } | null;
  items?: Array<{
    lineLabel?: string | null;
    quantity: string | number;
    unitPrice: string | number;
    subtotal: string | number;
    product?: {
      id: number;
      name: string;
      companyId?: number;
      departmentId?: number | null;
      department?: { id: number; name?: string } | null;
    };
  }>;
  payments?: SalePaymentRow[];
}

export type DeliveryStatus = 'PENDING' | 'PARTIAL' | 'DELIVERED';

export interface DeliveryItem {
  id: number;
  saleItemId: number;
  quantityOrdered: number | string;
  quantityDelivered: number | string;
  saleItem?: {
    id: number;
    lineLabel?: string | null;
    quantity?: number | string;
    unitPrice?: number | string;
    subtotal?: number | string;
    product?: { id: number; name: string } | null;
  } | null;
}

export interface Delivery {
  id: number;
  uuid: string;
  saleId: number;
  /** Numéro imprimé sur le ticket (= sale.txnNumber) — à utiliser pour retrouver la fiche. */
  saleRef?: number | null;
  companyId: number;
  departmentId?: number | null;
  status: DeliveryStatus;
  note?: string | null;
  deliveredAt?: string | null;
  createdAt: string;
  company?: { id: number; name: string } | null;
  department?: { id: number; name: string } | null;
  deliveredBy?: {
    id: number;
    fullName?: string | null;
    phone?: string | null;
  } | null;
  sale?: {
    id: number;
    txnNumber?: number | null;
    total: number | string;
    clientName?: string | null;
    cashier?: string | null;
    status: string;
    createdAt: string;
    user?: {
      id: number;
      fullName?: string | null;
      phone?: string | null;
    } | null;
  } | null;
  items?: DeliveryItem[];
}

export interface RevenueReport {
  day: number;
  week: number;
  month: number;
}

export interface DashboardBalanceSnapshot {
  purchases: number;
  manualExpenses: number;
  /** Revenus (ventes TTC lignes). */
  sales: number;
  /** Sorties d’argent : achats reçus + dépenses manuelles. */
  totalOutflows: number;
  /** Résultat net = ventes − achats − dépenses (positif = excédent). */
  balance: number;
  deficit: number;
  trend: 'UP' | 'DOWN' | 'FLAT';
  trendPct: number | null;
}

export interface DashboardSalesByProductRow {
  companyId?: number | null;
  companyName?: string | null;
  departmentId: number | null;
  departmentName: string | null;
  productId: number;
  productName: string;
  isService: boolean;
  quantity: number;
  totalSubtotal: number;
}

export interface DashboardSummaryReport {
  day: DashboardBalanceSnapshot;
  week: DashboardBalanceSnapshot;
  month: DashboardBalanceSnapshot;
}

export interface CompanyProfile {
  id: number;
  name: string;
  legalName?: string | null;
  address: string;
  city?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  headerText?: string | null;
  presentationText?: string | null;
  logoUrl?: string | null;
  taxId?: string | null;
  currency: string;
  vatRatePercent: string | number;
}

/** Réponse de GET /companies (liste). */
export interface CompanyListItem {
  id: number;
  name: string;
  legalName?: string | null;
  address: string;
  city?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  headerText?: string | null;
  presentationText?: string | null;
  logoUrl?: string | null;
  taxId?: string | null;
  currency: string;
  vatRatePercent: string | number;
  _count: { products: number; users: number; departments: number };
}

/** Réglages ticket par département (GET/PATCH /company/printer). */
export interface DepartmentPrinterSettings {
  id: number;
  departmentId: number;
  paperWidth: number;
  deviceName: string;
  autoCut: boolean;
  showLogoOnReceipt: boolean;
  receiptHeaderText?: string | null;
  receiptFooterText?: string | null;
  receiptLogoUrl?: string | null;
  previewSampleBody?: string | null;
  showLogoOnDisbursement?: boolean;
  disbursementHeaderText?: string | null;
  disbursementFooterText?: string | null;
  disbursementLogoUrl?: string | null;
  disbursementPreviewSampleBody?: string | null;
}

/** Département : mini-périmètre au sein de l’entreprise (produits, stocks rattachés). */
export interface Department {
  id: number;
  companyId: number;
  name: string;
  description?: string | null;
  company?: { id: number; name: string };
}

export interface FinanceEntry {
  id: number;
  type: 'INCOME' | 'EXPENSE';
  amount: string | number;
  description: string;
  detail?: string | null;
  createdAt: string;
  user?: { id: number; fullName?: string | null; phone: string } | null;
}

/** GET /finance/ledger — achats (réceptions), ventes (encaissements), dépenses manuelles. */
export interface FinanceLedgerRow {
  kind: 'PURCHASE' | 'SALE' | 'EXPENSE';
  id: string;
  occurredAt: string;
  amount: number;
  description: string;
  detail?: string | null;
  user: { id: number; fullName: string | null; phone: string } | null;
}

export type CreditCustomerStatus = 'CLEAR' | 'PARTIAL' | 'OVERDUE' | 'AT_LIMIT' | 'BLOCKED';

export interface CreditCustomerListItem {
  id: number;
  uuid: string;
  companyId: number;
  departmentId: number | null;
  name: string;
  phone: string | null;
  address: string | null;
  note: string | null;
  creditLimit: number;
  isActive: boolean;
  balance: number;
  openSalesCount: number;
  oldestUnpaidAt: string | null;
  status: CreditCustomerStatus;
  department?: { id: number; name: string } | null;
  company?: { id: number; name: string } | null;
  createdAt?: string;
}

export interface CreditCustomerDetail extends CreditCustomerListItem {
  availableCredit: number;
  sales: Array<{
    id: number;
    total: number;
    amountPaid: number;
    balanceDue: number;
    createdAt: string;
    clientName?: string | null;
    items: Array<{
      id: number;
      quantity: number;
      unitPrice: number;
      subtotal: number;
      lineLabel?: string | null;
      product?: { id: number; name: string; sku?: string | null } | null;
    }>;
    delivery?: { id: number; status: string } | null;
  }>;
  repayments: Array<{
    id: number;
    amount: number;
    method: string;
    reference?: string | null;
    note?: string | null;
    saleId?: number | null;
    createdAt: string;
    user?: UserAttribution | null;
  }>;
  timeline: Array<{
    kind: 'SALE' | 'PAYMENT';
    at: string;
    label: string;
    amount: number;
    meta?: Record<string, unknown>;
  }>;
}

export interface CreditSummary {
  customersTotal: number;
  withDebt: number;
  clear: number;
  overdue: number;
  totalReceivable: number;
  topDebtors: CreditCustomerListItem[];
}

export interface MarginAnalysisProductRow {
  productId: number;
  name: string;
  sku: string | null;
  departmentName: string | null;
  quantity: number;
  revenue: number;
  cost: number;
  margin: number;
  marginPct: number | null;
}

export interface MarginAnalysisReport {
  dateFrom: string;
  dateTo: string;
  revenue: number;
  cost: number;
  margin: number;
  marginPct: number | null;
  productsCount: number;
  products: MarginAnalysisProductRow[];
}

export type BankTransactionType = 'DEPOSIT' | 'WITHDRAWAL';

export interface BankAccountRow {
  id: number;
  uuid?: string;
  bankId: number;
  companyId: number;
  name: string;
  accountNumber: string | null;
  openingBalance: number;
  balance: number;
  isActive: boolean;
  note: string | null;
  bankName?: string;
}

export interface BankRow {
  id: number;
  uuid: string;
  companyId: number;
  name: string;
  note: string | null;
  isActive: boolean;
  createdAt?: string;
  accounts: BankAccountRow[];
}

export interface BankSummary {
  banksCount: number;
  accountsCount: number;
  totalCapital: number;
  accounts: BankAccountRow[];
  byBank: Array<{ id: number; name: string; accountsCount: number; balance: number }>;
}

export interface BankTransactionRow {
  id: number;
  type: BankTransactionType;
  amount: number;
  description: string;
  reference: string | null;
  occurredAt: string;
  createdAt?: string;
  user?: UserAttribution | null;
  bankAccount: {
    id: number;
    name: string;
    accountNumber?: string | null;
    bank: { id: number; name: string };
  };
}

/** ——— Comptabilité (partie double PCG) ——— */

export type FiscalYearStatus = 'OPEN' | 'CLOSED';
export type JournalCode = 'VE' | 'AC' | 'BQ' | 'CA' | 'OD' | 'AN';

export interface AccountRow {
  id: number;
  code: string;
  name: string;
  classNumber: number;
  nature: 'BALANCE_SHEET' | 'INCOME_STATEMENT';
  isDebitNormal: boolean;
  systemKey?: string | null;
  isSystem: boolean;
  isActive: boolean;
}

export interface FiscalYearRow {
  id: number;
  companyId?: number;
  label: string;
  /** YYYY-MM-DD (ou ISO) */
  startDate: string;
  /** YYYY-MM-DD (ou ISO) */
  endDate: string;
  status: FiscalYearStatus;
  closedAt?: string | null;
  closedBy?: { id: number; fullName: string | null; phone: string } | null;
  _count?: { entries: number };
}

export interface JournalLineRow {
  id: number;
  debit: string | number;
  credit: string | number;
  label?: string | null;
  account: { id: number; code: string; name: string };
}

export interface JournalEntryRow {
  id: number;
  entryDate: string;
  journalCode: JournalCode;
  entryNumber: number;
  description: string;
  reference?: string | null;
  source: string;
  lines: JournalLineRow[];
  createdBy?: { id: number; fullName: string | null; phone: string } | null;
}

export interface AccountingOverview {
  openFiscalYear: FiscalYearRow | null;
  fiscalYears: FiscalYearRow[];
  accountCount: number;
  entryCount: number;
}

export interface AccountBalanceRow {
  accountId: number;
  code: string;
  name: string;
  classNumber: number;
  nature: 'BALANCE_SHEET' | 'INCOME_STATEMENT';
  debit: number;
  credit: number;
  balance: number;
  balanceSide: 'debit' | 'credit' | 'zero';
}

export interface TrialBalanceReport {
  fiscalYear: { id: number; label: string; status: string };
  dateFrom: string;
  dateTo: string;
  rows: AccountBalanceRow[];
  totals: { debit: number; credit: number };
  balanceTotals?: { debit: number; credit: number };
  balanced?: boolean;
}

export interface BalanceSheetReport {
  fiscalYear: { id: number; label: string; status: string };
  dateFrom: string;
  dateTo: string;
  actif: AccountBalanceRow[];
  passif: AccountBalanceRow[];
  totalActif: number;
  totalPassif: number;
  balanced: boolean;
  resultatEnCours: number;
}

export interface IncomeStatementReport {
  fiscalYear: { id: number; label: string; status: string };
  dateFrom: string;
  dateTo: string;
  charges: AccountBalanceRow[];
  produits: AccountBalanceRow[];
  totalCharges: number;
  totalProduits: number;
  resultat: number;
  resultatLabel: string;
}

export interface GeneralLedgerReport {
  fiscalYear: { id: number; label: string; status: string };
  dateFrom: string;
  dateTo: string;
  account: { id: number; code: string; name: string; classNumber: number };
  movements: Array<{
    entryId: number;
    entryDate: string;
    journalCode: JournalCode;
    entryNumber: number;
    description: string;
    label?: string | null;
    debit: number;
    credit: number;
    balance: number;
  }>;
  closingBalance: number;
}

export interface AccountingBackfillResult {
  fiscalYear: { id: number; label: string; startDate: string; endDate: string };
  posted: {
    sales: number;
    creditSales: number;
    creditPayments: number;
    expenses: number;
    purchases: number;
    bankManual: number;
    supplierPayments: number;
    fixedAssets: number;
    depreciations: number;
  };
  skipped: {
    outsidePeriod: number;
    alreadyPosted: number;
    other: number;
  };
}

export interface SupplierPaymentRow {
  id: number;
  supplierName: string;
  amount: string | number;
  method: string;
  paidAt: string;
  note?: string | null;
  bankAccount?: {
    id: number;
    name: string;
    bank: { name: string };
  } | null;
  user?: { id: number; fullName: string | null; phone: string } | null;
}

export interface AccountingSuppliersOverview {
  suppliersPayable: number;
  supplierNames: string[];
  payments: SupplierPaymentRow[];
}

export interface FixedAssetRow {
  id: number;
  name: string;
  acquisitionDate: string;
  acquisitionCost: number;
  residualValue: number;
  usefulLifeMonths: number;
  accumulatedDepreciation: number;
  lastDepreciationPeriod: string | null;
  isActive: boolean;
  note: string | null;
  monthlyDepreciation: number;
  netBookValue: number;
  remainingDepreciable: number;
}
