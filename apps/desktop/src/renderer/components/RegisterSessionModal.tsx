import type { RegisterSessionDetail } from '../types/api';
import { formatDateTime } from '../utils/datetime';
import { formatMoney } from '../utils/currency';
import { formatQuantity } from '../utils/formatQuantity';
import { formatRegisterCode } from '../utils/registerDisplay';
import { formatUserLabel } from '../utils/userAttribution';

type Props = {
  session: RegisterSessionDetail | null;
  onClose: () => void;
};

function inventoryVarianceLines(session: RegisterSessionDetail) {
  const lines = session.closingInventorySession?.lines ?? session.openingInventorySession.lines;
  return lines.filter((l) => {
    if (l.countedQty == null) return false;
    const system = Number(l.systemQtyAtOpen);
    const counted = Number(l.countedQty);
    return Math.abs(system - counted) > 1e-9;
  });
}

export function RegisterSessionModal({ session, onClose }: Props) {
  if (!session) return null;

  const variances = inventoryVarianceLines(session);
  const inventoryTitle = session.closingInventorySession ? 'Écarts à la fermeture' : 'Comptage à l’ouverture';

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card modal-purchasing"
        role="dialog"
        aria-modal
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="modal-heading"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}
        >
          <h2 style={{ margin: 0 }}>
            Session {formatRegisterCode(session.register.code)} ·{' '}
            {session.status === 'OPEN' ? 'Ouverte' : 'Fermée'}
          </h2>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            ×
          </button>
        </div>

        <dl className="form-grid" style={{ margin: '0 0 0.75rem', gridTemplateColumns: 'auto 1fr', gap: '0.35rem 1rem' }}>
          <dt>Département</dt>
          <dd style={{ margin: 0 }}>{session.department.name}</dd>
          <dt>Ouverture</dt>
          <dd style={{ margin: 0 }}>
            {formatDateTime(session.openedAt)} — {formatUserLabel(session.openedBy)}
          </dd>
          <dt>Fermeture</dt>
          <dd style={{ margin: 0 }}>
            {session.closedAt
              ? `${formatDateTime(session.closedAt)} — ${formatUserLabel(session.closedBy)}`
              : '—'}
          </dd>
          <dt>Fond ouverture</dt>
          <dd style={{ margin: 0 }}>
            {session.openingCashAmount != null ? formatMoney(Number(session.openingCashAmount)) : '—'}
          </dd>
          <dt>Espèces attendues</dt>
          <dd style={{ margin: 0 }}>
            {session.closingCashExpected != null ? formatMoney(Number(session.closingCashExpected)) : '—'}
          </dd>
          <dt>Espèces comptées</dt>
          <dd style={{ margin: 0 }}>
            {session.closingCashCounted != null ? formatMoney(Number(session.closingCashCounted)) : '—'}
          </dd>
          <dt>Écart espèces</dt>
          <dd style={{ margin: 0 }}>
            {session.cashVariance != null ? formatMoney(Number(session.cashVariance)) : '—'}
          </dd>
        </dl>

        <h3 style={{ fontSize: '1rem', margin: '0 0 0.5rem' }}>{inventoryTitle}</h3>
        {variances.length === 0 ? (
          <p className="dept-hint" style={{ marginTop: 0 }}>
            Aucun écart enregistré.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Produit</th>
                  <th>Système</th>
                  <th>Compté</th>
                  <th>Écart</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {variances.map((l) => {
                  const system = Number(l.systemQtyAtOpen);
                  const counted = Number(l.countedQty);
                  return (
                    <tr key={l.id}>
                      <td>{l.product.name}</td>
                      <td className="journal-amt">{formatQuantity(system)}</td>
                      <td className="journal-amt">{formatQuantity(counted)}</td>
                      <td className="journal-amt">{formatQuantity(counted - system)}</td>
                      <td>{l.note?.trim() || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="modal-actions" style={{ marginTop: '0.75rem' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
