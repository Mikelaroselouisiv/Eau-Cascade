const { BrowserWindow, nativeImage } = require('electron');

/** Fuseau métier unique — Port-au-Prince. */
const APP_TIMEZONE = 'America/Port-au-Prince';

/** Largeur utile approximative en points pour raster ESC/POS (58 / 80 mm). */
const RASTER_DOTS_58 = 384;
const RASTER_DOTS_80 = 576;

const ESC_ALIGN_LEFT = Buffer.from([0x1b, 0x61, 0x00]);

function formatDateTimePap(value) {
  const d = value instanceof Date ? value : new Date(value ?? Date.now());
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

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(2)} HTG`;
}

function clipLine(text, lineWidth) {
  const t = String(text ?? '');
  return t.length <= lineWidth ? t : t.slice(0, lineWidth - 1) + '…';
}

/**
 * Ticket entier en une seule chaîne, alignement gauche partout (même logique pour en-tête, adresse, articles).
 * @param {Record<string, unknown>} saleData
 * @param {number} width
 */
function buildTicketText(saleData, width = 58) {
  if (saleData.documentType === 'DISBURSEMENT_ORDER') {
    return buildDisbursementOrderText(saleData, width);
  }
  const lineWidth = width === 80 ? 48 : 32;
  const separator = '-'.repeat(lineWidth);
  const date = saleData.dateTime ?? formatDateTimePap(new Date());
  const lines = [];

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
  if (phone) {
    lines.push(clipLine(`Tél: ${phone}`, lineWidth));
  }

  if (
    saleData.showLogoOnReceipt &&
    saleData.receiptLogoUrl &&
    !saleData.omitLogoPlaceholder
  ) {
    lines.push(clipLine('[Logo sur ticket]', lineWidth));
  }

  lines.push(separator);
  if (saleData.saleId != null && saleData.saleId !== '') {
    // Même numéro que la carte « Livraisons » (sale.txnNumber métier).
    lines.push(clipLine(`Vente #${saleData.saleId}`, lineWidth));
  }
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
    lines.push(`TOTAL TEST: ${formatMoney(saleData.total ?? 0)}`);
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
    lines.push(`TOTAL: ${formatMoney(saleData.total ?? 0)}`);
    if (saleData.amountReceived != null && saleData.amountReceived !== '') {
      lines.push(clipLine(`Reçu: ${formatMoney(saleData.amountReceived)}`, lineWidth));
    }
    const changeDue = Number(saleData.changeDue ?? 0);
    const balanceDue = Number(saleData.balanceDue ?? 0);
    if (changeDue > 0.009) {
      lines.push(clipLine(`Monnaie due: ${formatMoney(changeDue)}`, lineWidth));
    }
    if (balanceDue > 0.009) {
      lines.push(clipLine(`Reste à payer: ${formatMoney(balanceDue)}`, lineWidth));
    }
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

/**
 * Ordre de décaissement (dépenses) — 3 zones de signature.
 * @param {Record<string, unknown>} data
 * @param {number} width
 */
