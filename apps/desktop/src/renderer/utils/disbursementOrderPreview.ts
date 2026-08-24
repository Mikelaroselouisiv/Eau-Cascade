import { formatDateTime, formatYmd } from './datetime';
import { formatMoneyCompact } from './currency';

function clipLine(text: string, lineWidth: number) {
  const t = String(text ?? '');
  return t.length <= lineWidth ? t : t.slice(0, lineWidth - 1) + '…';
}

export type DisbursementOrderPreviewInput = {
  paperWidth?: 58 | 80;
  companyName?: string;
  companyPhone?: string | null;
  address?: string;
  headerText?: string | null;
  footerText?: string | null;
  showLogo?: boolean;
  logoUrl?: string | null;
  omitLogoPlaceholder?: boolean;
  isTest?: boolean;
  previewSampleBody?: string | null;
  description?: string;
  detail?: string | null;
  amount?: number;
  entryDate?: string;
  entryId?: number;
  preparedBy?: string;
};

/** Aperçu texte de l’ordre de décaissement (thermique). */
export function buildDisbursementOrderPreviewText(data: DisbursementOrderPreviewInput): string {
  const width = data.paperWidth === 80 ? 80 : 58;
  const lineWidth = width === 80 ? 48 : 32;
  const separator = '-'.repeat(lineWidth);
  const lines: string[] = [];

  const headerRaw = (data.headerText || '').trim();
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
  if (phone) lines.push(clipLine(`Tél: ${phone}`, lineWidth));

  const safeLogo = data.showLogo && String(data.logoUrl || '').startsWith('data:image');
  if (data.showLogo && data.logoUrl && !data.omitLogoPlaceholder && !safeLogo) {
    lines.push(clipLine('[Logo]', lineWidth));
  }

  lines.push(separator);
  lines.push(clipLine('ORDRE DE DECAISSEMENT', lineWidth));
  lines.push(separator);

  if (data.isTest && (data.previewSampleBody || '').trim()) {
    for (const raw of (data.previewSampleBody || '').split('\n')) {
      const s = raw.trimEnd();
      if (s) lines.push(clipLine(s, lineWidth));
    }
    lines.push(separator);
  } else {
    if (data.entryId != null) {
      lines.push(clipLine(`N°: ${data.entryId}`, lineWidth));
    }
    const dateLabel = data.entryDate?.trim()
      ? data.entryDate.trim()
      : formatYmd(new Date());
    lines.push(clipLine(`Date: ${dateLabel}`, lineWidth));
    if (data.preparedBy) {
      lines.push(clipLine(`Préparé par: ${data.preparedBy}`, lineWidth));
    }
    lines.push(separator);
    lines.push(clipLine(`Libellé: ${data.description ?? '—'}`, lineWidth));
    const detail = (data.detail ?? '').trim();
    if (detail) lines.push(clipLine(`Détail: ${detail}`, lineWidth));
    lines.push(clipLine(`Montant: ${formatMoneyCompact(data.amount ?? 0)}`, lineWidth));
    lines.push(separator);
  }

  lines.push(clipLine('Signatures', lineWidth));
  lines.push('');
  lines.push(clipLine('Ordonnateur:', lineWidth));
  lines.push(clipLine('_'.repeat(Math.min(lineWidth, 28)), lineWidth));
  lines.push('');
  lines.push(clipLine('Exécutant:', lineWidth));
  lines.push(clipLine('_'.repeat(Math.min(lineWidth, 28)), lineWidth));
  lines.push('');
  lines.push(clipLine('Bénéficiaire:', lineWidth));
  lines.push(clipLine('_'.repeat(Math.min(lineWidth, 28)), lineWidth));

  const footerRaw = (data.footerText || '').trim();
  if (footerRaw) {
    lines.push(separator);
    for (const line of footerRaw.split('\n')) {
      const s = line.trim();
      if (s) lines.push(clipLine(s, lineWidth));
    }
  }

  if (data.isTest) {
    lines.push(separator);
    lines.push(clipLine(`Test · ${formatDateTime(new Date())}`, lineWidth));
  }

  return lines.join('\n');
}
