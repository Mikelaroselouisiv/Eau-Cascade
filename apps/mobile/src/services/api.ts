import axios from 'axios';
import { resolveApiBaseUrl } from '../config/resolve-api-base-url';
import {
  REFRESH_TOKEN_KEY,
  TOKEN_KEY,
  USER_KEY,
  secureDelete,
  secureGet,
  secureSet,
} from './secure-store';
import type {
  AccountRow,
  AccountingBackfillResult,
  AccountingOverview,
  AccountingSuppliersOverview,
  AppRoleRow,
  AuditLogRow,
  BalanceSheetReport,
  BankRow,
  BankSummary,
  BankTransactionRow,
  CompanyListItem,
  CompanyProfile,
  CreateSalePayload,
  CreditCustomerDetail,
  CreditCustomerListItem,
  CreditSummary,
  DashboardBalanceSnapshot,
  DashboardSalesByProductRow,
  DashboardSummaryReport,
  Delivery,
  DeliveryStatus,
  Department,
  DepartmentPrinterSettings,
  FinanceEntry,
  FinanceLedgerRow,
  FiscalYearRow,
  FixedAssetRow,
  GeneralLedgerReport,
  GlobalStockSnapshot,
  InventoryCountSheet,
  InventorySessionDetail,
  InventorySessionKind,
  IncomeStatementReport,
  InventorySessionListItem,
  JournalEntryRow,
  LoginResponse,
  MarginAnalysisReport,
  PackagingUnit,
  PaginatedResult,
  PermissionDefinition,
  Product,
  ProductFamily,
  PurchaseOrderDetail,
  PurchaseOrderListItem,
  PurchaseOrdersAmountSummary,
  RegisterClosingCashPreview,
  RegisterInventoryLinePayload,
  RegisterListItem,
  RegisterSessionDetail,
  Sale,
  SaleCashGaps,
  SessionUser,
  StockMovementRow,
  TrialBalanceReport,
} from '../types/api';

const api = axios.create({ baseURL: resolveApiBaseUrl() });

// Cache mémoire synchrone — expo-secure-store est async, contrairement à localStorage
// côté desktop, donc l'intercepteur axios (qui doit rester synchrone) lit ce cache,
// rempli au démarrage par initAuthCache() et tenu à jour à chaque écriture.
let cachedToken: string | null = null;
let cachedRefreshToken: string | null = null;
let cachedUser: SessionUser | null = null;

export async function initAuthCache(): Promise<void> {
  const [token, refreshToken, userRaw] = await Promise.all([
    secureGet(TOKEN_KEY),
    secureGet(REFRESH_TOKEN_KEY),
    secureGet(USER_KEY),
  ]);
  cachedToken = token;
  cachedRefreshToken = refreshToken;
  cachedUser = userRaw ? (JSON.parse(userRaw) as SessionUser) : null;
}

api.interceptors.request.use((config) => {
  if (cachedToken) {
    config.headers.Authorization = `Bearer ${cachedToken}`;
  }
  return config;
});

let refreshPromise: Promise<string | null> | null = null;

/**
 * Une vente restée dans l'outbox peut être rejouée après expiration du jeton
 * d'accès. Rafraîchir la session puis rejouer la requête une seule fois.
 */
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error?.config as
      | (Record<string, unknown> & {
          _posRetried?: boolean;
          url?: string;
          headers?: Record<string, string>;
        })
      | undefined;
    const url = String(config?.url ?? '');
    const canRefresh =
      error?.response?.status === 401 &&
      config &&
      !config._posRetried &&
      !url.includes('/auth/login') &&
      !url.includes('/auth/refresh') &&
      Boolean(cachedRefreshToken);

    if (!canRefresh) return Promise.reject(error);

    config._posRetried = true;
    refreshPromise ??= refreshSession()
      .catch(() => null)
      .finally(() => {
        refreshPromise = null;
      });
    const token = await refreshPromise;
    if (!token) return Promise.reject(error);

    config.headers = { ...(config.headers ?? {}), Authorization: `Bearer ${token}` };
    return api.request(config);
  },
);

export async function login(phone: string, password: string): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/login', { phone, password });
  await writeToken(data.accessToken);
  await writeRefreshToken(data.refreshToken);
  await writeSessionUser(data.user);
  return data;
}

export async function getMe(): Promise<SessionUser> {
  const { data } = await api.get<SessionUser>('/auth/me');
  await writeSessionUser(data);
  return data;
}

export async function refreshSession(): Promise<string | null> {
  if (!cachedRefreshToken) return null;
  const { data } = await api.post<{ accessToken: string; refreshToken: string }>('/auth/refresh', {
    refreshToken: cachedRefreshToken,
  });
  await writeToken(data.accessToken);
  await writeRefreshToken(data.refreshToken);
  return data.accessToken;
}