function buildDisbursementOrderText(data, width = 58) {
  const lineWidth = width === 80 ? 48 : 32;
  const separator = '-'.repeat(lineWidth);
  const lines = [];

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
  if (phone) lines.push(clipLine(`Tél: ${phone}`, lineWidth));

  if (data.showLogoOnReceipt && data.receiptLogoUrl && !data.omitLogoPlaceholder) {
    lines.push(clipLine('[Logo]', lineWidth));
  }

  lines.push(separator);
  lines.push(clipLine('ORDRE DE DECAISSEMENT', lineWidth));
  lines.push(separator);

  const isTest = !!data.isTest;
  const sampleBody = (data.previewSampleBody || '').trim();

  if (isTest && sampleBody) {
    for (const raw of sampleBody.split('\n')) {
      const s = raw.trimEnd();
      if (s) lines.push(clipLine(s, lineWidth));
    }
    lines.push(separator);
  } else {
    if (data.entryId != null) {
      lines.push(clipLine(`N°: ${data.entryId}`, lineWidth));
    }
    const dateLabel = String(data.entryDate || data.dateTime || formatDateTimePap(new Date()));
    lines.push(clipLine(`Date: ${dateLabel}`, lineWidth));
    const prepared = String(data.preparedBy || data.cashier || '').trim();
    if (prepared) lines.push(clipLine(`Préparé par: ${prepared}`, lineWidth));
    lines.push(separator);
    lines.push(clipLine(`Libellé: ${data.description ?? '—'}`, lineWidth));
    const detail = String(data.detail ?? '').trim();
    if (detail) lines.push(clipLine(`Détail: ${detail}`, lineWidth));
    lines.push(clipLine(`Montant: ${formatMoney(data.amount ?? data.total ?? 0)}`, lineWidth));
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

  const footerRaw = (data.receiptFooterText || '').trim();
  if (footerRaw) {
    lines.push(separator);
    for (const line of footerRaw.split('\n')) {
      const s = line.trim();
      if (s) lines.push(clipLine(s, lineWidth));
    }
  }

  lines.push('\n\n');
  return lines.join('\n');
}

function u16le(n) {
  return Buffer.from([n & 0xff, (n >> 8) & 0xff]);
}

/**
 * Bitmap ESC/POS (Epson GS v 0, mode 0). Retourne null si image illisible.
 * @param {string} dataUrl
 * @param {number} maxWidthDots
 * @returns {Buffer | null}
 */
function escPosRasterFromDataUrl(dataUrl, maxWidthDots) {
  if (!dataUrl || !String(dataUrl).startsWith('data:image')) return null;
  try {
    const img = nativeImage.createFromDataURL(dataUrl);
    if (!img || img.isEmpty()) return null;
    let { width: w, height: h } = img.getSize();
    if (w < 1 || h < 1) return null;
    const targetW = Math.min(maxWidthDots, w);
    const targetH = Math.max(1, Math.round((h * targetW) / w));
    const resized = img.resize({ width: targetW, height: targetH, quality: 'good' });
    const { width, height } = resized.getSize();
    const bitmap = resized.toBitmap();
    const bpp = Math.round(bitmap.length / (width * height));
    if (bpp !== 4 || bitmap.length < width * height * 4) return null;

    const bytesPerRow = Math.ceil(width / 8);
    const rows = Buffer.alloc(bytesPerRow * height);

    for (let y = 0; y < height; y++) {
      for (let byteCol = 0; byteCol < bytesPerRow; byteCol++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = byteCol * 8 + bit;
          let gray = 255;
          if (x < width) {
            const idx = (y * width + x) * 4;
            const b0 = bitmap[idx];
            const g0 = bitmap[idx + 1];
            const r0 = bitmap[idx + 2];
            const a0 = bitmap[idx + 3];
            if (a0 < 140) gray = 255;
            else gray = (r0 + g0 + b0) / 3;
          }
          const black = gray < 168;
          if (black) byte |= 1 << (7 - bit);
        }
        rows[y * bytesPerRow + byteCol] = byte;
      }
    }

    return Buffer.concat([
      Buffer.from([0x1d, 0x76, 0x30, 0x00]),
      u16le(bytesPerRow),
      u16le(height),
      rows,
    ]);
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, unknown>} saleData
 * @param {number} width
 */
function buildEscPosPayload(saleData, width = 58) {
  const maxDots = width === 80 ? RASTER_DOTS_80 : RASTER_DOTS_58;
  const init = Buffer.from([0x1b, 0x40]);
  const parts = [init, ESC_ALIGN_LEFT];

  const logoUrl = String(saleData.receiptLogoUrl || '');
  const wantLogo = saleData.showLogoOnReceipt && logoUrl.startsWith('data:image');
  let textData = { ...saleData };

  if (wantLogo) {
    const raster = escPosRasterFromDataUrl(logoUrl, maxDots);
    if (raster) {
      parts.push(raster);
      parts.push(Buffer.from([0x0a]));
      textData = { ...saleData, omitLogoPlaceholder: true };
    }
  }

  // Double hauteur pour une meilleure lisibilité des noms / montants.
  parts.push(Buffer.from([0x1d, 0x21, 0x01]));
  parts.push(Buffer.from(buildTicketText(textData, width), 'utf8'));
  parts.push(Buffer.from([0x1d, 0x21, 0x00]));
  parts.push(Buffer.from([0x1d, 0x56, 0x00]));
  return Buffer.concat(parts);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * HTML pour fallback Windows GDI.
 * Important : pas de @page size / pageSize Electron en microns — les pilotes
 * thermiques Windows décalent alors le contenu (marge blanche + texte collé sur un bord).
 * On laisse le format papier configuré dans Windows, et on remplit 100 % de la largeur.
 * @param {Record<string, unknown>} saleData
 */
function buildReceiptHtml(saleData) {
  const width = saleData.paperWidth === 80 ? 80 : 58;
  const logoUrl = String(saleData.receiptLogoUrl || '');
  const safeLogo =
    saleData.showLogoOnReceipt && logoUrl.startsWith('data:image') ? logoUrl : '';
  const textData = { ...saleData, omitLogoPlaceholder: !!safeLogo };
  const fullText = buildTicketText(textData, width).replace(/\n{3,}$/g, '\n\n');
  // ~32 car. à 58 mm / ~48 à 80 mm : police un peu plus petite pour tenir dans la largeur pilote.
  const fontPt = width === 80 ? 10 : 9;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @page { margin: 0; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      background: #fff;
    }
    body {
      font-family: "Consolas", "Courier New", monospace;
      font-size: ${fontPt}pt;
      line-height: 1.25;
      padding: 0;
      text-align: left;
    }
    img.logo {
      max-width: 100%;
      width: auto;
      max-height: ${width === 80 ? 90 : 70}px;
      display: block;
      margin: 0 0 4px 0;
    }
    pre.ticket {
      margin: 0;
      padding: 0;
      width: 100%;
      font-family: inherit;
      font-size: inherit;
      line-height: inherit;
      white-space: pre-wrap;
      word-wrap: break-word;
      overflow-wrap: anywhere;
      text-align: left;
    }
  </style></head><body>${
    safeLogo ? `<img class="logo" src="${safeLogo}" alt="" />` : ''
  }<pre class="ticket">${escapeHtml(fullText)}</pre></body></html>`;
}

function printWithOptions(win, options) {
  return new Promise((resolve) => {
    try {
      win.webContents.print(options, (success, failureReason) => {
        resolve({
          ok: !!success,
          reason: failureReason || (!success ? 'Unknown print error' : undefined),
        });
      });
    } catch (err) {
      resolve({
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

/** Interfaces ESC/POS possibles sous Windows (raw). */
function escPosInterfaces(printerName) {
  const name = String(printerName || '').trim();
  if (!name) return [''];
  const list = [];
  if (name.startsWith('printer:') || name.includes('COM') || name.startsWith('tcp://')) {
    list.push(name);
  } else {
    list.push(`printer:${name}`);
    list.push(name);
  }
  return list;
}

async function tryEscPosPrint(saleData, width) {
  // eslint-disable-next-line global-require, import/no-extraneous-dependencies
  const { printer: ThermalPrinter, types } = require('node-thermal-printer');
  const payload = buildEscPosPayload(saleData, width);
  const doCut = saleData.autoCut !== false;
  let lastErr = null;
  for (const iface of escPosInterfaces(saleData.printerName)) {
    try {
      const printer = new ThermalPrinter({
        type: types.EPSON,
        interface: iface,
        options: { timeout: 2500 },
      });
      const isConnected = await printer.isPrinterConnected();
      if (!isConnected) continue;
      await printer.raw(payload);
      if (doCut) {
        try {
          await printer.cut();
        } catch {
          /* cut optionnelle */
        }
      }
      return { ok: true, mode: 'escpos' };
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr;
  throw new Error('Printer not available');
}

async function printReceipt(saleData) {
  const width = saleData.paperWidth === 80 ? 80 : 58;

  // 1) ESC/POS raw si l’imprimante l’accepte.
  try {
    return await tryEscPosPrint(saleData, width);
  } catch {
    // Fall through — la plupart des imprimantes Windows POS passent par GDI.
  }

  // 2) Fallback Windows GDI (sans pageSize custom).
  let fallbackWindow = null;
  try {
    fallbackWindow = new BrowserWindow({
      show: false,
      width: width === 80 ? 360 : 280,
      height: 900,
      webPreferences: { sandbox: true },
    });
    const html = buildReceiptHtml(saleData);
    await fallbackWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await new Promise((r) => setTimeout(r, 250));

    const deviceName = String(saleData.printerName || '').trim();
    const base = {
      silent: true,
      printBackground: true,
      margins: { marginType: 'none' },
      landscape: false,
    };
    const attempts = [
      { ...base, deviceName },
      // Sans deviceName → imprimante par défaut Windows
      { ...base },
    ];

    let lastReason = 'Unknown print error';
    for (const opts of attempts) {
      const result = await printWithOptions(fallbackWindow, opts);
      if (result.ok) {
        fallbackWindow.close();
        return {
          ok: true,
          mode: 'fallback',
          ticketText: buildTicketText(saleData, width),
        };
      }
      lastReason = result.reason || lastReason;
    }

    fallbackWindow.close();
    return {
      ok: false,
      mode: 'fallback',
      reason: lastReason,
      ticketText: buildTicketText(saleData, width),
    };
  } catch (err) {
    try {
      fallbackWindow?.close();
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      mode: 'fallback',
      reason: err instanceof Error ? err.message : String(err),
      ticketText: buildTicketText(saleData, width),
    };
  }
}

module.exports = { printReceipt, buildTicketText, buildReceiptHtml };
