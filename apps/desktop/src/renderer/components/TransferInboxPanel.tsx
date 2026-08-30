import { confirmInternalTransfer, rejectInternalTransfer } from '../services/api';
import type { InternalTransferRow } from '../types/api';
import { formatQuantity } from '../utils/formatQuantity';

export function TransferInboxPanel({
  inbox,
  onChange,
}: {
  inbox: InternalTransferRow[];
  onChange: (rows: InternalTransferRow[]) => void;
}) {
  async function confirm(id: number) {
    await confirmInternalTransfer(id);
    onChange(inbox.filter((x) => x.id !== id));
  }

  async function reject(id: number) {
    await rejectInternalTransfer(id);
    onChange(inbox.filter((x) => x.id !== id));
  }

  if (inbox.length === 0) {
    return <p className="muted">Aucune réception en attente.</p>;
  }

  return (
    <>
      {inbox.map((t) => (
        <div key={t.id} className="credit-cart-line">
          <span>
            {t.fromDepartment.name} → {t.toDepartment.name}
            <small className="muted" style={{ display: 'block' }}>
              {t.items.map((i) => `${i.product.name} ${formatQuantity(i.quantity)}`).join(', ')}
            </small>
          </span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void confirm(t.id)}>
            Confirmer
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void reject(t.id)}>
            Refuser
          </button>
        </div>
      ))}
    </>
  );
}