export async function logout(): Promise<void> {
  if (cachedRefreshToken) {
    try {
      await api.post('/auth/logout', { refreshToken: cachedRefreshToken });
    } catch {
      /* ignore — meilleure tentative uniquement */
    }
  }
  await clearToken();
  await clearRefreshToken();
  await clearSessionUser();
}

export function getToken(): string | null {
  return cachedToken;
}

export function getSessionUser(): SessionUser | null {
  return cachedUser;
}

export async function writeSessionUser(user: SessionUser): Promise<void> {
  cachedUser = user;
  await secureSet(USER_KEY, JSON.stringify(user));
}

async function clearSessionUser() {
  cachedUser = null;
  await secureDelete(USER_KEY);
}

async function writeToken(token: string) {
  cachedToken = token;
  await secureSet(TOKEN_KEY, token);
}

async function clearToken() {
  cachedToken = null;
  await secureDelete(TOKEN_KEY);
}

async function writeRefreshToken(token: string) {
  cachedRefreshToken = token;
  await secureSet(REFRESH_TOKEN_KEY, token);
}

async function clearRefreshToken() {
  cachedRefreshToken = null;
  await secureDelete(REFRESH_TOKEN_KEY);
}

// --- Endpoints utilisés en Phase 1 (Caisse, Monitor, Imprimante) ---

export async function getProducts(
  departmentId?: number,
  opts?: { asOf?: string },
): Promise<Product[]> {
  const { data } = await api.get<Product[]>('/products', {
    params: {
      ...(departmentId !== undefined ? { departmentId } : {}),
      ...(opts?.asOf?.trim() ? { asOf: opts.asOf.trim() } : {}),
    },
  });
  return data;
}

export async function createProduct(payload: {
  name: string;
  cardColor?: string;
  companyId?: number;
  departmentId?: number;
  productFamilyId?: number | null;
  sku?: string;
  isService?: boolean;
  trackStock?: boolean;
  cost?: number;
  stockMin?: number;
  saleUnits: Array<{
    packagingUnitId: number;
    salePrice: number;
    labelOverride?: string;
    isDefault?: boolean;
  }>;
}): Promise<Product> {
  const { data } = await api.post<Product>('/products', payload);
  return data;
}

export async function updateProduct(
  id: number,
  payload: Partial<{
    name: string;
    cardColor: string | null;
    companyId: number;
    departmentId: number | null;
    productFamilyId: number | null;
    sku: string;
    isService: boolean;
    trackStock: boolean;
    cost: number;
    stock: number;
    stockMin: number;
    salePrice: number;
    packagingUnitId: number;
  }>,
): Promise<Product> {
  const { data } = await api.patch<Product>(`/products/${id}`, payload);
  return data;
}

export async function deleteProduct(id: number): Promise<void> {
  await api.delete(`/products/${id}`);
}

export async function getProductFamilies(companyId: number): Promise<ProductFamily[]> {
  const { data } = await api.get<ProductFamily[]>('/product-families', {
    params: { companyId },
  });
  return data;
}

export async function createProductFamily(payload: {
  companyId: number;
  name: string;
  tiers: { minQuantity: number; unitPrice: number }[];
  productIds?: number[];
}): Promise<ProductFamily> {
  const { data } = await api.post<ProductFamily>('/product-families', payload);
  return data;
}

export async function updateProductFamily(
  id: number,
  payload: {
    name?: string;
    tiers?: { minQuantity: number; unitPrice: number }[];
    productIds?: number[];
  },
): Promise<ProductFamily> {
  const { data } = await api.patch<ProductFamily>(`/product-families/${id}`, payload);
  return data;
}

export async function deleteProductFamily(id: number): Promise<void> {
  await api.delete(`/product-families/${id}`);
}

export async function getCompanies(): Promise<CompanyListItem[]> {
  const { data } = await api.get<CompanyListItem[]>('/companies');
  return data;
}

export type CompanyCreatePayload = {
  name: string;
  legalName?: string;
  address?: string;
  city?: string;
  country?: string;
  phone?: string;
  email?: string;
  taxId?: string;
  currency?: string;
  vatRatePercent?: number;
};

export async function createCompany(payload: CompanyCreatePayload): Promise<CompanyListItem> {
  const { data } = await api.post<CompanyListItem>('/companies', payload);
  return data;
}

export async function updateCompany(
  id: number,
  payload: Partial<CompanyCreatePayload>,
): Promise<CompanyProfile> {
  const { data } = await api.patch<CompanyProfile>(`/companies/${id}`, payload);
  return data;
}

export async function deleteCompany(id: number): Promise<void> {
  await api.delete(`/companies/${id}`);
}

