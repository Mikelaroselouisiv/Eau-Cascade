import { useEffect, useState } from 'react';
import axios from 'axios';
import {
  createInternalTransfer,
  getDeliveryById,
  listDeliveries,
  listInternalTransfers,
} from '../services/api';
import type { Delivery, Department, InternalTransferRow, Product } from '../types/api';
import { formatDateTimeShort } from '../utils/datetime';
import { DeliveryFicheCard } from './DeliveryFicheCard';
import { DeliveryFicheModal } from './DeliveryFicheModal';
import { TransferInboxPanel } from './TransferInboxPanel';

type Dest = 'ON_SITE' | 'HOME' | 'TRANSFER' | 'RECEIVE';

function errMsg(err: unknown, fallback: string) {
  if (axios.isAxiosError(err) && err.response?.data && typeof err.response.data === 'object') {
    const m = (err.response.data as { message?: unknown }).message;
    if (Array.isArray(m)) return m.join(', ');
    if (typeof m === 'string' && m.trim()) return m;
  }
  return fallback;
}

function belongsToPlant(d: Delivery, plantId: number): boolean {
  if (d.departmentId === plantId) return true;
  const ids = (d.items ?? []).map((it) => it.saleItem?.product?.departmentId);
  if (ids.some((id) => id === plantId)) return true;
  if (d.departmentId == null && ids.every((id) => id == null)) return true;
  return false;
}

type Props = {
  departmentId: number;
  companyId?: number;
  productionEnabled: boolean;
  products: Product[];
  scopedDepts: Department[];
  canTransfer: boolean;
  canConfirm: boolean;
  canManageDeliveries: boolean;
  canPrint?: boolean;
  executorDefault: string;
  onRefuseClosed: () => void;
  onMessage: (msg: string) => void;
};

