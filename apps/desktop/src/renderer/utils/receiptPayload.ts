import { formatDateTime } from './datetime';
import { saleTxnNumber } from './saleTxnNumber';
import type { CompanyProfile, DepartmentPrinterSettings, Sale } from '../types/api';

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
  const paperWidth: 58 | 80 = printer?.paperWidth === 80 ? 80 : 58;
  return {
    saleId: saleTxnNumber(sale),
    companyName: company?.name ?? 'Entreprise',
    companyPhone: company?.phone ?? null,
    address: [company?.address, company?.city].filter(Boolean).join(', ') || '',
    cashier: cashierLabelFromSale(sale),
    dateTime: formatDateTime(sale.createdAt),
    receiptClientName: sale.clientName && sale.clientName.trim() ? sale.clientName.trim() : null,
    items,
    total,
    amountReceived: amountReceived > 0.009 ? amountReceived : undefined,
    changeDue: changeDue > 0.009 ? changeDue : undefined,
    balanceDue: balanceDue > 0.009 ? balanceDue : undefined,
    paymentMode: paymentModeFromSale(sale),
    paperWidth,
    printerName: printer?.deviceName ?? '',
    receiptHeaderText: printer?.receiptHeaderText ?? null,
    receiptFooterText: printer?.receiptFooterText ?? null,
    receiptLogoUrl: printer?.receiptLogoUrl ?? null,
    showLogoOnReceipt: printer?.showLogoOnReceipt ?? true,
    autoCut: printer?.autoCut ?? true,
  };
}

/** Même structure que le payload d’impression thermique / `printReceipt`. */
export type ReceiptPrintPayload = ReturnType<typeof buildReceiptPayloadFromSale>;
