import { getCompany, getPrinterSettings } from './api';
import { getDb } from './db';
import type { CompanyProfile, DepartmentPrinterSettings, Sale } from '../types/api';
import type { ReceiptItem, SaleReceiptData } from './escpos';
import { formatDateTime } from '../utils/datetime';
import { paymentMethodLabel } from '../utils/paymentLabels';

const PRINTER_CACHE_KEY = 'printer_settings_backend';
const COMPANY_CACHE_KEY = 'company_profile';

async function cacheGet<T>(key: string): Promise<T | null> {
  const row = await getDb().getFirstAsync<{ value_json: string }>(
    'SELECT value_json FROM app_cache WHERE key = ?',
    key,
  );
  return row ? (JSON.parse(row.value_json) as T) : null;
}

async function cacheSet(key: string, value: unknown): Promise<void> {
  await getDb().runAsync(
    'INSERT OR REPLACE INTO app_cache (key, value_json, updated_at) VALUES (?, ?, ?)',
    key,
    JSON.stringify(value),
    Date.now(),
  );
}

/** Réglages ticket partagés du backend, avec repli sur le dernier cache local si hors ligne. */
export async function loadPrinterSettings(
  departmentId?: number,
): Promise<DepartmentPrinterSettings | null> {
  try {
    const settings = await getPrinterSettings(departmentId);
    if (settings) await cacheSet(PRINTER_CACHE_KEY, settings);
    return settings;
  } catch {
    return cacheGet<DepartmentPrinterSettings>(PRINTER_CACHE_KEY);
  }
}

export async function loadCompanyProfile(): Promise<CompanyProfile | null> {
  try {
    const company = await getCompany();
    if (company) await cacheSet(COMPANY_CACHE_KEY, company);
    return company;
  } catch {
    return cacheGet<CompanyProfile>(COMPANY_CACHE_KEY);
  }
}

export async function buildSaleReceiptData(params: {
  items: ReceiptItem[];
  total: number;
  paymentMode: string;
  saleRef?: number;
  clientName?: string | null;
  cashier?: string | null;
  departmentId?: number;
  isTest?: boolean;
}): Promise<SaleReceiptData> {
  const [printer, company] = await Promise.all([
    loadPrinterSettings(params.departmentId),
    loadCompanyProfile(),
  ]);

  return {
    dateTime: formatDateTime(new Date()),
    receiptHeaderText: printer?.receiptHeaderText,
    companyName: company?.name ?? 'Entreprise',
    address: company?.address,
    companyPhone: company?.phone,
    showLogoOnReceipt: printer?.showLogoOnReceipt,
    receiptLogoUrl: printer?.receiptLogoUrl,
    receiptClientName: params.clientName ?? undefined,
    cashier: params.cashier ?? 'N/A',
    isTest: params.isTest,
    previewSampleBody: printer?.previewSampleBody,
    saleRef: params.saleRef,
    items: params.items,
    total: params.total,
    paymentMode: params.paymentMode,
    receiptFooterText: printer?.receiptFooterText,
    paperWidth: printer?.paperWidth === 80 ? 80 : 58,
    autoCut: printer?.autoCut,
  };
}

export function paymentModeFromSale(sale: Sale): string {
  const pays = sale.payments ?? [];
  if (pays.length === 0) return 'N/A';
  if (pays.length === 1) return paymentMethodLabel(String(pays[0].method));
  return 'Mixte';
}

export function cashierLabelFromSale(sale: Sale): string {
  return (
    sale.user?.fullName?.trim() ||
    sale.cashier ||
    (sale.user?.phone ? `Tel ${sale.user.phone}` : 'N/A')
  );
}

export async function buildSaleReceiptDataFromSale(
  sale: Sale,
  departmentId?: number,
): Promise<SaleReceiptData> {
  const items = (sale.items ?? []).map((it) => ({
    name: it.lineLabel ?? it.product?.name ?? 'Article',
    qty: Number(it.quantity),
    price: Number(it.unitPrice),
  }));
  const data = await buildSaleReceiptData({
    items,
    total: Number(sale.total),
    paymentMode: paymentModeFromSale(sale),
    saleRef: sale.txnNumber ?? sale.id,
    clientName: sale.clientName,
    cashier: cashierLabelFromSale(sale),
    departmentId: departmentId ?? sale.items?.[0]?.product?.departmentId ?? undefined,
  });
  return { ...data, dateTime: formatDateTime(sale.createdAt) };
}