export async function getDepartments(companyId?: number): Promise<Department[]> {
  const { data } = await api.get<Department[]>('/departments', {
    params: companyId !== undefined ? { companyId } : undefined,
  });
  return data;
}

export async function createDepartment(payload: {
  name: string;
  description?: string;
  companyId?: number;
}): Promise<Department> {
  const { data } = await api.post<Department>('/departments', payload);
  return data;
}

export async function updateDepartment(
  id: number,
  payload: { name?: string; description?: string },
): Promise<Department> {
  const { data } = await api.patch<Department>(`/departments/${id}`, payload);
  return data;
}

export async function deleteDepartment(id: number): Promise<void> {
  await api.delete(`/departments/${id}`);
}

export async function getPackagingUnits(departmentId: number): Promise<PackagingUnit[]> {
  const { data } = await api.get<PackagingUnit[]>('/packaging-units', {
    params: { departmentId },
  });
  return data;
}

export async function createPackagingUnit(payload: {
  departmentId: number;
  code: string;
  label: string;
  sortOrder?: number;
}): Promise<PackagingUnit> {
  const { data } = await api.post<PackagingUnit>('/packaging-units', payload);
  return data;
}

export async function updatePackagingUnit(
  id: number,
  payload: {
    departmentId?: number;
    code?: string;
    label?: string;
    sortOrder?: number;
  },
): Promise<PackagingUnit> {
  const { data } = await api.patch<PackagingUnit>(`/packaging-units/${id}`, payload);
  return data;
}

export async function deletePackagingUnit(id: number): Promise<void> {
  await api.delete(`/packaging-units/${id}`);
}

export async function getUsers(): Promise<SessionUser[]> {
  const { data } = await api.get<SessionUser[]>('/users');
  return data;
}

export async function createUser(payload: {
  phone: string;
  password: string;
  role: string;
  fullName?: string;
  email?: string;
  departmentId?: number;
  companyId?: number;
  isActive?: boolean;
}) {
  const { data } = await api.post('/users', payload);
  return data;
}

export async function updateUser(
  id: number,
  payload: Partial<{
    phone: string;
    email: string | null;
    password: string;
    role: string;
    fullName: string;
    departmentId: number | null;
    companyId: number | null;
    isActive: boolean;
  }>,
) {
  const { data } = await api.patch(`/users/${id}`, payload);
  return data;
}

export async function deleteUser(id: number): Promise<void> {
  await api.delete(`/users/${id}`);
}

export async function listRoles(): Promise<AppRoleRow[]> {
  const { data } = await api.get<AppRoleRow[]>('/roles');
  return data;
}

export async function listPermissions(): Promise<PermissionDefinition[]> {
  const { data } = await api.get<PermissionDefinition[]>('/roles/permissions');
  return data;
}

export async function createRole(payload: {
  code: string;
  label: string;
  description?: string;
  permissions: string[];
}): Promise<AppRoleRow> {
  const { data } = await api.post<AppRoleRow>('/roles', payload);
  return data;
}

export async function updateRole(
  id: number,
  payload: Partial<{
    label: string;
    description: string | null;
    permissions: string[];
    isActive: boolean;
  }>,
): Promise<AppRoleRow> {
  const { data } = await api.patch<AppRoleRow>(`/roles/${id}`, payload);
  return data;
}

export async function deleteRole(id: number): Promise<void> {
  await api.delete(`/roles/${id}`);
}

export async function createBank(payload: {
  companyId: number;
  name: string;
  note?: string;
}): Promise<BankRow> {
  const { data } = await api.post<BankRow>('/banks', payload);
  return data;
}

export async function updateBank(
  id: number,
  payload: { name?: string; note?: string | null; isActive?: boolean },
): Promise<BankRow> {
  const { data } = await api.patch<BankRow>(`/banks/${id}`, payload);
  return data;
}

export async function createBankAccount(payload: {
  bankId: number;
  name: string;
  accountNumber?: string;
  openingBalance?: number;
  note?: string;
}) {
  const { data } = await api.post('/banks/accounts', payload);
  return data;
}

export async function updateBankAccount(
  id: number,
  payload: {
    name?: string;
    accountNumber?: string | null;
    openingBalance?: number;
    note?: string | null;
    isActive?: boolean;
  },
) {
  const { data } = await api.patch(`/banks/accounts/${id}`, payload);
  return data;
}

export async function stockIn(payload: {
  productId: number;
  quantity: number;
  reason?: string;
}) {
  const { data } = await api.post('/inventory/entries', payload);
  return data;
}

export async function stockAdjust(payload: {
  productId: number;
  quantity: number;
  reason?: string;
}) {
  const { data } = await api.post('/inventory/adjustments', payload);
  return data;
}

