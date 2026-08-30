import { useEffect, useState } from 'react';
import axios from 'axios';
import {
  addDeliveryDrop,
  confirmInternalTransfer,
  createInternalTransfer,
  getDeliveryById,
  listDeliveries,
  listInternalTransfers,
  rejectInternalTransfer,
} from '../services/api';
import type {
  Delivery,
  DeliveryItem,
  Department,
  InternalTransferRow,
  Product,
} from '../types/api';
import { formatQuantity } from '../utils/formatQuantity';
import { formatDateTimeShort } from '../utils/datetime';
import { saleTxnNumber } from '../utils/saleTxnNumber';

type Dest = 'ON_SITE' | 'HOME' | 'TRANSFER';

const STATUS_LABEL: Record<Delivery['status'], string> = {
  PENDING: 'Non livré',
  PARTIAL: 'Partiel',
  DELIVERED: 'Livré',
};

function errMsg(err: unknown, fallback: string) {
  if (axios.isAxiosError(err) && err.response?.data && typeof err.response.data === 'object') {
    const m = (err.response.data as { message?: unknown }).message;
    if (Array.isArray(m)) return m.join(', ');
    if (typeof m === 'string' && m.trim()) return m;
  }
  return fallback;
}

function remainingOf(it: DeliveryItem): number {
  return Number(
    it.quantityRemaining ?? Math.max(0, Number(it.quantityOrdered) - Number(it.quantityDelivered)),
  );
}

function itemLabel(it: DeliveryItem): string {
  return it.saleItem?.lineLabel || it.saleItem?.product?.name || 'Article';
}

function belongsToPlant(d: Delivery, plantId: number): boolean {
  if (d.departmentId === plantId) return true;
  const ids = (d.items ?? []).map((it) => it.saleItem?.product?.departmentId);
  if (ids.some((id) => id === plantId)) return true;
  if (d.departmentId == null && ids.every((id) => id == null)) return true;
  return false;
}

