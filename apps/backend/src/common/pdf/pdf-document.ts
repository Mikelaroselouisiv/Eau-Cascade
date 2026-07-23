import * as fs from 'fs';
import * as path from 'path';
import { formatDateTimeFr } from './pdf-format';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');

export type PdfDoc = InstanceType<typeof PDFDocument>;

export type PdfBrand = {
  companyName?: string | null;
  logoUrl?: string | null;
  subtitle?: string | null;
};

const COLORS = {
  ink: '#0f172a',
  muted: '#64748b',
  line: '#cbd5e1',
  headerBg: '#f1f5f9',
  accent: '#0f766e',
  white: '#ffffff',
  rowAlt: '#f8fafc',
};

function parseDataUrl(url: string): Buffer | null {
  const m = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/i.exec(url.trim());
  if (!m?.[1]) return null;
  try {
    return Buffer.from(m[1], 'base64');
  } catch {
    return null;
  }
}

/** Charge un logo (data URL, fichier local, ou URL http) pour PDFKit. */
export async function loadLogoBuffer(logoUrl?: string | null): Promise<Buffer | null> {
  if (!logoUrl?.trim()) return null;
  const raw = logoUrl.trim();

  if (raw.startsWith('data:image')) {
    return parseDataUrl(raw);
  }

  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    try {
      const res = await fetch(raw);
      if (!res.ok) return null;
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    } catch {
      return null;
    }
  }

  try {
    const candidates = [
      raw,
      path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw),
      path.join(process.cwd(), 'assets', 'icons', 'icon.png'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        return fs.readFileSync(p);
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function createPdfDoc(opts?: {
  landscape?: boolean;
  margin?: number;
}): PdfDoc {
  return new PDFDocument({
    size: 'A4',
    margin: opts?.margin ?? 42,
    layout: opts?.landscape ? 'landscape' : 'portrait',
    info: {
      Producer: 'POS Entreprise Israel',
      Creator: 'POS Entreprise Israel',
    },
  });
}

export function collectPdfBuffer(doc: PdfDoc): Promise<Buffer> {
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  return new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/**
 * En-tête standard : logo + entreprise + titre + méta, bandeau et trait.
 * Retourne la position Y après l’en-tête.
 */
export async function drawReportHeader(
  doc: PdfDoc,
  opts: {
    title: string;
    brand?: PdfBrand;
    metaLines?: string[];
  },
): Promise<number> {
  const margin = doc.page.margins.left;
  const pageW = doc.page.width;
  const contentW = pageW - margin - doc.page.margins.right;
  const top = doc.page.margins.top;
  const logoSize = 46;

  const logo = await loadLogoBuffer(opts.brand?.logoUrl);
  let textLeft = margin;

  if (logo) {
    try {
      doc.image(logo, margin, top, { fit: [logoSize, logoSize], align: 'center', valign: 'center' });
      textLeft = margin + logoSize + 12;
    } catch {
      /* logo illisible — continuer sans */
    }
  }

  const company = opts.brand?.companyName?.trim() || 'POS Entreprise Israel';
  const headerTextW = contentW - (textLeft - margin);
  doc
    .fillColor(COLORS.accent)
    .font('Helvetica-Bold')
    .fontSize(13)
    .text(company, textLeft, top, { width: headerTextW, lineGap: 1 });

  const titleY = Math.max(doc.y + 4, top + 18);
  doc
    .fillColor(COLORS.ink)
    .font('Helvetica-Bold')
    .fontSize(17)
    .text(opts.title, textLeft, titleY, { width: headerTextW });

  let y = Math.max(top + logoSize, doc.y) + 8;

  if (opts.brand?.subtitle?.trim()) {
    doc
      .fillColor(COLORS.muted)
      .font('Helvetica')
      .fontSize(10)
      .text(opts.brand.subtitle.trim(), margin, y, { width: contentW });
    y = doc.y + 2;
  }

  for (const line of opts.metaLines ?? []) {
    if (!line?.trim()) continue;
    doc
      .fillColor(COLORS.muted)
      .font('Helvetica')
      .fontSize(10)
      .text(line.trim(), margin, y, { width: contentW });
    y = doc.y + 1;
  }

  y += 6;
  doc
    .strokeColor(COLORS.accent)
    .lineWidth(1.5)
    .moveTo(margin, y)
    .lineTo(margin + contentW, y)
    .stroke();

  doc
    .strokeColor(COLORS.line)
    .lineWidth(0.5)
    .moveTo(margin, y + 3)
    .lineTo(margin + contentW, y + 3)
    .stroke();

  y += 14;
  doc.y = y;
  doc.fillColor(COLORS.ink).font('Helvetica').fontSize(11);
  return y;
}

export function drawSectionTitle(doc: PdfDoc, title: string) {
  ensureSpace(doc, 28);
  doc
    .fillColor(COLORS.ink)
    .font('Helvetica-Bold')
    .fontSize(12)
    .text(title, { underline: false });
  const y = doc.y + 2;
  doc
    .strokeColor(COLORS.line)
    .lineWidth(0.6)
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .stroke();
  doc.y = y + 8;
  doc.font('Helvetica').fillColor(COLORS.ink);
}

export type PdfColumn = {
  key: string;
  label: string;
  width: number;
  align?: 'left' | 'right' | 'center';
};

export function drawTableHeader(doc: PdfDoc, columns: PdfColumn[]) {
  ensureSpace(doc, 24);
  const margin = doc.page.margins.left;
  const y = doc.y;
  const h = 20;
  const totalW = columns.reduce((s, c) => s + c.width, 0);

  doc.rect(margin, y, totalW, h).fill(COLORS.headerBg);
  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(10);

  let x = margin;
  for (const col of columns) {
    doc.text(col.label, x + 4, y + 5.5, {
      width: col.width - 8,
      align: col.align ?? 'left',
      lineBreak: false,
    });
    x += col.width;
  }
  doc.y = y + h + 3;
  doc.font('Helvetica').fillColor(COLORS.ink);
}

export function drawTableRow(
  doc: PdfDoc,
  columns: PdfColumn[],
  values: Record<string, string>,
  opts?: { alt?: boolean; fontSize?: number },
) {
  ensureSpace(doc, 18);
  const margin = doc.page.margins.left;
  const y = doc.y;
  const fontSize = opts?.fontSize ?? 10;
  const h = 17;
  const totalW = columns.reduce((s, c) => s + c.width, 0);

  if (opts?.alt) {
    doc.rect(margin, y, totalW, h).fill(COLORS.rowAlt);
  }

  doc.fillColor(COLORS.ink).font('Helvetica').fontSize(fontSize);
  let x = margin;
  for (const col of columns) {
    const text = values[col.key] ?? '';
    doc.text(text, x + 4, y + 4, {
      width: col.width - 8,
      align: col.align ?? 'left',
      lineBreak: false,
      ellipsis: true,
    });
    x += col.width;
  }
  doc.y = y + h;
  doc.fillColor(COLORS.ink);
}

export function drawKeyValueBlock(
  doc: PdfDoc,
  rows: Array<{ label: string; value: string; emphasize?: boolean }>,
) {
  ensureSpace(doc, rows.length * 16 + 8);
  const margin = doc.page.margins.left;
  const labelW = 180;
  const valueW = doc.page.width - margin - doc.page.margins.right - labelW;

  for (const row of rows) {
    const y = doc.y;
    doc
      .fillColor(COLORS.muted)
      .font('Helvetica')
      .fontSize(10)
      .text(row.label, margin, y, { width: labelW });
    doc
      .fillColor(COLORS.ink)
      .font(row.emphasize ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(row.emphasize ? 12 : 10)
      .text(row.value, margin + labelW, y, { width: valueW, align: 'right' });
    doc.y = y + (row.emphasize ? 18 : 15);
  }
  doc.font('Helvetica').fillColor(COLORS.ink);
}

export function drawFooterNote(doc: PdfDoc, note: string) {
  ensureSpace(doc, 36);
  doc.moveDown(0.4);
  doc
    .fillColor(COLORS.muted)
    .font('Helvetica')
    .fontSize(9)
    .text(note, { align: 'left', width: doc.page.width - doc.page.margins.left - doc.page.margins.right });
  doc.fillColor(COLORS.ink);
}

export function ensureSpace(doc: PdfDoc, needed: number) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) {
    doc.addPage();
  }
}

export function generatedMetaLine(extra?: string): string {
  const base = `Généré le ${formatDateTimeFr(new Date())}`;
  return extra?.trim() ? `${base} · ${extra.trim()}` : base;
}