export async function listPurchaseOrders(companyId?: number): Promise<PurchaseOrderListItem[]> {
  const { data } = await api.get<PurchaseOrderListItem[]>('/purchasing/orders', {
    params: companyId != null ? { companyId } : undefined,
  });
  return data;
}

export async function getPurchaseOrdersAmountSummary(
  companyId: number,
): Promise<PurchaseOrdersAmountSummary> {
  const { data } = await api.get<PurchaseOrdersAmountSummary>('/purchasing/orders-summary', {
    params: { companyId },
  });
  return data;
}

export async function getPurchaseOrder(id: number): Promise<PurchaseOrderDetail> {
  const { data } = await api.get<PurchaseOrderDetail>(`/purchasing/orders/${id}`);
  return data;
}

export async function createPurchaseOrder(payload: {
  companyId: number;
  departmentId: number;
  supplierName?: string;
  reference?: string;
  note?: string;
  lines: Array<{ productId: number; quantityOrdered: number; unitPriceEst?: number }>;
}) {
  const { data } = await api.post('/purchasing/orders', payload);
  return data;
}

export async function receivePurchaseOrder(
  purchaseOrderId: number,
  payload: {
    note?: string;
    lines: Array<{ productId: number; quantity: number; unitCost?: number }>;
  },
): Promise<PurchaseOrderDetail> {
  const { data } = await api.post<PurchaseOrderDetail>(
    `/purchasing/orders/${purchaseOrderId}/receive`,
    payload,
  );
  return data;
}

export async function deletePurchaseOrder(id: number): Promise<void> {
  await api.delete(`/purchasing/orders/${id}`);
}

export async function deleteGoodsReceipt(id: number): Promise<PurchaseOrderDetail> {
  const { data } = await api.delete<PurchaseOrderDetail>(`/purchasing/receipts/${id}`);
  return data;
}

export async function createSale(payload: CreateSalePayload): Promise<Sale> {
  const { data } = await api.post<Sale>('/sales', payload);
  return data;
}

export async function listSaleCashGaps(params: {
  companyId: number;
  departmentId?: number;
  take?: number;
}): Promise<SaleCashGaps> {
  const { data } = await api.get<SaleCashGaps>('/sales/cash-gaps', {
    params: {
      companyId: params.companyId,
      departmentId: params.departmentId,
      take: params.take ?? 40,
    },
  });
  return data;
}

export async function settleSaleChange(saleId: number) {
  const { data } = await api.post<{
    id: number;
    changeSettled: number;
    changeDue: number;
    balanceDue: number;
  }>(`/sales/${saleId}/settle-change`);
  return data;
}

export async function collectSaleBalance(saleId: number, amount: number) {
  const { data } = await api.post<{
    id: number;
    amountCollected: number;
    amountPaid: number;
    balanceDue: number;
    changeDue: number;
  }>(`/sales/${saleId}/collect-balance`, { amount });
  return data;
}

export async function listSales(params: {
  companyId: number;
  skip?: number;
  take?: number;
  createdFrom?: string;
  createdTo?: string;
  departmentId?: number;
}): Promise<PaginatedResult<Sale>> {
  const { data } = await api.get<PaginatedResult<Sale>>('/sales', {
    params: {
      companyId: params.companyId,
      skip: params.skip ?? 0,
      take: params.take ?? 10,
      createdFrom: params.createdFrom,
      createdTo: params.createdTo,
      departmentId: params.departmentId,
    },
  });
  return data;
}

export async function getSaleById(id: number): Promise<Sale> {
  const { data } = await api.get<Sale>(`/sales/${id}`);
  return data;
}

export async function cancelSale(id: number): Promise<Sale> {
  const { data } = await api.patch<Sale>(`/sales/${id}/cancel`);
  return data;
}

export async function refundSale(id: number): Promise<Sale> {
  const { data } = await api.patch<Sale>(`/sales/${id}/refund`);
  return data;
}

export async function deleteSalePermanently(id: number, companyId: number): Promise<void> {
  await api.delete(`/sales/${id}`, { params: { companyId } });
}

export async function getInventoryAlerts(params?: {
  threshold?: number;
  companyId?: number;
  skip?: number;
  take?: number;
}): Promise<PaginatedResult<Product>> {
  const { data } = await api.get<PaginatedResult<Product>>('/inventory/alerts', {
    params: {
      threshold: params?.threshold ?? 5,
      companyId: params?.companyId,
      skip: params?.skip ?? 0,
      take: params?.take ?? 10,
    },
  });
  return data;
}

export async function getDashboardSummary(params?: {
  companyId?: number;
}): Promise<DashboardSummaryReport> {
  const { data } = await api.get<DashboardSummaryReport>('/reports/dashboard-summary', {
    params: { companyId: params?.companyId },
  });
  return data;
}