function isHomeDelivery(d: Delivery) {
  return d.fulfillmentType === 'HOME' || d.sale?.fulfillmentType === 'HOME';
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
  executorDefault,
  onRefuseClosed,
  onMessage,
}: Props) {
  const [dest, setDest] = useState<Dest>(canManageDeliveries ? 'ON_SITE' : 'TRANSFER');
  const [fiches, setFiches] = useState<Delivery[]>([]);
  const [selected, setSelected] = useState<Delivery | null>(null);
  const [dropSaleItemId, setDropSaleItemId] = useState<number | ''>('');
  const [dropQty, setDropQty] = useState('');
  const [dropExecutor, setDropExecutor] = useState(executorDefault);
  const [dropStopId, setDropStopId] = useState<number | ''>('');
  const [toDepartmentId, setToDepartmentId] = useState<number | ''>('');
  const [transferQty, setTransferQty] = useState<Record<number, string>>({});
  const [outgoing, setOutgoing] = useState<InternalTransferRow[]>([]);
  const [inbox, setInbox] = useState<InternalTransferRow[]>([]);
  const [busy, setBusy] = useState(false);

  function applyFiche(d: Delivery) {
    setSelected(d);
    const remainingItem = (d.items ?? []).find((it) => remainingOf(it) > 0.0001);
    setDropSaleItemId(remainingItem?.saleItemId ?? d.items?.[0]?.saleItemId ?? '');
    setDropQty(remainingItem ? String(remainingOf(remainingItem)) : '');
    setDropExecutor(d.executorName?.trim() || executorDefault);
    const stops = d.sale?.deliveryStops ?? [];
    const remainingStop = stops.find((s) => Number(s.quantityRemaining ?? s.quantity) > 0.0001);
    setDropStopId(remainingStop?.id ?? stops[0]?.id ?? '');
  }

  useEffect(() => {
    setSelected(null);
    if (dest === 'TRANSFER') {
      setFiches([]);
      void listInternalTransfers({ fromDepartmentId: departmentId })
        .then(setOutgoing)
        .catch(() => setOutgoing([]));
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
          dest === 'HOME'
            ? rows
            : rows.filter((d) => belongsToPlant(d, departmentId)),
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

  async function addLine() {
    if (!selected) return;
    if (!productionEnabled) {
      onRefuseClosed();
      return;
    }
    if (dropSaleItemId === '') {
      onMessage('Choisissez un article');
      return;
    }
    const qty = Number(String(dropQty).replace(',', '.'));
    if (!Number.isFinite(qty) || qty <= 0) {
      onMessage('Quantité invalide');
      return;
    }
    if (isHomeDelivery(selected) && !dropExecutor.trim()) {
      onMessage('Indiquez le livreur');
      return;
    }
    setBusy(true);
    try {
      await addDeliveryDrop(selected.id, {
        saleItemId: dropSaleItemId,
        quantity: qty,
        departmentId,
        ...(isHomeDelivery(selected)
          ? {
              executorName: dropExecutor.trim(),
              stopId: dropStopId === '' ? undefined : dropStopId,
            }
          : {}),
      });
      const next = await getDeliveryById(selected.id);
      onMessage('Livraison enregistrée.');
      if (next.status === 'DELIVERED') {
        setSelected(null);
        setFiches((prev) => prev.filter((d) => d.id !== next.id));
      } else {
        applyFiche(next);
        setFiches((prev) => prev.map((d) => (d.id === next.id ? next : d)));
      }
    } catch (e) {
      onMessage(errMsg(e, 'Livraison impossible.'));
    } finally {
      setBusy(false);
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
        </div>

        {dest === 'TRANSFER' && canTransfer ? (
          <>
            <label>
              Destinataire
              <select
                value={toDepartmentId}
                disabled={!productionEnabled}
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
                  disabled={!productionEnabled}
                  value={transferQty[p.id] ?? ''}
                  onChange={(e) => setTransferQty((prev) => ({ ...prev, [p.id]: e.target.value }))}
                />
              </label>
            ))}
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
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

        {dest !== 'TRANSFER' && canManageDeliveries ? (
          <>
            {fiches.length === 0 ? (
              <p className="muted">Aucune fiche</p>
            ) : (
              <ul className="delivery-lines" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {fiches.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        marginBottom: 4,
                        fontWeight: selected?.id === d.id ? 700 : 500,
                      }}
                      onClick={() => applyFiche(d)}
                    >
                      Vente #{d.saleRef ?? (d.sale ? saleTxnNumber(d.sale) : d.saleId)}
                      {' · '}
                      {d.sale?.clientName?.trim() || 'Client'}
                      {' · '}
                      {STATUS_LABEL[d.status]}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {selected ? (
              <div style={{ marginTop: 12 }}>
                <ul className="delivery-line-list" style={{ paddingLeft: 0, listStyle: 'none' }}>
                  {(selected.items ?? []).map((it) => (
                    <li key={it.id} className="delivery-line">
                      <div className="delivery-line-label">
                        <span>{itemLabel(it)}</span>
                        <span className="delivery-muted">
                          Reste {formatQuantity(remainingOf(it))}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
                {selected.status !== 'DELIVERED' ? (
                  <div className="delivery-add-line">
                    <label>
                      Article
                      <select
                        value={dropSaleItemId === '' ? '' : String(dropSaleItemId)}
                        onChange={(e) =>
                          setDropSaleItemId(e.target.value ? Number(e.target.value) : '')
                        }
                        disabled={busy || !productionEnabled}
                      >
                        {(selected.items ?? []).map((it) => (
                          <option
                            key={it.id}
                            value={it.saleItemId}
                            disabled={remainingOf(it) <= 0.0001}
                          >
                            {itemLabel(it)} ({formatQuantity(remainingOf(it))})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Quantité
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={dropQty}
                        onChange={(e) => setDropQty(e.target.value)}
                        disabled={busy || !productionEnabled}
                      />
                    </label>
                    {isHomeDelivery(selected) ? (
                      <label>
                        Livreur
                        <input
                          type="text"
                          value={dropExecutor}
                          maxLength={120}
                          onChange={(e) => setDropExecutor(e.target.value)}
                          disabled={busy || !productionEnabled}
                        />
                      </label>
                    ) : null}
                    {isHomeDelivery(selected) &&
                    (selected.sale?.deliveryStops?.length ?? 0) > 0 ? (
                      <label>
                        Adresse
                        <select
                          value={dropStopId === '' ? '' : String(dropStopId)}
                          onChange={(e) =>
                            setDropStopId(e.target.value ? Number(e.target.value) : '')
                          }
                          disabled={busy || !productionEnabled}
                        >
                          {(selected.sale?.deliveryStops ?? []).map((st) => (
                            <option key={st.id} value={st.id}>
                              {st.address} (
                              {formatQuantity(Number(st.quantityRemaining ?? st.quantity))})
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() => void addLine()}
                    >
                      Livrer
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      {canConfirm && inbox.length > 0 ? (
        <section className="card">
          <h2>À confirmer</h2>
          {inbox.map((t) => (
            <div key={t.id} className="credit-cart-line">
              <span>
                {t.fromDepartment.name} → {t.toDepartment.name}
                <small className="muted" style={{ display: 'block' }}>
                  {t.items.map((i) => `${i.product.name} ${formatQuantity(i.quantity)}`).join(', ')}
                </small>
              </span>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() =>
                  void confirmInternalTransfer(t.id).then(() =>
                    setInbox((prev) => prev.filter((x) => x.id !== t.id)),
                  )
                }
              >
                Confirmer
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  void rejectInternalTransfer(t.id).then(() =>
                    setInbox((prev) => prev.filter((x) => x.id !== t.id)),
                  )
                }
              >
                Refuser
              </button>
            </div>
          ))}
        </section>
      ) : null}
    </>
  );
}
