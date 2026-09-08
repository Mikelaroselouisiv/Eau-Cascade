import { getCompany, getPrinterSettings } from './api';
import { getDb } from './db';
import type { CompanyProfile, CreditCustomerDetail, DepartmentPrinterSettings, DonationRow, Sale } from '../types/api';
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
  ticketTitle?: string | null;
  clientName?: string | null;
  clientPhone?: string | null;
  clientAddress?: string | null;
  fulfillmentLabel?: string | null;
  departmentName?: string | null;
  cashier?: string | null;
  departmentId?: number;
  amountReceived?: number;
  changeDue?: number;
  balanceDue?: number;
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
    receiptClientPhone: params.clientPhone ?? undefined,
    receiptClientAddress: params.clientAddress ?? undefined,
    fulfillmentLabel: params.fulfillmentLabel ?? undefined,
    departmentName: params.departmentName ?? undefined,
    cashier: params.cashier ?? 'N/A',
    isTest: params.isTest,
    previewSampleBody: printer?.previewSampleBody,
    saleRef: params.saleRef,
    ticketTitle: params.ticketTitle ?? undefined,
    items: params.items,
    total: params.total,
    amountReceived: params.amountReceived,
    changeDue: params.changeDue,
    balanceDue: params.balanceDue,
    paymentMode: params.paymentMode,
    receiptFooterText: printer?.receiptFooterText,
    paperWidth: 80,
    autoCut: printer?.autoCut,
  };
}

export function paymentModeFromSale(sale: Sale): string {
  if (sale.creditCustomerId != null) return 'À crédit';
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
    ticketTitle: `Vente #${sale.txnNumber ?? sale.id}`,
    clientName: sale.clientName,
    clientPhone: sale.fulfillmentType === 'HOME' ? sale.clientPhone : undefined,
    clientAddress: sale.fulfillmentType === 'HOME' ? sale.clientAddress : undefined,
    fulfillmentLabel: sale.fulfillmentType === 'HOME' ? 'À domicile' : 'Sur place',
    departmentName:
      sale.fulfillmentType === 'HOME' ? undefined : sale.items?.[0]?.product?.department?.name,
    cashier: cashierLabelFromSale(sale),
    departmentId: departmentId ?? sale.items?.[0]?.product?.departmentId ?? undefined,
    amountReceived: Number(sale.amountReceived ?? sale.amountPaid ?? 0) || undefined,
    changeDue: Number(sale.changeDue ?? 0) || undefined,
    balanceDue: Math.max(0, Number(sale.total) - Number(sale.amountPaid ?? 0)) || undefined,
  });
  return { ...data, dateTime: formatDateTime(sale.createdAt) };
}

export async function buildDonationReceiptData(params: {
  donation: DonationRow;
  beneficiary: { name: string; phone?: string | null; address?: string | null };
  cashier: string;
}): Promise<SaleReceiptData> {
  const data = await buildSaleReceiptData({
    items: params.donation.items.map((it) => ({
      name: it.product?.name ?? 'Article',
      qty: Number(it.quantity),
      price: 0,
    })),
    total: 0,
    paymentMode: 'Don',
    saleRef: params.donation.id,
    ticketTitle: `Don #${params.donation.id}`,
    clientName: params.beneficiary.name,
    clientPhone: params.beneficiary.phone,
    clientAddress: params.beneficiary.address,
    fulfillmentLabel: 'Sur place',
    departmentName: params.donation.department?.name,
    cashier: params.cashier,
    departmentId: params.donation.departmentId,
  });
  return { ...data, dateTime: formatDateTime(params.donation.createdAt) };
}

export async function buildCreditFicheSaleReceiptData(params: {
  sale: CreditCustomerDetail['sales'][number];
  customer: { name: string; phone?: string | null; address?: string | null };
  cashier: string;
  departmentId?: number | null;
  amountPaid?: number;
  balanceDue?: number;
}): Promise<SaleReceiptData> {
  const total = Number(params.sale.total);
  const amountPaid = Number(params.amountPaid ?? params.sale.amountPaid ?? 0);
  const balanceDue =
    params.balanceDue != null
      ? Number(params.balanceDue)
      : Math.max(0, Math.round((total - amountPaid) * 100) / 100);
  const ref = params.sale.txnNumber ?? params.sale.id;
  const data = await buildSaleReceiptData({
    items: params.sale.items.map((it) => ({
      name: it.lineLabel || it.product?.name || 'Article',
      qty: Number(it.quantity),
      price: Number(it.unitPrice),
    })),
    total,
    paymentMode: 'À crédit',
    saleRef: ref,
    ticketTitle: `Vente #${ref}`,
    clientName: params.customer.name,
    clientPhone: params.customer.phone,
    clientAddress: params.customer.address,
    fulfillmentLabel: 'Sur place',
    cashier: params.cashier,
    departmentId: params.departmentId ?? undefined,
    amountReceived: amountPaid > 0.009 ? amountPaid : undefined,
    balanceDue: balanceDue > 0.009 ? balanceDue : undefined,
  });
  return { ...data, dateTime: formatDateTime(params.sale.createdAt) };
}
