import { formatDateTime } from './datetime';
/** Aperçu texte du ticket (même logique que thermal-printer.cjs, sans Electron). */

import { formatMoneyCompact } from './currency';

function formatMoney(value: number) {
  return formatMoneyCompact(value);
}

function clipLine(text: string, lineWidth: number) {
  const t = String(text ?? '');
  return t.length <= lineWidth ? t : t.slice(0, lineWidth - 1) + '…';
}

export type TicketPreviewInput = {
  paperWidth?: 58 | 80;
  companyName?: string;
  companyPhone?: string | null;
  address?: string;
  receiptHeaderText?: string | null;
  receiptFooterText?: string | null;
  showLogoOnReceipt?: boolean;
  receiptLogoUrl?: string | null;
  cashier?: string;
  saleId?: number;
  ticketNo?: string;
  receiptClientName?: string | null;
  isTest?: boolean;
  previewSampleBody?: string | null;
  items?: Array<{ name: string; qty: number; price: number }>;
  total?: number;
  paymentMode?: string;
  omitLogoPlaceholder?: boolean;
};

export function buildTicketPreviewText(data: TicketPreviewInput): string {
  const width = data.paperWidth === 80 ? 80 : 58;
  const lineWidth = width === 80 ? 48 : 32;
  const separator = '-'.repeat(lineWidth);
  const date = formatDateTime(new Date());
  const lines: string[] = [];

  const headerRaw = (data.receiptHeaderText || '').trim();
  if (headerRaw) {
    for (const line of headerRaw.split('\n')) {
      const s = line.trim();
      if (s) lines.push(clipLine(s, lineWidth));
    }
  } else {
    lines.push(clipLine(data.companyName ?? 'Entreprise', lineWidth));
  }

  const addr = (data.address || '').trim();
  if (addr) lines.push(clipLine(addr, lineWidth));

  const phone = String(data.companyPhone ?? '').trim();
  if (phone) {
    lines.push(clipLine(`Tél: ${phone}`, lineWidth));
  }

  const safeLogo =
    data.showLogoOnReceipt && String(data.receiptLogoUrl || '').startsWith('data:image');
  if (data.showLogoOnReceipt && data.receiptLogoUrl && !data.omitLogoPlaceholder && !safeLogo) {
    lines.push(clipLine('[Logo sur ticket]', lineWidth));
  }

  lines.push(separator);
  const ticketRef =
    (data.ticketNo && String(data.ticketNo).trim()) ||
    (data.saleId != null ? String(data.saleId) : '');
  if (ticketRef) {
    lines.push(clipLine(`Vente #${ticketRef}`, lineWidth));
  }
  if (data.receiptClientName) {
    lines.push(clipLine(`Client: ${data.receiptClientName}`, lineWidth));
  }
  lines.push(`Caissier: ${data.cashier ?? 'N/A'}`);
  lines.push(`Date: ${date}`);
  lines.push(separator);

  const isTest = !!data.isTest;
  const sampleBody = (data.previewSampleBody || '').trim();

  if (isTest && sampleBody) {
    lines.push(clipLine('--- Zone test (aperçu) ---', lineWidth));
    for (const raw of sampleBody.split('\n')) {
      const s = raw.trimEnd();
      if (s) lines.push(clipLine(s, lineWidth));
    }
    lines.push(separator);
    lines.push(`TOTAL TEST: ${formatMoney(data.total ?? 0)}`);
  } else {
    for (const item of data.items ?? []) {
      lines.push(clipLine(`${item.name} x${item.qty}`, lineWidth));
      lines.push(
        clipLine(
          `  ${formatMoney(item.price)} x ${item.qty} = ${formatMoney(item.price * item.qty)}`,
          lineWidth,
        ),
      );
    }
    lines.push(separator);
    lines.push(`TOTAL: ${formatMoney(data.total ?? 0)}`);
    lines.push(`Paiement: ${data.paymentMode ?? 'N/A'}`);
  }

  const footerRaw = (data.receiptFooterText || '').trim();
  if (footerRaw) {
    lines.push(separator);
    for (const line of footerRaw.split('\n')) {
      const s = line.trim();
      if (s) lines.push(clipLine(s, lineWidth));
    }
  } else if (!isTest) {
    lines.push(separator);
    lines.push('Merci pour votre visite');
  }

  return lines.join('\n');
}
