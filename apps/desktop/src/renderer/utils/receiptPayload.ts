import { formatDateTime } from './datetime';
import { saleTxnNumber } from './saleTxnNumber';
import type {
  CompanyListItem,
  CompanyProfile,
  CreditCustomerDetail,
  DepartmentPrinterSettings,
  DonationBeneficiaryDetail,
  DonationRow,
  Sale,
} from '../types/api';

type CompanyBits = Pick<CompanyProfile, 'name' | 'phone' | 'address' | 'city'> | CompanyListItem | null;

function paymentModeLabel(method: string): string {
  switch (method) {
    case 'CASH':
      return 'Espèces';
    case 'CARD':
      return 'Carte';
    case 'MOBILE_MONEY':
      return 'Mobile money';
    case 'SPLIT':
      return 'Mixte';
    case 'CREDIT':
      return 'À crédit';
    case 'BANK':
      return 'Banque';
    default:
      return method;
  }
}

export function paymentModeFromSale(sale: Sale): string {
  if (sale.creditCustomerId != null) return 'À crédit';
  const pays = sale.payments ?? [];
  if (pays.length === 0) return 'N/A';
  if (pays.length === 1) return paymentModeLabel(String(pays[0].method));
  return 'Mixte';
}

export function cashierLabelFromSale(sale: Sale): string {
  return (
    sale.user?.fullName?.trim() ||
    sale.cashier ||
    (sale.user?.phone ? `Tel ${sale.user.phone}` : 'N/A')
  );
}

function receiptContextFields(
  company: CompanyBits,
  printer: DepartmentPrinterSettings | null,
) {
  const paperWidth: 58 | 80 = printer?.paperWidth === 80 ? 80 : 58;
  return {
    companyName: company?.name ?? 'Entreprise',
    companyPhone: company?.phone ?? null,
    address: [company?.address, company?.city].filter(Boolean).join(', ') || '',
    paperWidth,
    printerName: printer?.deviceName ?? '',
    receiptHeaderText: printer?.receiptHeaderText ?? null,
    receiptFooterText: printer?.receiptFooterText ?? null,
    receiptLogoUrl: printer?.receiptLogoUrl ?? null,
    showLogoOnReceipt: printer?.showLogoOnReceipt ?? true,
    autoCut: printer?.autoCut ?? true,
  };
}

function moneyOrUndef(value: number | null | undefined): number | undefined {
  const n = Number(value ?? 0);
  return n > 0.009 ? n : undefined;
}

/**
 * Même structure que `window.desktopApp.printReceipt` au moment de l’encaissement (PosPage).
 */
export function buildReceiptPayloadFromSale(
  sale: Sale,
  company: CompanyProfile | null,
  printer: DepartmentPrinterSettings | null,
) {
  const items = (sale.items ?? []).map((it) => ({
    name: it.lineLabel ?? it.product?.name ?? 'Article',
    qty: Number(it.quantity),
    price: Number(it.unitPrice),
  }));
  const total = Number(sale.total);
  const amountPaid = Number(sale.amountPaid ?? 0);
  const amountReceived = Number(sale.amountReceived ?? 0);
  const changeDue = Number(sale.changeDue ?? 0);
  const balanceDue = Math.max(0, Math.round((total - amountPaid) * 100) / 100);
  const ref = saleTxnNumber(sale);
  const received = amountReceived > 0.009 ? amountReceived : amountPaid;
  return {
    ...receiptContextFields(company, printer),
    saleId: ref,
    ticketTitle: `Vente #${ref}`,
    cashier: cashierLabelFromSale(sale),
    dateTime: formatDateTime(sale.createdAt),
    receiptClientName: sale.clientName && sale.clientName.trim() ? sale.clientName.trim() : null,
    receiptClientPhone:
      sale.fulfillmentType === 'HOME' && sale.clientPhone?.trim() ? sale.clientPhone.trim() : null,
    receiptClientAddress:
      sale.fulfillmentType === 'HOME' && sale.clientAddress?.trim()
        ? sale.clientAddress.trim()
        : null,
    fulfillmentLabel: sale.fulfillmentType === 'HOME' ? 'À domicile' : 'Sur place',
    departmentName:
      sale.fulfillmentType === 'HOME'
        ? null
        : sale.items?.[0]?.product?.department?.name?.trim() || null,
    items,
    total,
    amountReceived: moneyOrUndef(received),
    changeDue: changeDue > 0.009 ? changeDue : undefined,
    balanceDue: balanceDue > 0.009 ? balanceDue : undefined,
    paymentMode: paymentModeFromSale(sale),
  };
}

