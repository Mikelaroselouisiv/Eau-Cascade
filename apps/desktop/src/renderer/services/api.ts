import axios from 'axios';
import type {
  CompanyListItem,
  CompanyProfile,
  CreateSalePayload,
  CreditCustomerDetail,
  CreditCustomerListItem,
  CreditSummary,
  BankRow,
  BankSummary,
  BankTransactionRow,
  MarginAnalysisReport,
  Delivery,
  DashboardBalanceSnapshot,
  DashboardSalesByProductRow,
  DashboardSummaryReport,
  Department,
  FinanceEntry,
  FinanceLedgerRow,
  LoginResponse,
  PackagingUnit,
  DepartmentPrinterSettings,
  Product,
  ProductFamily,
  RevenueReport,
  Sale,
  SessionUser,
  AppRoleRow,
  PermissionDefinition,
  AuditLogRow,
  StockMovementRow,
  InventorySessionDetail,
  InventorySessionListItem,
  InventoryCountSheet,
  RegisterListItem,
  RegisterSessionDetail,
  RegisterInventoryLinePayload,
  GlobalStockSnapshot,
  GoodsReceiptListItem,
  ProductRecipeDetail,
  PurchaseOrderListItem,
  PurchaseOrderDetail,
  PurchaseOrdersAmountSummary,
} from '../types/api';
import { resolveApiBaseUrl } from '../config/resolve-api-base-url';

const TOKEN_KEY = 'pos_token';
const REFRESH_TOKEN_KEY = 'pos_refresh_token';
const USER_KEY = 'pos_user';

const api = axios.create();
let apiBaseUrl = '';
let apiInitPromise: Promise<string> | null = null;

/** Résout l’URL selon l’édition (server / remote) avant le premier appel API. */
export function initApi(): Promise<string> {
  if (apiBaseUrl) return Promise.resolve(apiBaseUrl);
  if (!apiInitPromise) {
    apiInitPromise = resolveApiBaseUrl().then((url) => {
      apiBaseUrl = url;
      api.defaults.baseURL = url;
      return url;
    });
  }
  return apiInitPromise;
}

export function getApiBaseUrl(): string {
  return apiBaseUrl;
}

api.interceptors.request.use((config) => {
  const token = readToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
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
      !url.includes('/auth/register') &&
      !url.includes('/auth/refresh') &&
      Boolean(readRefreshToken());

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
  writeToken(data.accessToken);
  writeRefreshToken(data.refreshToken);
  writeSessionUser(data.user);
  return data;
}

export async function getAuthSetupStatus(): Promise<{ needsFirstUser: boolean }> {
  const { data } = await api.get<{ needsFirstUser: boolean }>('/auth/setup-status');
  return data;
}

export async function registerFirstAdmin(payload: {
  phone: string;
  password: string;
  email?: string;
  fullName?: string;
}): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/register', payload);
  writeToken(data.accessToken);
  writeRefreshToken(data.refreshToken);
  writeSessionUser(data.user);
  return data;
}

export async function getMe(): Promise<SessionUser> {
  const { data } = await api.get<SessionUser>('/auth/me');
  writeSessionUser(data);
  return data;
}

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
  barcode?: string;
  isService?: boolean;
  trackStock?: boolean;
  cost?: number;
  stockMin?: number;
  saleUnits: Array<{
    packagingUnitId: number;
    salePrice: number;
    labelOverride?: string;
    isDefault?: boolean;
    volumePrices?: Array<{ minQuantity: number; unitPrice: number }>;
  }>;
}) {
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
    barcode: string;
    description: string;
    isService: boolean;
    trackStock: boolean;
    cost: number;
    stock: number;
    stockMin: number;
    salePrice: number;
    volumePrices: Array<{ minQuantity: number; unitPrice: number }>;
    packagingUnitId: number;
    labelOverride: string | null;
  }>,
) {
  const { data } = await api.patch<Product>(`/products/${id}`, payload);
  return data;
}

export async function deleteProduct(id: number) {
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
  tiers: Array<{ minQuantity: number; unitPrice: number }>;
  productIds?: number[];
}): Promise<ProductFamily> {
  const { data } = await api.post<ProductFamily>('/product-families', payload);
  return data;
}