export async function getCompany(): Promise<CompanyProfile | null> {
  const { data } = await api.get<CompanyProfile | null>('/company');
  return data;
}

export async function getPrinterSettings(
  departmentId?: number,
): Promise<DepartmentPrinterSettings | null> {
  const { data } = await api.get<DepartmentPrinterSettings | null>('/company/printer', {
    params: departmentId != null ? { departmentId } : undefined,
  });
  return data;
}

// --- Caisse / sessions de registre ---

export async function getInventoryCountSheet(
  departmentId: number,
  options?: { asOf?: string; onlyPositiveStock?: boolean },
): Promise<InventoryCountSheet> {
  const { data } = await api.get<InventoryCountSheet>('/inventory/count-sheet', {
    params: {
      departmentId,
      asOf: options?.asOf,
      onlyPositiveStock: options?.onlyPositiveStock || undefined,
    },
  });
  return data;
}

export async function createInventorySession(payload: {
  departmentId: number;
  kind?: InventorySessionKind;
  label?: string;
  note?: string;
  onlyPositiveStock?: boolean;
}): Promise<InventorySessionDetail> {
  const { data } = await api.post<InventorySessionDetail>('/inventory/sessions', payload);
  return data;
}

export async function listInventorySessions(params?: {
  departmentId?: number;
  companyId?: number;
}): Promise<InventorySessionListItem[]> {
  const { data } = await api.get<InventorySessionListItem[]>('/inventory/sessions', { params });
  return data;
}

export async function getInventorySession(id: number): Promise<InventorySessionDetail> {
  const { data } = await api.get<InventorySessionDetail>(`/inventory/sessions/${id}`);
  return data;
}

export async function patchInventoryLine(
  sessionId: number,
  lineId: number,
  payload: { countedQty?: number | null; note?: string },
): Promise<InventorySessionDetail> {
  const { data } = await api.patch<InventorySessionDetail>(
    `/inventory/sessions/${sessionId}/lines/${lineId}`,
    payload,
  );
  return data;
}

export async function completeInventorySession(id: number): Promise<InventorySessionDetail> {
  const { data } = await api.post<InventorySessionDetail>(`/inventory/sessions/${id}/complete`);
  return data;
}

export async function cancelInventorySession(id: number): Promise<InventorySessionDetail> {
  const { data } = await api.post<InventorySessionDetail>(`/inventory/sessions/${id}/cancel`);
  return data;
}

export async function getGlobalStockSnapshot(params?: {
  companyIds?: number[];
  departmentIds?: number[];
  asOf?: string;
}): Promise<GlobalStockSnapshot> {
  const { data } = await api.get<GlobalStockSnapshot>('/inventory/global-snapshot', {
    params: {
      companyIds: params?.companyIds?.length ? params.companyIds.join(',') : undefined,
      departmentIds: params?.departmentIds?.length ? params.departmentIds.join(',') : undefined,
      asOf: params?.asOf?.trim() || undefined,
    },
  });
  return data;
}

export async function listRegisters(params?: {
  companyId?: number;
  departmentId?: number;
}): Promise<RegisterListItem[]> {
  const { data } = await api.get<RegisterListItem[]>('/register-sessions/registers', {
    params: {
      companyId: params?.companyId,
      departmentId: params?.departmentId,
    },
  });
  return data;
}

export async function ensureDefaultRegister(companyId: number): Promise<RegisterListItem> {
  const { data } = await api.post<RegisterListItem>(
    `/register-sessions/registers/ensure-default?companyId=${companyId}`,
  );
  return data;
}

export async function getActiveRegisterSession(): Promise<RegisterSessionDetail | null> {
  const { data } = await api.get<RegisterSessionDetail | null>('/register-sessions/active');
  return data;
}

export async function listRegisterSessions(params?: {
  companyId?: number;
  departmentId?: number;
  registerId?: number;
  openedById?: number;
  status?: 'OPEN' | 'CLOSED';
  dateFrom?: string;
  dateTo?: string;
  sortBy?: 'openedAt' | 'userName';
  sortDir?: 'asc' | 'desc';
  take?: number;
}): Promise<RegisterSessionDetail[]> {
  const { data } = await api.get<RegisterSessionDetail[]>('/register-sessions', { params });
  return data;
}

export async function openRegisterSession(payload: {
  registerId: number;
  departmentId: number;
  openingCashAmount?: number;
  lines: RegisterInventoryLinePayload[];
}): Promise<RegisterSessionDetail> {
  const { data } = await api.post<RegisterSessionDetail>('/register-sessions/open', payload);
  return data;
}

