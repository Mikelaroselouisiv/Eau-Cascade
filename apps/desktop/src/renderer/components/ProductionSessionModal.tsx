import type { ProductionFlowRow, ProductionSessionDetail } from '../types/api';
import { formatDateTime } from '../utils/datetime';
import { formatQuantity } from '../utils/formatQuantity';
import { formatUserLabel } from '../utils/userAttribution';

type Props = {
  session: ProductionSessionDetail | null;
  onClose: () => void;
};

const FLOW_LABEL: Record<ProductionFlowRow['kind'], string> = {
  PRODUCED: 'Produit',
  TRANSFER_IN: 'Transfert reçu',
  FLOW_CLIENT: 'Client',
  FLOW_TRANSFER_OUT: 'Transfert sortant',
  FLOW_DONATION: 'Don',
};

export function ProductionSessionModal({ session, onClose }: Props) {
  if (!session) return null;

  const usage = session.usage ?? [];
  const outflow = session.outflow ?? [];
  const flows = session.flows ?? [];
  const closed = session.status === 'CLOSED';

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
            Session production · {session.status === 'OPEN' ? 'Ouverte' : 'Fermée'}
          </h2>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            ×
          </button>
        </div>

        <dl className="form-grid" style={{ margin: '0 0 0.75rem', gridTemplateColumns: 'auto 1fr', gap: '0.35rem 1rem' }}>
          <dt>Département</dt>
          <dd style={{ margin: 0 }}>{session.department?.name ?? '—'}</dd>
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
        </dl>

        {outflow.length > 0 ? (
          <>
            <h3 style={{ fontSize: '1rem', margin: '0 0 0.5rem' }}>Écoulement</h3>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Produit</th>
                    <th>Clients</th>
                    <th>Transferts</th>
                    <th>Dons</th>
                    <th>Écoulé</th>
                  </tr>
                </thead>
                <tbody>
                  {outflow.map((row) => (
                    <tr key={row.productId}>
                      <td>{row.name}</td>
                      <td className="journal-amt">{formatQuantity(row.toClients)}</td>
                      <td className="journal-amt">{formatQuantity(row.toDepartments)}</td>
                      <td className="journal-amt">{formatQuantity(row.toDonations ?? 0)}</td>
                      <td className="journal-amt">{formatQuantity(row.produced)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        <h3 style={{ fontSize: '1rem', margin: outflow.length ? '0.75rem 0 0.5rem' : '0 0 0.5rem' }}>
          Matières premières
        </h3>
        {usage.length === 0 ? (
          <p className="dept-hint" style={{ marginTop: 0 }}>
            Aucune matière première.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Produit</th>
                  <th>Ouvert</th>
                  {closed ? (
                    <>
                      <th>Utilisé</th>
                      <th>Restant</th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {usage.map((row) => (
                  <tr key={row.productId}>
                    <td>{row.name}</td>
                    <td className="journal-amt">{formatQuantity(row.openedQty)}</td>
                    {closed ? (
                      <>
                        <td className="journal-amt">{formatQuantity(row.usedQty)}</td>
                        <td className="journal-amt">{formatQuantity(row.remainingQty)}</td>
                      </>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {closed && flows.length > 0 ? (
          <>
            <h3 style={{ fontSize: '1rem', margin: '0.75rem 0 0.5rem' }}>Détail des flux</h3>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Produit</th>
                    <th>Type</th>
                    <th>Quantité</th>
                  </tr>
                </thead>
                <tbody>
                  {flows.map((f) => (
                    <tr key={f.id}>
                      <td>{f.product.name}</td>
                      <td>{FLOW_LABEL[f.kind]}</td>
                      <td className="journal-amt">{formatQuantity(Number(f.quantity))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        <div className="modal-actions" style={{ marginTop: '0.75rem' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
