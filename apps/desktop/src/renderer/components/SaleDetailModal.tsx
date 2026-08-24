import axios from 'axios';
import { useState } from 'react';
import type { CompanyProfile, DepartmentPrinterSettings, Sale } from '../types/api';
import { exportSalePdf } from '../services/api';
import { formatDateTime } from '../utils/datetime';
import { formatMoney } from '../utils/currency';
import { formatQuantity } from '../utils/formatQuantity';
import { buildSaleDetailPrintHtml, openBrowserPrintWindow } from '../utils/saleReceiptBrowserHtml';
import { buildReceiptPayloadFromSale } from '../utils/receiptPayload';
import { saleTxnNumber } from '../utils/saleTxnNumber';

function formatApiError(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const d = err.response?.data;
    if (typeof d === 'string' && d.trim()) return d;
    if (d && typeof d === 'object') {
      const m = (d as { message?: unknown }).message;
      if (typeof m === 'string') return m;
      if (Array.isArray(m)) return m.join(', ');
      const e = (d as { error?: unknown }).error;
      if (typeof e === 'string') return e;
    }
    if (err.code === 'ERR_NETWORK') {
      return 'Pas de réponse du serveur (réseau ou API arrêtée).';
    }
    if (typeof err.message === 'string' && err.message.trim()) return err.message;
  }
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
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
      return 'À crédit (non encaissé caisse)';
    default:
      return method;
  }
}

function saleStatusLabel(status: Sale['status']): string {
  switch (status) {
    case 'COMPLETED':
      return 'Complétée';
    case 'CANCELLED':
      return 'Annulée';
    case 'REFUNDED':
      return 'Remboursée';
    default:
      return status;
  }
}

export function SaleDetailModal({
  sale,
  companyName,
  company,
  printer,
  canCancelOrRefund = false,
  actionBusy = false,
  onCancelSale,
  onRefundSale,
  onClose,
}: {
  sale: Sale | null;
  companyName?: string;
  company: CompanyProfile | null;
  printer: DepartmentPrinterSettings | null;
  canCancelOrRefund?: boolean;
  actionBusy?: boolean;
  onCancelSale?: (sale: Sale) => void | Promise<void>;
  onRefundSale?: (sale: Sale) => void | Promise<void>;
  onClose: () => void;
}) {
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [receiptMsg, setReceiptMsg] = useState<string | null>(null);

  if (!sale) return null;

  const hasElectronPrint = typeof window.desktopApp?.printReceipt === 'function';
  const busy = receiptBusy || actionBusy;
  const showFinanceActions =
    canCancelOrRefund && sale.status === 'COMPLETED' && (onCancelSale || onRefundSale);

  async function printThermalReceipt() {
    if (!sale) return;
    setReceiptMsg(null);
    setReceiptBusy(true);
    try {
      if (hasElectronPrint) {
        const payload = buildReceiptPayloadFromSale(sale, company, printer);
        const r = await window.desktopApp!.printReceipt!(payload);
        if (!r.ok) {
          setReceiptMsg(r.reason || "L'impression n'a pas pu aboutir.");
        }
      } else {
        const html = buildSaleDetailPrintHtml(sale, companyName);
        openBrowserPrintWindow(html);
      }
    } catch {
      setReceiptMsg('Erreur lors de l’impression.');
    } finally {
      setReceiptBusy(false);
    }
  }

  async function exportPdf() {
    if (!sale) return;
    setReceiptMsg(null);
    setReceiptBusy(true);
    try {
      const blob = await exportSalePdf(sale.id);
      const fileName = `ticket-vente-${sale.id}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setReceiptMsg('Export PDF lancé (téléchargement).');
    } catch (err) {
      setReceiptMsg(formatApiError(err, 'Export PDF impossible.'));
    } finally {
      setReceiptBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card"
        role="dialog"
        aria-modal
        aria-labelledby="sale-detail-title"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 560, width: '100%' }}
      >
        <div className="modal-heading">
          <h2 id="sale-detail-title">Vente #{saleTxnNumber(sale)}</h2>
          <p className="dept-hint" style={{ margin: 0 }}>
            {formatDateTime(sale.createdAt)}
            {companyName ? ` · ${companyName}` : ''}
          </p>
        </div>

        <div className="form-grid" style={{ gap: '0.5rem' }}>
          <p style={{ margin: 0 }}>
            <strong>Client</strong> : {(sale.clientName && sale.clientName.trim()) || '—'}
          </p>
          <p style={{ margin: 0 }}>
            <strong>Caissier</strong> :{' '}
            {sale.user?.fullName?.trim() || sale.cashier || sale.user?.phone || '—'}
          </p>
          <p style={{ margin: 0 }}>
            <strong>Statut</strong> : {saleStatusLabel(sale.status)}
          </p>
        </div>

        <div className="table-wrap" style={{ maxHeight: 280, marginTop: '0.75rem' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Article</th>
                <th>Qté</th>
                <th>P.U. (HTG)</th>
                <th>Sous-total (HTG)</th>
              </tr>
            </thead>
            <tbody>
              {(sale.items ?? []).map((it, idx) => (
                <tr key={idx}>
                  <td>{it.lineLabel ?? it.product?.name ?? '—'}</td>
                  <td>{formatQuantity(Number(it.quantity))}</td>
                  <td className="journal-amt">{formatMoney(it.unitPrice)}</td>
                  <td className="journal-amt">{formatMoney(it.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p style={{ margin: '0.75rem 0 0', fontWeight: 800 }}>
          Total : {formatMoney(sale.total)}
        </p>

        {sale.creditCustomerId != null ? (
          <p className="info-text" style={{ margin: '0.35rem 0 0' }}>
            Vente à crédit — payé {formatMoney(sale.amountPaid ?? 0)} · reste{' '}
            {formatMoney(
              Math.max(0, Number(sale.total) - Number(sale.amountPaid ?? 0)),
            )}{' '}
            (encaissement via board Crédit, hors caisse)
          </p>
        ) : null}

        {sale.payments && sale.payments.length > 0 ? (
          <>
            <h3 style={{ margin: '1rem 0 0.35rem', fontSize: '0.95rem' }}>
              {sale.creditCustomerId != null ? 'Mode de règlement' : 'Paiements'}
            </h3>
            <ul className="simple-list" style={{ marginTop: 0 }}>
              {sale.payments.map((p, i) => (
                <li key={p.id ?? i} className="simple-list-row">
                  <span>{paymentMethodLabel(String(p.method))}</span>
                  <span>{formatMoney(p.amount)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {receiptMsg ? (
          <p className="info-text" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
            {receiptMsg}
          </p>
        ) : null}

        {showFinanceActions ? (
          <div className="sale-finance-actions">
            {onCancelSale ? (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void onCancelSale(sale)}
              >
                Annuler la vente
              </button>
            ) : null}
            {onRefundSale ? (
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => void onRefundSale(sale)}
              >
                Rembourser
              </button>
            ) : null}
          </div>
        ) : null}

        <div
          className="modal-actions"
          style={{ marginTop: '0.75rem', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'flex-end' }}
        >
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Fermer
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void printThermalReceipt()}
            disabled={busy}
          >
            {receiptBusy ? 'Patientez…' : 'Imprimer (ticket caisse)'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void exportPdf()}
            disabled={busy}
          >
            {receiptBusy ? 'Patientez…' : 'Exporter en PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}
