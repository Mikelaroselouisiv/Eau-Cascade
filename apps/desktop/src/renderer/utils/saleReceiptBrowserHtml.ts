import { formatDateTime } from './datetime';
import type { Sale } from '../types/api';
import { formatMoney } from './currency';
import { saleTxnNumber } from './saleTxnNumber';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function paymentMethodLabel(method: string): string {
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

/** Aperçu / impression navigateur lorsque l’API Electron (PDF natif) n’est pas dispo. */
export function buildSaleDetailPrintHtml(sale: Sale, companyName?: string): string {
  const lines =
    sale.items?.map((it) => {
      const label = it.lineLabel ?? it.product?.name ?? 'Ligne';
      const qty = Number(it.quantity);
      const unit = Number(it.unitPrice);
      const sub = Number(it.subtotal);
      return `<tr><td>${escapeHtml(label)}</td><td style="text-align:right">${qty}</td><td style="text-align:right">${formatMoney(unit)}</td><td style="text-align:right">${formatMoney(sub)}</td></tr>`;
    }).join('') ?? '';

  const pays =
    sale.payments
      ?.map(
        (p) =>
          `<tr><td>${paymentMethodLabel(String(p.method))}</td><td style="text-align:right">${formatMoney(p.amount)}</td><td>${escapeHtml(p.reference ?? '—')}</td></tr>`,
      )
      .join('') ?? '';

  const client = (sale.clientName && sale.clientName.trim()) || '—';
  const caissier =
    sale.user?.fullName?.trim() ||
    sale.cashier ||
    (sale.user?.phone ? `Tel ${sale.user.phone}` : '—');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>Vente #${saleTxnNumber(sale)}</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 1.2rem; color: #111; }
    h1 { font-size: 1.35rem; margin: 0 0 0.5rem; }
    .meta { font-size: 1.05rem; color: #444; margin-bottom: 1rem; }
    table { width: 100%; border-collapse: collapse; font-size: 1.05rem; }
    th, td { border-bottom: 1px solid #e5e7eb; padding: 0.4rem 0.3rem; text-align: left; }
    th { font-weight: 700; }
    .total { font-weight: 800; font-size: 1.2rem; margin-top: 0.75rem; text-align: right; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <h1>Vente #${saleTxnNumber(sale)}</h1>
  <div class="meta">
    ${companyName ? `<div><strong>Entreprise :</strong> ${escapeHtml(companyName)}</div>` : ''}
    <div><strong>Date :</strong> ${escapeHtml(formatDateTime(sale.createdAt))}</div>
    <div><strong>Client :</strong> ${escapeHtml(client)}</div>
    <div><strong>Caissier :</strong> ${escapeHtml(caissier)}</div>
    <div><strong>Statut :</strong> ${escapeHtml(sale.status)}</div>
  </div>
  <table>
    <thead><tr><th>Article</th><th style="text-align:right">Qté</th><th style="text-align:right">P.U.</th><th style="text-align:right">Sous-total</th></tr></thead>
    <tbody>${lines}</tbody>
  </table>
  <div class="total">Total : ${formatMoney(sale.total)}</div>
  ${
    sale.payments?.length
      ? `<h2 style="font-size:1rem;margin:1rem 0 0.35rem">Paiements</h2>
         <table><thead><tr><th>Mode</th><th style="text-align:right">Montant</th><th>Réf.</th></tr></thead><tbody>${pays}</tbody></table>`
      : ''
  }
  <p style="margin-top:1.5rem;font-size:0.8rem;color:#64748b">Pour enregistrer en PDF : dans la fenêtre d’impression, choisissez « Enregistrer au format PDF ».</p>
</body>
</html>`;
}

export function openBrowserPrintWindow(html: string): void {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  w.onload = () => {
    w.print();
  };
}