export function ProductionOutflowSection({
  departmentId,
  companyId,
  productionEnabled,
  products,
  scopedDepts,
  canTransfer,
  canConfirm,
  canManageDeliveries,
  canPrint = false,
  executorDefault,
  onRefuseClosed,
  onMessage,
}: Props) {
  const [dest, setDest] = useState<Dest>(
    canManageDeliveries ? 'ON_SITE' : canConfirm ? 'RECEIVE' : 'TRANSFER',
  );
  const [fiches, setFiches] = useState<Delivery[]>([]);
  const [selected, setSelected] = useState<Delivery | null>(null);
  const [toDepartmentId, setToDepartmentId] = useState<number | ''>('');
  const [transferQty, setTransferQty] = useState<Record<number, string>>({});
  const [outgoing, setOutgoing] = useState<InternalTransferRow[]>([]);
  const [inbox, setInbox] = useState<InternalTransferRow[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSelected(null);
    if (dest === 'TRANSFER') {
      setFiches([]);
      void listInternalTransfers({ fromDepartmentId: departmentId })
        .then(setOutgoing)
        .catch(() => setOutgoing([]));
      return;
    }
    if (dest === 'RECEIVE') {
      setFiches([]);
      return;
    }
    void (dest === 'HOME'
      ? listDeliveries({
          ...(companyId != null ? { companyId } : {}),
          fulfillmentType: 'HOME',
          take: 100,
        })
      : listDeliveries({
          ...(companyId != null ? { companyId } : {}),
          departmentId,
          fulfillmentType: dest,
          take: 100,
        })
    )
      .then((res) => {
        const rows = res.items.filter((d) => d.status !== 'DELIVERED');
        setFiches(
          dest === 'HOME' ? rows : rows.filter((d) => belongsToPlant(d, departmentId)),
        );
      })
      .catch(() => setFiches([]));
  }, [departmentId, dest, companyId]);

  useEffect(() => {
    if (!canConfirm) {
      setInbox([]);
      return;
    }
    void listInternalTransfers({ inbox: true, status: 'PENDING' })
      .then(setInbox)
      .catch(() => setInbox([]));
  }, [departmentId, canConfirm]);

  async function openFiche(d: Delivery) {
    try {
      const full = await getDeliveryById(d.id);
      setSelected(full);
    } catch (e) {
      onMessage(errMsg(e, 'Impossible d’ouvrir la fiche'));
    }
  }

  async function sendTransfer() {
    if (!productionEnabled) {
      onRefuseClosed();
      return;
    }
    if (toDepartmentId === '') return;
    const items = products
      .map((p) => ({ productId: p.id, quantity: Number(transferQty[p.id] ?? 0) }))
      .filter((i) => i.quantity > 0);
    if (!items.length) {
      onMessage('Indiquez une quantité.');
      return;
    }
    setBusy(true);
    try {
      await createInternalTransfer({
        fromDepartmentId: departmentId,
        toDepartmentId,
        items,
      });
      setTransferQty({});
      onMessage('Livraison interne enregistrée.');
      setOutgoing(await listInternalTransfers({ fromDepartmentId: departmentId }));
    } catch (e) {
      onMessage(errMsg(e, 'Envoi impossible.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Écoulement</h2>
        <div className="pos-sale-mode" style={{ marginBottom: 12 }}>
          {canManageDeliveries ? (
            <>
              <button
                type="button"
                className={`pos-sale-mode-btn${dest === 'ON_SITE' ? ' active' : ''}`}
                onClick={() => setDest('ON_SITE')}
              >
                Sur place
              </button>
              <button
                type="button"
                className={`pos-sale-mode-btn${dest === 'HOME' ? ' active' : ''}`}
                onClick={() => setDest('HOME')}
              >
                Domicile
              </button>
            </>
          ) : null}
          {canTransfer ? (
            <button
              type="button"
              className={`pos-sale-mode-btn${dest === 'TRANSFER' ? ' active' : ''}`}
              onClick={() => setDest('TRANSFER')}
            >
              Autre département
            </button>
          ) : null}
          {canConfirm ? (
            <button
              type="button"
              className={`pos-sale-mode-btn${dest === 'RECEIVE' ? ' active' : ''}`}
              onClick={() => setDest('RECEIVE')}
            >
              Réceptions{inbox.length ? ` (${inbox.length})` : ''}
            </button>
          ) : null}
        </div>

        {dest === 'RECEIVE' && canConfirm ? <TransferInboxPanel inbox={inbox} onChange={setInbox} /> : null}

        {dest === 'TRANSFER' && canTransfer ? (
          <>
            <label>
              Destinataire
              <select
                value={toDepartmentId}
                onChange={(e) => setToDepartmentId(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">—</option>
                {scopedDepts
                  .filter((d) => d.id !== departmentId)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.kind === 'PRODUCTION_DISTRIBUTION' ? ' · production' : ''}
                    </option>
                  ))}
              </select>
            </label>
            {products.map((p) => (
              <label key={p.id}>
                {p.name}
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={transferQty[p.id] ?? ''}
                  onChange={(e) => setTransferQty((prev) => ({ ...prev, [p.id]: e.target.value }))}
                />
              </label>
            ))}
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || toDepartmentId === ''}
              onClick={() => void sendTransfer()}
            >
              Envoyer
            </button>
            <table className="data-table" style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Destinataire</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {outgoing.map((t) => (
                  <tr key={t.id}>
                    <td>{formatDateTimeShort(t.createdAt)}</td>
                    <td>{t.toDepartment.name}</td>
                    <td>
                      {t.status === 'PENDING'
                        ? 'En attente'
                        : t.status === 'CONFIRMED'
                          ? 'Confirmé'
                          : 'Refusé'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}
      </section>

      {dest !== 'TRANSFER' && dest !== 'RECEIVE' && canManageDeliveries ? (
        fiches.length === 0 ? (
          <p className="delivery-empty">Aucune fiche</p>
        ) : (
          <div className="delivery-grid">
            {fiches.map((d) => (
              <DeliveryFicheCard key={d.id} delivery={d} onOpen={(row) => void openFiche(row)} />
            ))}
          </div>
        )
      ) : null}

      {selected ? (
        <DeliveryFicheModal
          delivery={selected}
          departments={scopedDepts}
          lockDepartmentId={departmentId}
          canManage={canManageDeliveries}
          canPrint={canPrint}
          executeEnabled={productionEnabled}
          executorDefault={executorDefault}
          onDisabledAction={onRefuseClosed}
          onClose={() => setSelected(null)}
          onUpdated={(d) => {
            if (d.status === 'DELIVERED') {
              setFiches((prev) => prev.filter((row) => row.id !== d.id));
              setSelected(null);
            } else {
              setFiches((prev) => prev.map((row) => (row.id === d.id ? d : row)));
              setSelected(d);
            }
          }}
          onMessage={onMessage}
        />
      ) : null}
    </>
  );
}
