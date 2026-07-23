// Port TS pur de apps/desktop/src/main/thermal-printer.cjs — mêmes règles de mise en
// page et mêmes octets ESC/POS. Le rendu du logo en bitmap raster (escPosRasterFromDataUrl,
// dépendant de `nativeImage` Electron) est explicitement exclu de la Phase 1 ; le
// placeholder texte '[Logo sur ticket]' déjà utilisé par le desktop en repli est conservé.

export interface ReceiptItem {
  name: string;
  qty: number;
  price: number;
}

export interface SaleReceiptData {
  dateTime?: string;
  receiptHeaderText?: string | null;
  companyName?: string;
  address?: string | null;
  companyPhone?: string | null;
  showLogoOnReceipt?: boolean;
  receiptLogoUrl?: string | null;
  receiptClientName?: string | null;
  cashier?: string;
  isTest?: boolean;
  previewSampleBody?: string | null;
  items?: ReceiptItem[];
  total?: number;
  paymentMode?: string;
  receiptFooterText?: string | null;
  paperWidth?: 58 | 80;
  autoCut?: boolean;
}

const ESC_INIT = [0x1b, 0x40];
const ESC_ALIGN_LEFT = [0x1b, 0x61, 0x00];
const GS_CUT = [0x1d, 0x56, 0x00];

const APP_TIMEZONE = 'America/Port-au-Prince';

function formatDateTimePap(value: Date | string | number = new Date()): string {
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-HT', {
    timeZone: APP_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

function formatMoney(value: number | undefined): string {
  return Number(value ?? 0).toFixed(2);
}

function clipLine(text: unknown, lineWidth: number): string {
  const t = String(text ?? '');
  return t.length <= lineWidth ? t : t.slice(0, lineWidth - 1) + '…';
}

export function buildTicketText(saleData: SaleReceiptData, width: 58 | 80 = 58): string {
  const lineWidth = width === 80 ? 48 : 32;
  const separator = '-'.repeat(lineWidth);
  const date = saleData.dateTime ?? formatDateTimePap(new Date());
  const lines: string[] = [];

  const headerRaw = (saleData.receiptHeaderText || '').trim();
  if (headerRaw) {
    for (const line of headerRaw.split('\n')) {
      const s = line.trim();
      if (s) lines.push(clipLine(s, lineWidth));
    }
  } else {
    lines.push(clipLine(saleData.companyName ?? 'Entreprise', lineWidth));
  }

  const addr = (saleData.address || '').trim();
  if (addr) lines.push(clipLine(addr, lineWidth));

  const phone = String(saleData.companyPhone ?? '').trim();
  if (phone) lines.push(clipLine(`Tél: ${phone}`, lineWidth));

  if (saleData.showLogoOnReceipt && saleData.receiptLogoUrl) {
    lines.push(clipLine('[Logo sur ticket]', lineWidth));
  }

  lines.push(separator);
  if (saleData.receiptClientName) {
    lines.push(clipLine(`Client: ${saleData.receiptClientName}`, lineWidth));
  }
  lines.push(`Caissier: ${saleData.cashier ?? 'N/A'}`);
  lines.push(`Date: ${date}`);
  lines.push(separator);

  const isTest = !!saleData.isTest;
  const sampleBody = (saleData.previewSampleBody || '').trim();

  if (isTest && sampleBody) {
    lines.push(clipLine('--- Zone test (aperçu) ---', lineWidth));
    for (const raw of sampleBody.split('\n')) {
      const s = raw.trimEnd();
      if (s) lines.push(clipLine(s, lineWidth));
    }
    lines.push(separator);
    lines.push(`TOTAL TEST: ${formatMoney(saleData.total)}`);
  } else {
    for (const item of saleData.items ?? []) {
      lines.push(clipLine(`${item.name} x${item.qty}`, lineWidth));
      lines.push(
        clipLine(
          `  ${formatMoney(item.price)} x ${item.qty} = ${formatMoney(item.price * item.qty)}`,
          lineWidth,
        ),
      );
    }
    lines.push(separator);
    lines.push(`TOTAL: ${formatMoney(saleData.total)}`);
    lines.push(`Paiement: ${saleData.paymentMode ?? 'N/A'}`);
  }

  const footerRaw = (saleData.receiptFooterText || '').trim();
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

  lines.push('\n\n');
  return lines.join('\n');
}

/** Construit le buffer d'octets ESC/POS complet à écrire tel quel sur le socket Bluetooth. */
export function buildEscPosPayload(saleData: SaleReceiptData): Uint8Array {
  const width: 58 | 80 = saleData.paperWidth === 80 ? 80 : 58;
  const text = buildTicketText(saleData, width);
  const textBytes = Array.from(new TextEncoder().encode(text));
  const doCut = saleData.autoCut !== false;

  const bytes = [...ESC_INIT, ...ESC_ALIGN_LEFT, ...textBytes, ...(doCut ? GS_CUT : [])];
  return new Uint8Array(bytes);
}