export async function closeRegisterSession(
  sessionId: number,
  payload: {
    closingCashExpected: number;
    closingCashCounted: number;
    lines: RegisterInventoryLinePayload[];
  },
): Promise<RegisterSessionDetail> {
  const { data } = await api.post<RegisterSessionDetail>(
    `/register-sessions/${sessionId}/close`,
    payload,
  );
  return data;
}

export async function getRegisterClosingCashPreview(
  sessionId: number,
): Promise<RegisterClosingCashPreview> {
  const { data } = await api.get<RegisterClosingCashPreview>(
    `/register-sessions/${sessionId}/closing-cash-preview`,
  );
  return data;
}

export async function listAuditLogs(params?: {
  skip?: number;
  take?: number;
  entity?: string;
  action?: string;
  userId?: number;
  departmentId?: number;
  companyId?: number;
  dateFrom?: string;
  dateTo?: string;
}): Promise<{ items: AuditLogRow[]; total: number }> {
  const { data } = await api.get<{ items: AuditLogRow[]; total: number }>('/audit', {
    params,
  });
  return data;
}

// --- Moniteur / rapports ---

export async function getDashboardSummaryRange(params: {
  companyId?: number;
  dateFrom: string;
  dateTo: string;
  departmentId?: number;
}): Promise<DashboardBalanceSnapshot> {
  const { data } = await api.get<DashboardBalanceSnapshot>('/reports/dashboard-summary-range', {
    params: {
      companyId: params.companyId,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      departmentId: params.departmentId,
    },
  });
  return data;
}

export async function getDashboardSalesByProduct(params: {
  companyId?: number;
  period?: 'day' | 'week' | 'month';
  dateFrom?: string;
  dateTo?: string;
  departmentId?: number;
}): Promise<DashboardSalesByProductRow[]> {
  const base =
    params.dateFrom && params.dateTo
      ? { companyId: params.companyId, dateFrom: params.dateFrom, dateTo: params.dateTo }
      : { companyId: params.companyId, period: params.period ?? 'month' };
  const { data } = await api.get<DashboardSalesByProductRow[]>(
    '/reports/dashboard-sales-by-product',
    {
      params: {
        ...base,
        ...(params.departmentId != null && params.departmentId > 0
          ? { departmentId: params.departmentId }
          : {}),
      },
    },
  );
  return data;
}

export async function getZeroStockAlerts(params?: {
  companyId?: number;
  skip?: number;
  take?: number;
}): Promise<PaginatedResult<Product>> {
  const { data } = await api.get<PaginatedResult<Product>>('/inventory/alerts/zero', {
    params: {
      companyId: params?.companyId,
      skip: params?.skip ?? 0,
      take: params?.take ?? 10,
    },
  });
  return data;
}

export async function getInventoryMovements(params?: {
  companyId?: number;
  skip?: number;
  take?: number;
  order?: 'asc' | 'desc';
  dateFrom?: string;
  dateTo?: string;
}): Promise<PaginatedResult<StockMovementRow>> {
  const { data } = await api.get<PaginatedResult<StockMovementRow>>('/inventory/movements', {
    params: {
      companyId: params?.companyId,
      skip: params?.skip ?? 0,
      take: params?.take ?? 30,
      order: params?.order ?? 'desc',
      dateFrom: params?.dateFrom,
      dateTo: params?.dateTo,
    },
  });
  return data;
}

export async function getFinanceLedger(params: {
  companyId: number;
  dateFrom: string;
  dateTo: string;
  nature?: 'all' | 'purchase' | 'sale' | 'expense';
  skip?: number;
  take?: number;
}): Promise<{ items: FinanceLedgerRow[]; total: number }> {
  const { data } = await api.get<{ items: FinanceLedgerRow[]; total: number }>('/finance/ledger', {
    params: {
      companyId: params.companyId,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      nature: params.nature ?? 'all',
      skip: params.skip,
      take: params.take ?? 40,
    },
  });
  return data;
}

export async function createFinanceEntry(payload: {
  type: 'INCOME' | 'EXPENSE';
  amount: number;
  description: string;
  detail?: string;
  companyId?: number;
  entryDate?: string;
}): Promise<FinanceEntry> {
  const { data } = await api.post<FinanceEntry>('/finance/entries', payload);
  return data;
}

export async function deleteFinanceLedgerRow(params: {
  ledgerRowId: string;
  companyId: number;
}): Promise<void> {
  await api.delete(`/finance/ledger/${encodeURIComponent(params.ledgerRowId)}`, {
    params: { companyId: params.companyId },
  });
}

export async function getBankSummary(companyId: number): Promise<BankSummary> {
  const { data } = await api.get<BankSummary>('/banks/summary', { params: { companyId } });
  return data;
}