export async function updateProductFamily(
  id: number,
  payload: {
    name?: string;
    tiers?: Array<{ minQuantity: number; unitPrice: number }>;
    productIds?: number[];
  },
): Promise<ProductFamily> {
  const { data } = await api.patch<ProductFamily>(`/product-families/${id}`, payload);
  return data;
}

export async function deleteProductFamily(id: number): Promise<void> {
  await api.delete(`/product-families/${id}`);
}

export async function getCompany(): Promise<CompanyProfile | null> {
  const { data } = await api.get<CompanyProfile | null>('/company');
  return data;
}

export async function patchCompany(payload: Partial<CompanyProfile>) {
  const { data } = await api.patch<CompanyProfile>('/company', payload);
  return data;
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

export async function createCompany(payload: CompanyCreatePayload) {
  const { data } = await api.post<CompanyListItem>('/companies', payload);
  return data;
}

export async function getCompanyById(id: number): Promise<CompanyProfile> {
  const { data } = await api.get<CompanyProfile>(`/companies/${id}`);
  return data;
}

export async function updateCompany(id: number, payload: Partial<CompanyCreatePayload>) {
  const { data } = await api.patch<CompanyProfile>(`/companies/${id}`, payload);
  return data;
}

export async function deleteCompany(id: number) {
  await api.delete(`/companies/${id}`);
}

export async function getPrinterSettings(
  departmentId?: number,
): Promise<DepartmentPrinterSettings | null> {
  const { data } = await api.get<DepartmentPrinterSettings | null>('/company/printer', {
    params: departmentId != null ? { departmentId } : undefined,
  });
  return data;
}

export async function patchPrinterSettings(
  payload: Partial<DepartmentPrinterSettings> & { departmentId: number },
) {
  const { data } = await api.patch<DepartmentPrinterSettings>('/company/printer', payload);
  return data;
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
}) {
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
) {
  const { data } = await api.patch<PackagingUnit>(`/packaging-units/${id}`, payload);
  return data;
}

export async function deletePackagingUnit(id: number) {
  const { data } = await api.delete(`/packaging-units/${id}`);
  return data;
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
}) {
  const { data } = await api.post<Department>('/departments', payload);
  return data;
}

export async function updateDepartment(id: number, payload: { name?: string; description?: string }) {
  const { data } = await api.patch<Department>(`/departments/${id}`, payload);
  return data;
}

export async function deleteDepartment(id: number) {
  const { data } = await api.delete(`/departments/${id}`);
  return data;
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

export async function deleteUser(id: number) {
  const { data } = await api.delete(`/users/${id}`);
  return data;
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
}) {
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
) {
  const { data } = await api.patch<AppRoleRow>(`/roles/${id}`, payload);
  return data;
}

export async function deleteRole(id: number) {
  const { data } = await api.delete<AppRoleRow>(`/roles/${id}`);
  return data;
}

export async function createSale(payload: CreateSalePayload) {
  const { data } = await api.post('/sales', payload);
  return data;
}