export function buildReceiptPayloadFromDonation(
  donation: DonationRow,
  beneficiary: Pick<DonationBeneficiaryDetail, 'name' | 'phone' | 'address'>,
  company: CompanyBits,
  printer: DepartmentPrinterSettings | null,
  cashier: string,
) {
  return {
    ...receiptContextFields(company, printer),
    saleId: donation.id,
    ticketTitle: `Don #${donation.id}`,
    cashier,
    dateTime: formatDateTime(donation.createdAt),
    receiptClientName: beneficiary.name,
    receiptClientPhone: beneficiary.phone?.trim() || null,
    receiptClientAddress: beneficiary.address?.trim() || null,
    fulfillmentLabel: 'Sur place',
    departmentName: donation.department?.name?.trim() || null,
    items: donation.items.map((it) => ({
      name: it.product?.name ?? 'Article',
      qty: Number(it.quantity),
      price: 0,
    })),
    total: 0,
    paymentMode: 'Don',
  };
}

type CreditFicheSale = CreditCustomerDetail['sales'][number];

export function buildReceiptPayloadFromCreditFicheSale(
  sale: CreditFicheSale,
  customer: { name: string; phone?: string | null; address?: string | null },
  company: CompanyBits,
  printer: DepartmentPrinterSettings | null,
  cashier: string,
  overrides?: { amountPaid?: number; balanceDue?: number; departmentName?: string | null },
) {
  const total = Number(sale.total);
  const amountPaid = Number(overrides?.amountPaid ?? sale.amountPaid ?? 0);
  const balanceDue =
    overrides?.balanceDue != null
      ? Number(overrides.balanceDue)
      : Math.max(0, Math.round((total - amountPaid) * 100) / 100);
  const ref = saleTxnNumber(sale);
  return {
    ...receiptContextFields(company, printer),
    saleId: ref,
    ticketTitle: `Vente #${ref}`,
    cashier,
    dateTime: formatDateTime(sale.createdAt),
    receiptClientName: customer.name,
    receiptClientPhone: customer.phone?.trim() || null,
    receiptClientAddress: customer.address?.trim() || null,
    fulfillmentLabel: 'Sur place',
    departmentName: overrides?.departmentName ?? null,
    items: sale.items.map((it) => ({
      name: it.lineLabel || it.product?.name || 'Article',
      qty: Number(it.quantity),
      price: Number(it.unitPrice),
    })),
    total,
    amountReceived: moneyOrUndef(amountPaid),
    balanceDue: moneyOrUndef(balanceDue),
    paymentMode: 'À crédit',
  };
}

/** Même structure que le payload d’impression thermique / `printReceipt`. */
export type ReceiptPrintPayload = {
  saleId?: number;
  ticketTitle?: string | null;
  companyName: string;
  companyPhone?: string | null;
  address: string;
  cashier: string;
  dateTime?: string;
  receiptClientName?: string | null;
  receiptClientPhone?: string | null;
  receiptClientAddress?: string | null;
  fulfillmentLabel?: string | null;
  departmentName?: string | null;
  items: Array<{ name: string; qty: number; price: number }>;
  total: number;
  amountReceived?: number;
  changeDue?: number;
  balanceDue?: number;
  paymentMode: string;
  paperWidth?: 58 | 80;
  printerName?: string;
  receiptHeaderText?: string | null;
  receiptFooterText?: string | null;
  receiptLogoUrl?: string | null;
  showLogoOnReceipt?: boolean;
  autoCut?: boolean;
};

export async function printThermalReceipt(payload: ReceiptPrintPayload): Promise<boolean> {
  if (!window.desktopApp?.printReceipt) return false;
  const r = await window.desktopApp.printReceipt(payload);
  return Boolean(r?.ok);
}