export async function listBanks(params: {
  companyId: number;
  includeInactive?: boolean;
}): Promise<BankRow[]> {
  const { data } = await api.get<BankRow[]>('/banks', {
    params: {
      companyId: params.companyId,
      includeInactive: params.includeInactive ? '1' : undefined,
    },
  });
  return data;
}

export async function listBankTransactions(params: {
  companyId: number;
  bankAccountId?: number;
  skip?: number;
  take?: number;
}): Promise<{ total: number; items: BankTransactionRow[] }> {
  const { data } = await api.get<{ total: number; items: BankTransactionRow[] }>(
    '/banks/transactions',
    { params },
  );
  return data;
}

export async function createBankTransaction(payload: {
  bankAccountId: number;
  type: 'DEPOSIT' | 'WITHDRAWAL';
  amount: number;
  description: string;
  reference?: string;
  occurredOn?: string;
}): Promise<{ transaction: BankTransactionRow; accountBalance: number }> {
  const { data } = await api.post<{ transaction: BankTransactionRow; accountBalance: number }>(
    '/banks/transactions',
    payload,
  );
  return data;
}

export async function getMarginAnalysis(params: {
  companyId?: number;
  dateFrom: string;
  dateTo: string;
  departmentId?: number;
}): Promise<MarginAnalysisReport> {
  const { data } = await api.get<MarginAnalysisReport>('/reports/margin', {
    params: {
      companyId: params.companyId,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      departmentId: params.departmentId,
    },
  });
  return data;
}

// --- Livraisons ---

export async function listDeliveries(params?: {
  companyId?: number;
  departmentId?: number;
  status?: DeliveryStatus | string;
  q?: string;
  skip?: number;
  take?: number;
}): Promise<{ items: Delivery[]; total: number; skip: number; take: number }> {
  const { data } = await api.get<{
    items: Delivery[];
    total: number;
    skip: number;
    take: number;
  }>('/deliveries', {
    params: {
      companyId: params?.companyId,
      departmentId: params?.departmentId,
      status: params?.status,
      q: params?.q || undefined,
      skip: params?.skip,
      take: params?.take,
    },
  });
  return data;
}

export async function getDeliveryById(id: number): Promise<Delivery> {
  const { data } = await api.get<Delivery>(`/deliveries/${id}`);
  return data;
}

export async function updateDelivery(
  id: number,
  payload: {
    items?: Array<{ saleItemId: number; quantityDelivered: number }>;
    markDelivered?: boolean;
    note?: string | null;
  },
): Promise<Delivery> {
  const { data } = await api.patch<Delivery>(`/deliveries/${id}`, payload);
  return data;
}

// --- Crédit clients ---

export async function getCreditSummary(companyId: number): Promise<CreditSummary> {
  const { data } = await api.get<CreditSummary>('/credit/summary', {
    params: { companyId },
  });
  return data;
}

export async function listCreditCustomers(params: {
  companyId: number;
  q?: string;
  includeInactive?: boolean;
}): Promise<CreditCustomerListItem[]> {
  const { data } = await api.get<CreditCustomerListItem[]>('/credit/customers', {
    params: {
      companyId: params.companyId,
      q: params.q || undefined,
      includeInactive: params.includeInactive ? '1' : undefined,
    },
  });
  return data;
}

export async function getCreditCustomer(id: number): Promise<CreditCustomerDetail> {
  const { data } = await api.get<CreditCustomerDetail>(`/credit/customers/${id}`);
  return data;
}

export async function createCreditSale(payload: {
  creditCustomerId: number;
  items: { productSaleUnitId: number; quantity: number }[];
  downPayment?: number;
  downPaymentMethod?: 'CASH' | 'CARD' | 'MOBILE_MONEY';
  note?: string;
}): Promise<{
  saleId: number;
  txnNumber?: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  deliveryId: number;
}> {
  const { data } = await api.post('/credit/sales', payload);
  return data;
}

export async function recordCreditPayment(payload: {
  creditCustomerId: number;
  amount: number;
  saleId?: number;
  method?: 'CASH' | 'CARD' | 'MOBILE_MONEY' | 'BANK';
  bankAccountId?: number;
  reference?: string;
  note?: string;
}): Promise<{
  payment: { id: number; amount: number };
  applied: number;
  unused: number;
  financeEntryId?: number;
}> {
  const { data } = await api.post('/credit/payments', payload);
  return data;
}

export async function getAccountingOverview(companyId: number): Promise<AccountingOverview> {
  const { data } = await api.get<AccountingOverview>('/accounting/overview', {
    params: { companyId },
  });
  return data;
}

export async function getAccountingAccounts(companyId: number): Promise<AccountRow[]> {
  const { data } = await api.get<AccountRow[]>('/accounting/accounts', {
    params: { companyId },
  });
  return data;
}