export async function listSaleCashGaps(params: {
  companyId: number;
  departmentId?: number;
  take?: number;
}) {
  const { data } = await api.get<import('../types/api').SaleCashGaps>('/sales/cash-gaps', {
    params: {
      companyId: params.companyId,
      departmentId: params.departmentId,
      take: params.take,
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

export async function listDeliveries(params?: {
  companyId?: number;
  departmentId?: number;
  status?: string;
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

export async function getSalesHistory(): Promise<Sale[]> {
  const { data } = await api.get<Sale[]>('/sales');
  return data;
}

export async function listSales(params: {
  companyId: number;
  skip?: number;
  take?: number;
  /** ISO 8601 (ex. depuis datetime-local converti). */
  createdFrom?: string;
  createdTo?: string;
  departmentId?: number;
}) {
  const { data } = await api.get<{ items: Sale[]; total: number }>('/sales', {
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

/** Annulation (ADMIN / MANAGER) — rétablit le stock déjà livré. */
export async function cancelSale(saleId: number): Promise<Sale> {
  const { data } = await api.patch<Sale>(`/sales/${saleId}/cancel`);
  return data;
}

/** Remboursement (ADMIN / MANAGER) — rétablit le stock déjà livré. */
export async function refundSale(saleId: number): Promise<Sale> {
  const { data } = await api.patch<Sale>(`/sales/${saleId}/refund`);
  return data;
}

/** Suppression définitive (API réservée au rôle ADMIN). */
export async function deleteSalePermanently(saleId: number, companyId: number): Promise<void> {
  await api.delete(`/sales/${saleId}`, {
    params: { companyId },
  });
}

/** Même mécanisme que `exportInventorySessionsPdf` : PDF généré côté API (pdfkit), blob en réponse. */
export async function exportSalePdf(id: number): Promise<Blob> {
  const { data } = await api.get<Blob>(`/sales/${id}/export/pdf`, {
    responseType: 'blob',
  });
  return data;
}

export async function getInventoryAlerts(params?: {
  threshold?: number;
  companyId?: number;
  skip?: number;
  take?: number;
}) {
  const threshold = params?.threshold ?? 5;
  const companyId = params?.companyId;
  const skip = params?.skip ?? 0;
  const take = params?.take ?? 10;
  const { data } = await api.get<{ items: Product[]; total: number }>(
    `/inventory/alerts?threshold=${encodeURIComponent(String(threshold))}${companyId ? `&companyId=${companyId}` : ''}&skip=${skip}&take=${take}`,
  );
  return data;
}

export async function getZeroStockAlerts(params?: {
  companyId?: number;
  skip?: number;
  take?: number;
}) {
  const companyId = params?.companyId;
  const skip = params?.skip ?? 0;
  const take = params?.take ?? 8;
  const q = new URLSearchParams();
  if (companyId) q.set('companyId', String(companyId));
  q.set('skip', String(skip));
  q.set('take', String(take));
  const { data } = await api.get<{ items: Product[]; total: number }>(`/inventory/alerts/zero?${q}`);
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
    params: {
      skip: params?.skip ?? 0,
      take: params?.take ?? 50,
      entity: params?.entity,
      action: params?.action,
      userId: params?.userId,
      departmentId: params?.departmentId,
      companyId: params?.companyId,
      dateFrom: params?.dateFrom,
      dateTo: params?.dateTo,
    },
  });
  return data;
}

export async function getInventoryMovements(params?: {
  skip?: number;
  take?: number;
  companyId?: number;
  /** Tri par date côté serveur : plus récent d'abord (desc) ou plus ancien d'abord (asc). */
  order?: 'asc' | 'desc';
  dateFrom?: string;
  dateTo?: string;
}): Promise<{ items: StockMovementRow[]; total: number }> {
  const { data } = await api.get<{ items: StockMovementRow[]; total: number }>('/inventory/movements', {
    params: {
      skip: params?.skip ?? 0,
      take: params?.take ?? 100,
      companyId: params?.companyId ?? undefined,
      order: params?.order ?? 'desc',
      dateFrom: params?.dateFrom?.trim() || undefined,
      dateTo: params?.dateTo?.trim() || undefined,
    },
  });
  return data;
}

export async function stockIn(payload: { productId: number; quantity: number; reason?: string }) {
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

export async function createInventorySession(payload: {
  departmentId: number;
  kind?: 'OPENING' | 'CLOSING' | 'AD_HOC';
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
  const { data } = await api.get<InventorySessionListItem[]>('/inventory/sessions', {
    params: {
      departmentId: params?.departmentId ?? undefined,
      companyId: params?.companyId ?? undefined,
    },
  });
  return data;
}

export async function getInventoryCountSheet(
  departmentId: number,
  opts?: { asOf?: string; onlyPositiveStock?: boolean },
): Promise<InventoryCountSheet> {
  const { data } = await api.get<InventoryCountSheet>('/inventory/count-sheet', {
    params: {
      departmentId,
      ...(opts?.asOf?.trim() ? { asOf: opts.asOf.trim() } : {}),
      ...(opts?.onlyPositiveStock ? { onlyPositiveStock: true } : {}),
    },
  });
  return data;
}

export async function exportInventoryCountSheetPdf(
  departmentId: number,
  opts?: { asOf?: string; onlyPositiveStock?: boolean },
): Promise<Blob> {
  const { data } = await api.get<Blob>('/inventory/count-sheet/export/pdf', {
    params: {
      departmentId,
      ...(opts?.asOf?.trim() ? { asOf: opts.asOf.trim() } : {}),
      ...(opts?.onlyPositiveStock ? { onlyPositiveStock: true } : {}),
    },
    responseType: 'blob',
  });
  return data;
}

export async function exportInventorySessionsPdf(params?: {
  departmentId?: number;
  companyId?: number;
  take?: number;
}): Promise<Blob> {
  const { data } = await api.get<Blob>('/inventory/sessions/export/pdf', {
    params: {
      departmentId: params?.departmentId ?? undefined,
      companyId: params?.companyId ?? undefined,
      take: params?.take ?? undefined,
    },
    responseType: 'blob',
  });
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
) {
  const { data } = await api.patch(`/inventory/sessions/${sessionId}/lines/${lineId}`, payload);
  return data;
}

export async function completeInventorySession(id: number) {
  const { data } = await api.post<InventorySessionDetail>(`/inventory/sessions/${id}/complete`);
  return data;
}

export async function cancelInventorySession(id: number) {
  const { data } = await api.post(`/inventory/sessions/${id}/cancel`);
  return data;
}

export async function listRegisters(params?: {
  companyId?: number;
  departmentId?: number;
}): Promise<RegisterListItem[]> {
  const { data } = await api.get<RegisterListItem[]>('/register-sessions/registers', {
    params: {
      companyId: params?.companyId ?? undefined,
      departmentId: params?.departmentId ?? undefined,
    },
  });
  return data;
}

export async function createRegister(payload: {
  companyId: number;
  departmentId: number;
  code: string;
}): Promise<RegisterListItem> {
  const { data } = await api.post<RegisterListItem>('/register-sessions/registers', payload);
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
  const { data } = await api.get<RegisterSessionDetail[]>('/register-sessions', {
    params: {
      companyId: params?.companyId ?? undefined,
      departmentId: params?.departmentId ?? undefined,
      registerId: params?.registerId ?? undefined,
      openedById: params?.openedById ?? undefined,
      status: params?.status ?? undefined,
      dateFrom: params?.dateFrom ?? undefined,
      dateTo: params?.dateTo ?? undefined,
      sortBy: params?.sortBy ?? undefined,
      sortDir: params?.sortDir ?? undefined,
      take: params?.take ?? undefined,
    },
  });
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

export async function getRegisterClosingCashPreview(sessionId: number): Promise<{
  openingCash: number;
  /** Somme des totaux de vente de la session (classique + spéciale). */
  salesTotal?: number;
  salesCash: number;
  expenses: number;
  unsettledChange: number;
  expected: number;
}> {
  const { data } = await api.get<{
    openingCash: number;
    salesTotal?: number;
    salesCash: number;
    expenses: number;
    unsettledChange: number;
    expected: number;
  }>(`/register-sessions/${sessionId}/closing-cash-preview`);
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

export async function exportGlobalStockSnapshotPdf(params?: {
  companyIds?: number[];
  departmentIds?: number[];
  asOf?: string;
}): Promise<Blob> {
  const { data } = await api.get<Blob>('/inventory/global-snapshot/export/pdf', {
    params: {
      companyIds: params?.companyIds?.length ? params.companyIds.join(',') : undefined,
      departmentIds: params?.departmentIds?.length ? params.departmentIds.join(',') : undefined,
      asOf: params?.asOf?.trim() || undefined,
    },
    responseType: 'blob',
  });
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

export async function deletePurchaseOrder(id: number): Promise<void> {
  await api.delete(`/purchasing/orders/${id}`);
}

export async function deleteGoodsReceipt(id: number): Promise<PurchaseOrderDetail> {
  const { data } = await api.delete<PurchaseOrderDetail>(`/purchasing/receipts/${id}`);
  return data;
}

export async function listGoodsReceipts(departmentId?: number): Promise<GoodsReceiptListItem[]> {
  const { data } = await api.get<GoodsReceiptListItem[]>('/purchasing/receipts', {
    params: departmentId != null ? { departmentId } : undefined,
  });
  return data;
}

export async function createGoodsReceipt(payload: {
  departmentId: number;
  purchaseOrderId: number;
  note?: string;
  lines: Array<{ productId: number; quantity: number; unitCost: number }>;
}) {
  const { data } = await api.post('/purchasing/receipts', payload);
  return data;
}

export async function postGoodsReceipt(id: number) {
  const { data } = await api.post(`/purchasing/receipts/${id}/post`);
  return data;
}

export async function getRecipeByProduct(productId: number): Promise<ProductRecipeDetail | null> {
  const { data } = await api.get<ProductRecipeDetail | null>(`/recipes/by-product/${productId}`);
  return data;
}

export async function upsertRecipe(
  productId: number,
  payload: { components: Array<{ componentProductId: number; quantityPerParentBaseUnit: number }> },
) {
  const { data } = await api.put<ProductRecipeDetail>(`/recipes/${productId}`, payload);
  return data;
}

export async function getRevenueReport() {
  const { data } = await api.get<RevenueReport>('/reports/revenue');
  return data;
}

export async function getMarginAnalysis(params: {
  companyId?: number;
  companyIds?: number[];
  dateFrom: string;
  dateTo: string;
  departmentId?: number;
}) {
  const { data } = await api.get<MarginAnalysisReport>('/reports/margin', {
    params: {
      companyId: params.companyIds?.length ? undefined : params.companyId,
      companyIds: params.companyIds?.length ? params.companyIds.join(',') : undefined,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      departmentId: params.departmentId,
    },
  });
  return data;
}

export async function getFinanceJournal(params?: {
  companyId?: number;
  skip?: number;
  take?: number;
}): Promise<{ items: FinanceEntry[]; total: number }> {
  const { data } = await api.get<{ items: FinanceEntry[]; total: number }>('/finance/journal', {
    params: {
      companyId: params?.companyId ?? undefined,
      skip: params?.skip ?? undefined,
      take: params?.take ?? undefined,
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
      skip: params.skip ?? undefined,
      take: params.take ?? undefined,
    },
  });
  return data;
}

export async function exportFinanceLedgerPdf(params: {
  companyId: number;
  dateFrom: string;
  dateTo: string;
  nature?: 'all' | 'purchase' | 'sale' | 'expense';
}): Promise<Blob> {
  const { data } = await api.get<Blob>('/finance/ledger/export/pdf', {
    params: {
      companyId: params.companyId,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      nature: params.nature ?? 'all',
    },
    responseType: 'blob',
  });
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

export async function createFinanceEntry(payload: {
  type: 'INCOME' | 'EXPENSE';
  amount: number;
  description: string;
  detail?: string;
  companyId?: number;
  /** YYYY-MM-DD — date comptable (sinon horodatage serveur). */
  entryDate?: string;
}): Promise<FinanceEntry> {
  const { data } = await api.post<FinanceEntry>('/finance/entries', payload);
  return data;
}

/* ——— Comptabilité ——— */

export async function getAccountingOverview(companyId: number) {
  const { data } = await api.get<import('../types/api').AccountingOverview>('/accounting/overview', {
    params: { companyId },
  });
  return data;
}

export async function getAccountingAccounts(companyId: number) {
  const { data } = await api.get<import('../types/api').AccountRow[]>('/accounting/accounts', {
    params: { companyId },
  });
  return data;
}

export async function ensureAccountingChart(companyId: number) {
  const { data } = await api.post<import('../types/api').AccountRow[]>('/accounting/accounts/ensure', {
    companyId,
  });
  return data;
}

export async function createAccountingAccount(payload: {
  companyId: number;
  code: string;
  name: string;
  classNumber: number;
}) {
  const { data } = await api.post<import('../types/api').AccountRow>('/accounting/accounts', payload);
  return data;
}

export async function updateAccountingAccount(
  id: number,
  payload: {
    code?: string;
    name?: string;
    classNumber?: number;
    nature?: 'BALANCE_SHEET' | 'INCOME_STATEMENT';
    isDebitNormal?: boolean;
    isActive?: boolean;
  },
) {
  const { data } = await api.patch<import('../types/api').AccountRow>(
    `/accounting/accounts/${id}`,
    payload,
  );
  return data;
}

export async function removeAccountingAccount(id: number) {
  const { data } = await api.delete<{
    account: import('../types/api').AccountRow;
    action: 'deleted' | 'deactivated';
    message: string;
  }>(`/accounting/accounts/${id}`);
  return data;
}

export async function getFiscalYears(companyId: number) {
  const { data } = await api.get<import('../types/api').FiscalYearRow[]>('/accounting/fiscal-years', {
    params: { companyId },
  });
  return data;
}

export async function createFiscalYear(payload: {
  companyId: number;
  label: string;
  startDate: string;
  endDate: string;
}) {
  const { data } = await api.post<import('../types/api').FiscalYearRow>(
    '/accounting/fiscal-years',
    payload,
  );
  return data;
}

export async function closeFiscalYear(id: number) {
  const { data } = await api.post<{
    fiscalYear: import('../types/api').FiscalYearRow;
    resultat: number;
  }>(`/accounting/fiscal-years/${id}/close`);
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
}) {
  const { data } = await api.get<{
    items: import('../types/api').JournalEntryRow[];
    total: number;
    fiscalYear: import('../types/api').FiscalYearRow | null;
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
}) {
  const { data } = await api.post<import('../types/api').JournalEntryRow>(
    '/accounting/journal',
    payload,
  );
  return data;
}

export async function getTrialBalance(params: {
  companyId: number;
  fiscalYearId?: number;
  dateFrom?: string;
  dateTo?: string;
}) {
  const { data } = await api.get<import('../types/api').TrialBalanceReport>(
    '/accounting/trial-balance',
    { params },
  );
  return data;
}

export async function getBalanceSheet(params: {
  companyId: number;
  fiscalYearId?: number;
  dateTo?: string;
}) {
  const { data } = await api.get<import('../types/api').BalanceSheetReport>(
    '/accounting/balance-sheet',
    { params },
  );
  return data;
}

export async function getIncomeStatement(params: {
  companyId: number;
  fiscalYearId?: number;
  dateFrom?: string;
  dateTo?: string;
}) {
  const { data } = await api.get<import('../types/api').IncomeStatementReport>(
    '/accounting/income-statement',
    { params },
  );
  return data;
}

export async function getGeneralLedger(params: {
  companyId: number;
  accountId?: number;
  accountCode?: string;
  fiscalYearId?: number;
  dateFrom?: string;
  dateTo?: string;
}) {
  const { data } = await api.get<import('../types/api').GeneralLedgerReport>(
    '/accounting/general-ledger',
    { params },
  );
  return data;
}

async function accountingPdf(path: string, params: Record<string, string | number | undefined>) {
  const { data } = await api.get<Blob>(path, { params, responseType: 'blob' });
  return data;
}

export function exportAccountingTrialBalancePdf(params: {
  companyId: number;
  fiscalYearId?: number;
  dateFrom?: string;
  dateTo?: string;
}) {
  return accountingPdf('/accounting/export/trial-balance/pdf', params);
}

export function exportAccountingBalanceSheetPdf(params: {
  companyId: number;
  fiscalYearId?: number;
  dateTo?: string;
}) {
  return accountingPdf('/accounting/export/balance-sheet/pdf', params);
}

export function exportAccountingIncomeStatementPdf(params: {
  companyId: number;
  fiscalYearId?: number;
  dateFrom?: string;
  dateTo?: string;
}) {
  return accountingPdf('/accounting/export/income-statement/pdf', params);
}

export function exportAccountingJournalPdf(params: {
  companyId: number;
  fiscalYearId?: number;
  dateFrom?: string;
  dateTo?: string;
}) {
  return accountingPdf('/accounting/export/journal/pdf', params);
}

export function exportAccountingGeneralLedgerPdf(params: {
  companyId: number;
  accountId?: number;
  accountCode?: string;
  fiscalYearId?: number;
  dateFrom?: string;
  dateTo?: string;
}) {
  return accountingPdf('/accounting/export/general-ledger/pdf', params);
}

export async function backfillAccounting(companyId: number) {
  const { data } = await api.post<import('../types/api').AccountingBackfillResult>(
    '/accounting/backfill',
    { companyId },
  );
  return data;
}

export async function getAccountingSuppliers(companyId: number) {
  const { data } = await api.get<import('../types/api').AccountingSuppliersOverview>(
    '/accounting/suppliers',
    { params: { companyId } },
  );
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
}) {
  const { data } = await api.post('/accounting/suppliers/payments', payload);
  return data;
}

export async function getFixedAssets(companyId: number) {
  const { data } = await api.get<import('../types/api').FixedAssetRow[]>(
    '/accounting/fixed-assets',
    { params: { companyId } },
  );
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
}) {
  const { data } = await api.post<import('../types/api').FixedAssetRow>(
    '/accounting/fixed-assets',
    payload,
  );
  return data;
}

export async function runDepreciation(payload: {
  companyId: number;
  period: string;
  fixedAssetId?: number;
}) {
  const { data } = await api.post<{
    period: string;
    results: Array<{
      assetId: number;
      name: string;
      amount: number;
      status: 'posted' | 'skipped' | 'fully_depreciated';
    }>;
  }>('/accounting/fixed-assets/depreciate', payload);
  return data;
}

export async function getDashboardSummary(params?: { companyId?: number; companyIds?: number[] }) {
  const { data } = await api.get<DashboardSummaryReport>('/reports/dashboard-summary', {
    params: {
      companyId: params?.companyIds?.length ? undefined : params?.companyId,
      companyIds: params?.companyIds?.length ? params.companyIds.join(',') : undefined,
    },
  });
  return data;
}

export async function getDashboardSummaryRange(params: {
  companyId?: number;
  companyIds?: number[];
  dateFrom: string;
  dateTo: string;
  departmentId?: number;
}) {
  const { data } = await api.get<DashboardBalanceSnapshot>('/reports/dashboard-summary-range', {
    params: {
      companyId: params.companyIds?.length ? undefined : params.companyId,
      companyIds: params.companyIds?.length ? params.companyIds.join(',') : undefined,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      departmentId: params.departmentId,
    },
  });
  return data;
}

export async function getDashboardSalesByProduct(params: {
  companyId?: number;
  companyIds?: number[];
  /** Si dateFrom + dateTo sont fournis, ils priment sur period. */
  period?: 'day' | 'week' | 'month';
  dateFrom?: string;
  dateTo?: string;
  departmentId?: number;
}) {
  const companyParams = params.companyIds?.length
    ? { companyIds: params.companyIds.join(',') }
    : { companyId: params.companyId };
  const base =
    params.dateFrom && params.dateTo
      ? { ...companyParams, dateFrom: params.dateFrom, dateTo: params.dateTo }
      : {
          ...companyParams,
          period: params.period ?? 'month',
        };
  const { data } = await api.get<DashboardSalesByProductRow[]>('/reports/dashboard-sales-by-product', {
    params: {
      ...base,
      ...(params.departmentId != null && params.departmentId > 0
        ? { departmentId: params.departmentId }
        : {}),
    },
  });
  return data;
}

export async function exportDashboardSalesByProductPdf(params: {
  companyId: number;
  dateFrom: string;
  dateTo: string;
  departmentId?: number;
}): Promise<Blob> {
  const { data } = await api.get<Blob>('/reports/dashboard-sales-by-product/export/pdf', {
    params: {
      companyId: params.companyId,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      departmentId: params.departmentId,
    },
    responseType: 'blob',
  });
  return data;
}

export async function exportFinancialSynthesisPdf(params: {
  companyId?: number;
  companyIds?: number[];
  dateFrom: string;
  dateTo: string;
  departmentId?: number;
}): Promise<Blob> {
  const { data } = await api.get<Blob>('/reports/dashboard-synthesis/export/pdf', {
    params: {
      companyId: params.companyIds?.length ? undefined : params.companyId,
      companyIds: params.companyIds?.length ? params.companyIds.join(',') : undefined,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      departmentId: params.departmentId,
    },
    responseType: 'blob',
  });
  return data;
}

export async function getCreditSummary(companyId: number) {
  const { data } = await api.get<CreditSummary>('/credit/summary', {
    params: { companyId },
  });
  return data;
}

export async function listCreditCustomers(params: {
  companyId: number;
  q?: string;
  includeInactive?: boolean;
}) {
  const { data } = await api.get<CreditCustomerListItem[]>('/credit/customers', {
    params: {
      companyId: params.companyId,
      q: params.q || undefined,
      includeInactive: params.includeInactive ? '1' : undefined,
    },
  });
  return data;
}

export async function getCreditCustomer(id: number) {
  const { data } = await api.get<CreditCustomerDetail>(`/credit/customers/${id}`);
  return data;
}

export async function createCreditCustomer(payload: {
  companyId: number;
  departmentId?: number;
  name: string;
  phone?: string;
  address?: string;
  note?: string;
  creditLimit?: number;
}) {
  const { data } = await api.post('/credit/customers', payload);
  return data;
}

export async function updateCreditCustomer(
  id: number,
  payload: {
    name?: string;
    phone?: string | null;
    address?: string | null;
    note?: string | null;
    creditLimit?: number;
    isActive?: boolean;
    departmentId?: number | null;
  },
) {
  const { data } = await api.patch(`/credit/customers/${id}`, payload);
  return data;
}

export async function createCreditSale(payload: {
  creditCustomerId: number;
  items: Array<{ productSaleUnitId: number; quantity: number }>;
  downPayment?: number;
  downPaymentMethod?: 'CASH' | 'CARD' | 'MOBILE_MONEY';
  note?: string;
}) {
  const { data } = await api.post<{
    saleId: number;
    txnNumber?: number;
    total: number;
    amountPaid: number;
    balanceDue: number;
    deliveryId: number;
  }>('/credit/sales', payload);
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
}) {
  const { data } = await api.post('/credit/payments', payload);
  return data;
}

export async function listBanks(params: { companyId: number; includeInactive?: boolean }) {
  const { data } = await api.get<BankRow[]>('/banks', {
    params: {
      companyId: params.companyId,
      includeInactive: params.includeInactive ? '1' : undefined,
    },
  });
  return data;
}

export async function getBankSummary(companyId: number) {
  const { data } = await api.get<BankSummary>('/banks/summary', { params: { companyId } });
  return data;
}

export async function createBank(payload: { companyId: number; name: string; note?: string }) {
  const { data } = await api.post('/banks', payload);
  return data;
}

export async function updateBank(
  id: number,
  payload: { name?: string; note?: string | null; isActive?: boolean },
) {
  const { data } = await api.patch(`/banks/${id}`, payload);
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

export async function listBankTransactions(params: {
  companyId: number;
  bankAccountId?: number;
  skip?: number;
  take?: number;
}) {
  const { data } = await api.get<{
    total: number;
    skip: number;
    take: number;
    items: BankTransactionRow[];
  }>('/banks/transactions', { params });
  return data;
}

export async function createBankTransaction(payload: {
  bankAccountId: number;
  type: 'DEPOSIT' | 'WITHDRAWAL';
  amount: number;
  description: string;
  reference?: string;
  occurredOn?: string;
}) {
  const { data } = await api.post<{
    transaction: BankTransactionRow;
    accountBalance: number;
  }>('/banks/transactions', payload);
  return data;
}

export async function deleteBankTransaction(id: number, companyId: number) {
  await api.delete(`/banks/transactions/${id}`, { params: { companyId } });
}

export async function refreshSession() {
  const refreshToken = readRefreshToken();
  if (!refreshToken) return null;
  const { data } = await api.post<{ accessToken: string; refreshToken: string }>('/auth/refresh', {
    refreshToken,
  });
  writeToken(data.accessToken);
  writeRefreshToken(data.refreshToken);
  return data.accessToken;
}

export function logout() {
  const refreshToken = readRefreshToken();
  if (refreshToken) {
    void api.post('/auth/logout', { refreshToken }).catch(() => undefined);
  }
  clearToken();
  clearRefreshToken();
  clearSessionUser();
}

export function getToken() {
  return readToken();
}

export function getSessionUser(): SessionUser | null {
  return readSessionUser();
}

export function writeSessionUser(user: SessionUser) {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* ignore */
  }
}

function readSessionUser(): SessionUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

function clearSessionUser() {
  try {
    localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
}

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

function readRefreshToken() {
  try {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeRefreshToken(token: string) {
  try {
    localStorage.setItem(REFRESH_TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

function clearRefreshToken() {
  try {
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}
