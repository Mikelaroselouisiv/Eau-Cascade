import type { CompanyProfile, DepartmentPrinterSettings, FinanceEntry } from '../types/api';
import { formatYmd } from './datetime';

export type DisbursementPrintPayload = {
  documentType: 'DISBURSEMENT_ORDER';
  companyName: string;
  companyPhone?: string | null;
  address: string;
  paperWidth?: 58 | 80;
  printerName?: string;
  receiptHeaderText?: string | null;
  receiptFooterText?: string | null;
  receiptLogoUrl?: string | null;
  showLogoOnReceipt?: boolean;
  autoCut?: boolean;
  isTest?: boolean;
  previewSampleBody?: string | null;
  description: string;
  detail?: string | null;
  amount: number;
  entryDate?: string;
  entryId?: number;
  preparedBy?: string;
  cashier?: string;
  items?: Array<{ name: string; qty: number; price: number }>;
  total?: number;
  paymentMode?: string;
};

export function buildDisbursementOrderPayload(opts: {
  entry: Pick<FinanceEntry, 'id' | 'amount' | 'description' | 'detail' | 'createdAt'> & {
    user?: { fullName?: string | null; phone?: string } | null;
  };
  company: CompanyProfile | null;
  printer: DepartmentPrinterSettings | null;
  /** YYYY-MM-DD prioritaire sur createdAt. */
  entryDateYmd?: string;
  isTest?: boolean;
}): DisbursementPrintPayload {
  const { entry, company, printer, entryDateYmd, isTest } = opts;
  const preparedBy =
    entry.user?.fullName?.trim() ||
    entry.user?.phone?.trim() ||
    undefined;

  return {
    documentType: 'DISBURSEMENT_ORDER',
    companyName: company?.name ?? 'Entreprise',
    companyPhone: company?.phone ?? null,
    address: [company?.address, company?.city]
      .map((s) => (s || '').trim())
      .filter(Boolean)
      .join(', '),
    paperWidth: printer?.paperWidth === 80 ? 80 : 58,
    printerName: printer?.deviceName || undefined,
    receiptHeaderText: printer?.disbursementHeaderText ?? null,
    receiptFooterText: printer?.disbursementFooterText ?? null,
    receiptLogoUrl: printer?.disbursementLogoUrl ?? null,
    showLogoOnReceipt: printer?.showLogoOnDisbursement !== false,
    autoCut: printer?.autoCut !== false,
    isTest: !!isTest,
    previewSampleBody: printer?.disbursementPreviewSampleBody ?? null,
    description: entry.description,
    detail: entry.detail?.trim() || null,
    amount: Number(entry.amount),
    entryDate: entryDateYmd?.trim() || formatYmd(entry.createdAt),
    entryId: entry.id,
    preparedBy,
    cashier: preparedBy ?? 'N/A',
    items: [],
    total: Number(entry.amount),
    paymentMode: 'Dépense',
  };
}