export async function getAccountingJournal(params: {
  companyId: number;
  fiscalYearId?: number;
  dateFrom?: string;
  dateTo?: string;
  journalCode?: string;
  skip?: number;
  take?: number;
}): Promise<{
  items: JournalEntryRow[];
  total: number;
  fiscalYear: FiscalYearRow | null;
}> {
  const { data } = await api.get<{
    items: JournalEntryRow[];
    total: number;
    fiscalYear: FiscalYearRow | null;
  }>('/accounting/journal', { params });
  return data;
}

export async function createManualJournalEntry(payload: {
  companyId: number;
  entryDate: string;
  journalCode?: string;
  description: string;
  reference?: string;
  lines: Array<{ accountCode: string; debit?: number; credit?: number; label?: string }>;
}): Promise<JournalEntryRow> {
  const { data } = await api.post<JournalEntryRow>('/accounting/journal', payload);
  return data;
}

export async function getTrialBalance(params: {
  companyId: number;
  fiscalYearId?: number;
  dateFrom?: string;
  dateTo?: string;
}): Promise<TrialBalanceReport> {
  const { data } = await api.get<TrialBalanceReport>('/accounting/trial-balance', { params });
  return data;
}

export async function getBalanceSheet(params: {
  companyId: number;
  fiscalYearId?: number;
  dateTo?: string;
}): Promise<BalanceSheetReport> {
  const { data } = await api.get<BalanceSheetReport>('/accounting/balance-sheet', { params });
  return data;
}

export async function getIncomeStatement(params: {
  companyId: number;
  fiscalYearId?: number;
  dateFrom?: string;
  dateTo?: string;
}): Promise<IncomeStatementReport> {
  const { data } = await api.get<IncomeStatementReport>('/accounting/income-statement', {
    params,
  });
  return data;
}

export async function getGeneralLedger(params: {
  companyId: number;
  accountId?: number;
  accountCode?: string;
  fiscalYearId?: number;
  dateFrom?: string;
  dateTo?: string;
}): Promise<GeneralLedgerReport> {
  const { data } = await api.get<GeneralLedgerReport>('/accounting/general-ledger', { params });
  return data;
}

export async function ensureAccountingChart(companyId: number): Promise<AccountRow[]> {
  const { data } = await api.post<AccountRow[]>('/accounting/accounts/ensure', { companyId });
  return data;
}

export async function createFiscalYear(payload: {
  companyId: number;
  label: string;
  startDate: string;
  endDate: string;
}): Promise<FiscalYearRow> {
  const { data } = await api.post<FiscalYearRow>('/accounting/fiscal-years', payload);
  return data;
}

export async function closeFiscalYear(id: number): Promise<{
  fiscalYear: FiscalYearRow;
  resultat: number;
}> {
  const { data } = await api.post<{ fiscalYear: FiscalYearRow; resultat: number }>(
    `/accounting/fiscal-years/${id}/close`,
  );
  return data;
}

export async function backfillAccounting(companyId: number): Promise<AccountingBackfillResult> {
  const { data } = await api.post<AccountingBackfillResult>('/accounting/backfill', { companyId });
  return data;
}

export async function getAccountingSuppliers(
  companyId: number,
): Promise<AccountingSuppliersOverview> {
  const { data } = await api.get<AccountingSuppliersOverview>('/accounting/suppliers', {
    params: { companyId },
  });
  return data;
}

export async function createSupplierPayment(payload: {
  companyId: number;
  supplierName: string;
  amount: number;
  method?: 'CASH' | 'BANK';
  bankAccountId?: number;
  paidOn?: string;
  note?: string;
}): Promise<unknown> {
  const { data } = await api.post('/accounting/suppliers/payments', payload);
  return data;
}

export async function getFixedAssets(companyId: number): Promise<FixedAssetRow[]> {
  const { data } = await api.get<FixedAssetRow[]>('/accounting/fixed-assets', {
    params: { companyId },
  });
  return data;
}

export async function createFixedAsset(payload: {
  companyId: number;
  name: string;
  acquisitionDate: string;
  acquisitionCost: number;
  residualValue?: number;
  usefulLifeMonths: number;
  paidFrom?: 'CASH' | 'BANK' | 'SUPPLIER';
  bankAccountId?: number;
  note?: string;
}): Promise<FixedAssetRow> {
  const { data } = await api.post<FixedAssetRow>('/accounting/fixed-assets', payload);
  return data;
}

export async function runDepreciation(payload: {
  companyId: number;
  period: string;
  fixedAssetId?: number;
}): Promise<{
  period: string;
  results: Array<{
    assetId: number;
    name: string;
    amount: number;
    status: 'posted' | 'skipped' | 'fully_depreciated';
  }>;
}> {
  const { data } = await api.post('/accounting/fixed-assets/depreciate', payload);
  return data;
}
