import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import axios from 'axios';
import {
  createPurchaseOrder,
  deleteGoodsReceipt,
  deletePurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  receivePurchaseOrder,
} from '../services/api';
import type {
  Department,
  Product,
  PurchaseOrderDetail,
  PurchaseOrderListItem,
  ReceptionStatus,
} from '../types/api';
import { MoneyField } from './MoneyField';
import { stockPackagingLabel } from '../utils/packagingDisplay';
import { formatQuantity } from '../utils/formatQuantity';
import { formatDateTime } from '../utils/datetime';
import { formatUserLabel } from '../utils/userAttribution';
import { useAutoClearMessage } from '../hooks/useAutoClearMessage';
import { useAuth } from '../context/AuthContext';

function formatApiError(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const d = err.response?.data;
    if (typeof d === 'string' && d.trim()) return d;
    if (d && typeof d === 'object') {
      const m = (d as { message?: unknown }).message;
      if (typeof m === 'string') return m;
      if (Array.isArray(m)) return m.join(', ');
    }
    if (typeof err.message === 'string' && err.message.trim()) return err.message;
  }
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
}

type LineDraft = { productId: number | ''; qty: string; unitCost: string };

type Props = {
  visible: boolean;
  companyId: number | '';
  departments: Department[];
  products: Product[];
  onStockChanged: () => void;
};

const emptyLine = (): LineDraft => ({ productId: '', qty: '', unitCost: '' });

function receptionLabel(s: ReceptionStatus | undefined): string {
  switch (s) {
    case 'partial':
      return 'Partiel';
    case 'complete':
      return 'Complet';
    default:
      return 'En attente';
  }
}

function poStatusLabel(s: PurchaseOrderListItem['status']): string {
  switch (s) {
    case 'ORDERED':
      return 'Confirmé';
    case 'CLOSED':
      return 'Clôturé';
    case 'CANCELLED':
      return 'Annulé';
    default:
      return 'Brouillon';
  }
}

export function PurchasingSection({ visible, companyId, departments, products, onStockChanged }: Props) {
  const { can } = useAuth();
  const isAdmin = can(['ADMIN']);
  const [orders, setOrders] = useState<PurchaseOrderListItem[]>([]);
  const [loadErr, setLoadErr] = useState('');
  const [msg, setMsg] = useAutoClearMessage();
  const [busy, setBusy] = useState(false);

  const [filterDeptId, setFilterDeptId] = useState<number | ''>('');
  const [filterReception, setFilterReception] = useState<ReceptionStatus | ''>('');
  const [search, setSearch] = useState('');

  const [showOrderForm, setShowOrderForm] = useState(false);
  const [poDeptId, setPoDeptId] = useState<number | ''>('');
  const [poSupplier, setPoSupplier] = useState('');
  const [poRef, setPoRef] = useState('');
  const [poLines, setPoLines] = useState<LineDraft[]>([emptyLine()]);

  const [activeOrderId, setActiveOrderId] = useState<number | null>(null);
  const [activeOrder, setActiveOrder] = useState<PurchaseOrderDetail | null>(null);
  const [receiveQty, setReceiveQty] = useState<Record<number, string>>({});
  const [receiveCost, setReceiveCost] = useState<Record<number, string>>({});
  const [receiveNote, setReceiveNote] = useState('');

  const load = useCallback(async () => {
    if (typeof companyId !== 'number') return;
    setLoadErr('');
    try {
      setOrders(await listPurchaseOrders(companyId));
    } catch (err) {
      setLoadErr(formatApiError(err, 'Chargement impossible.'));
    }
  }, [companyId]);

  useEffect(() => {
    if (!visible) return;
    void load();
  }, [visible, load]);

  useEffect(() => {
    if (departments.length && poDeptId === '') setPoDeptId(departments[0].id);
  }, [departments, poDeptId]);

  function productsForDept(deptId: number | '') {
    if (deptId === '') return [];
    return products.filter((p) => p.department?.id === deptId && p.trackStock && !p.isService);
  }

  const deptLabel = (d: Department) => (d.company ? `${d.company.name} — ${d.name}` : d.name);

  const ordersFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (filterDeptId !== '' && o.department.id !== filterDeptId) return false;
      if (filterReception !== '' && o.receptionStatus !== filterReception) return false;
      if (!q) return true;
      const ref = (o.reference ?? '').toLowerCase();
      const supplier = (o.supplierName ?? '').toLowerCase();
      return ref.includes(q) || supplier.includes(q);
    });
  }, [orders, filterDeptId, filterReception, search]);

  async function openReception(orderId: number) {
    setMsg('');
    setBusy(true);
    try {
      const detail = await getPurchaseOrder(orderId);
      setActiveOrderId(orderId);
      setActiveOrder(detail);
      const qty: Record<number, string> = {};
      const cost: Record<number, string> = {};
      for (const line of detail.lines) {
        qty[line.productId] = '';
        cost[line.productId] =
          line.unitPriceEst != null ? String(line.unitPriceEst) : receiveCost[line.productId] ?? '';
      }
      setReceiveQty(qty);
      setReceiveCost(cost);
      setReceiveNote('');
    } catch (err) {
      setLoadErr(formatApiError(err, 'Chargement impossible.'));
    } finally {
      setBusy(false);
    }
  }

  function closeReception() {
    setActiveOrderId(null);
    setActiveOrder(null);
    setReceiveQty({});
    setReceiveCost({});
    setReceiveNote('');
  }

  async function onCreatePO(e: FormEvent) {
    e.preventDefault();
    if (typeof companyId !== 'number') return;
    setMsg('');
    if (poDeptId === '') {
      setMsg('Département requis.', { persist: true });
      return;
    }
    const lines = poLines
      .map((l) => ({
        productId: typeof l.productId === 'number' ? l.productId : 0,
        quantityOrdered: Number(l.qty.replace(',', '.')),
        unitPriceEst: l.unitCost.trim() ? Number(l.unitCost.replace(',', '.')) : undefined,
      }))
      .filter((l) => l.productId > 0 && Number.isFinite(l.quantityOrdered) && l.quantityOrdered > 0);
    if (lines.length === 0) {
      setMsg('Ligne invalide.', { persist: true });
      return;
    }
    setBusy(true);
    try {
      await createPurchaseOrder({
        companyId,
        departmentId: poDeptId,
        supplierName: poSupplier.trim() || undefined,
        reference: poRef.trim() || undefined,
        lines,
      });
      setPoLines([emptyLine()]);
      setShowOrderForm(false);
      setMsg('Commande créée.');
      await load();
    } catch (err) {
      setMsg(formatApiError(err, 'Création impossible.'), { persist: true });
    } finally {
      setBusy(false);
    }
  }

  async function onReceive(e: FormEvent) {
    e.preventDefault();
    if (!activeOrder) return;
    setMsg('');
    const lines = activeOrder.lines
      .map((line) => {
        const rawQty = (receiveQty[line.productId] ?? '').trim().replace(',', '.');
        const rawCost = (receiveCost[line.productId] ?? '').trim().replace(',', '.');
        if (!rawQty) return null;
        const quantity = Number(rawQty);
        const unitCost = Number(rawCost);
        if (!Number.isFinite(quantity) || quantity <= 0) return null;
        if (!Number.isFinite(unitCost) || unitCost < 0) return null;
        return { productId: line.productId, quantity, unitCost };
      })
      .filter((l): l is { productId: number; quantity: number; unitCost: number } => l != null);

    if (lines.length === 0) {
      setMsg('Quantité requise.', { persist: true });
      return;
    }

    setBusy(true);
    try {
      const updated = await receivePurchaseOrder(activeOrder.id, {
        note: receiveNote.trim() || undefined,
        lines,
      });
      setMsg(updated.receptionStatus === 'complete' ? 'Réception complète.' : 'Réception enregistrée.');
      await load();
      onStockChanged();
      if (updated.status === 'CLOSED' || updated.receptionStatus === 'complete') {
        setActiveOrder(updated);
      } else {
        setActiveOrder(updated);
        const qty: Record<number, string> = {};
        for (const line of updated.lines) {
          qty[line.productId] = '';
        }
        setReceiveQty(qty);
      }
    } catch (err) {
      setMsg(formatApiError(err, 'Réception impossible.'), { persist: true });
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteOrder(order: PurchaseOrderListItem) {
    if (!isAdmin || order.receptionStatus !== 'pending') return;
    const label = order.reference ?? `#${order.id}`;
    if (!confirm(`Supprimer la commande « ${label} » ?`)) return;
    setMsg('');
    setBusy(true);
    try {
      await deletePurchaseOrder(order.id);
      if (activeOrderId === order.id) closeReception();
      setMsg('Commande supprimée.');
      await load();
    } catch (err) {
      setMsg(formatApiError(err, 'Suppression impossible.'), { persist: true });
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteReceipt(receiptId: number) {
    if (!isAdmin || !activeOrder) return;
    if (!confirm('Supprimer cette réception ? Le stock sera ajusté.')) return;
    setMsg('');
    setBusy(true);
    try {
      const updated = await deleteGoodsReceipt(receiptId);
      setActiveOrder(updated);
      setMsg('Réception supprimée.');
      await load();
      onStockChanged();
    } catch (err) {
      setMsg(formatApiError(err, 'Suppression impossible.'), { persist: true });
    } finally {
      setBusy(false);
    }
  }

  function renderOrderLineGrid(
    lines: LineDraft[],
    setLines: (v: LineDraft[]) => void,
    deptId: number | '',
  ) {
    return (
      <div className="purchasing-lines-block">
        {lines.map((row, idx) => (
          <div key={idx} className="purchasing-line-grid">
            <label>
              Produit
              <select
                value={row.productId === '' ? '' : String(row.productId)}
                onChange={(e) => {
                  const next = [...lines];
                  next[idx] = { ...next[idx], productId: e.target.value ? Number(e.target.value) : '' };
                  setLines(next);
                }}
              >
                <option value="">—</option>
                {productsForDept(deptId).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {stockPackagingLabel(p)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Qté
              <input
                type="text"
                inputMode="decimal"
                value={row.qty}
                onChange={(e) => {
                  const next = [...lines];
                  next[idx] = { ...next[idx], qty: e.target.value };
                  setLines(next);
                }}
              />
            </label>
            <MoneyField
              label="Prix / u."
              type="text"
              inputMode="decimal"
              value={row.unitCost}
              onChange={(e) => {
                const next = [...lines];
                next[idx] = { ...next[idx], unitCost: e.target.value };
                setLines(next);
              }}
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm purchasing-line-remove"
              disabled={lines.length <= 1}
              onClick={() => setLines(lines.filter((_, i) => i !== idx))}
              aria-label="Retirer"
            >
              ×
            </button>
          </div>
        ))}
        <div className="purchasing-line-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setLines([...lines, emptyLine()])}
          >
            + Ligne
          </button>
        </div>
      </div>
    );
  }

  const receptionReadOnly = activeOrder?.status === 'CLOSED' || activeOrder?.receptionStatus === 'complete';

  if (!visible) return null;

  return (
    <section className="card purchasing-page">
      {loadErr ? <p className="error-text">{loadErr}</p> : null}
      {msg ? <p className={/créée|enregistrée|complète|supprimée/i.test(msg) ? 'info-text' : 'error-text'}>{msg}</p> : null}

      <div className="purchasing-toolbar">
        <label>
          Département
          <select
            value={filterDeptId === '' ? '' : String(filterDeptId)}
            onChange={(e) => setFilterDeptId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">Tous</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {deptLabel(d)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Réception
          <select
            value={filterReception}
            onChange={(e) =>
              setFilterReception(e.target.value ? (e.target.value as ReceptionStatus) : '')
            }
          >
            <option value="">Toutes</option>
            <option value="pending">En attente</option>
            <option value="partial">Partiel</option>
            <option value="complete">Complet</option>
          </select>
        </label>
        <label className="purchasing-toolbar-search">
          Recherche
          <input value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>

      <div className="purchasing-panel-head">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => setShowOrderForm((o) => !o)}
        >
          {showOrderForm ? 'Fermer' : '+ Commande'}
        </button>
      </div>

      {showOrderForm ? (
        <form className="purchasing-form card" onSubmit={(e) => void onCreatePO(e)}>
          <div className="purchasing-form-head">
            <label>
              Département
              <select
                value={poDeptId === '' ? '' : String(poDeptId)}
                onChange={(e) => setPoDeptId(e.target.value ? Number(e.target.value) : '')}
              >
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {deptLabel(d)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Fournisseur
              <input value={poSupplier} onChange={(e) => setPoSupplier(e.target.value)} />
            </label>
            <label>
              Référence
              <input value={poRef} onChange={(e) => setPoRef(e.target.value)} />
            </label>
          </div>
          {renderOrderLineGrid(poLines, setPoLines, poDeptId)}
          <div className="purchasing-form-submit">
            <button type="submit" className="btn btn-primary" disabled={busy || typeof companyId !== 'number'}>
              Créer
            </button>
          </div>
        </form>
      ) : null}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Réf.</th>
              <th>Fournisseur</th>
              <th>Département</th>
              <th>Réception</th>
              <th>Statut</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ordersFiltered.length === 0 ? (
              <tr>
                <td colSpan={7}>—</td>
              </tr>
            ) : (
              ordersFiltered.map((o) => {
                const canReceive =
                  o.status !== 'CANCELLED' &&
                  o.receptionStatus !== 'complete' &&
                  o.status !== 'CLOSED';
                return (
                  <tr key={o.id} className={activeOrderId === o.id ? 'row-active' : undefined}>
                    <td>{formatDateTime(o.createdAt)}</td>
                    <td>{o.reference ?? '—'}</td>
                    <td>{o.supplierName ?? '—'}</td>
                    <td>{o.department.name}</td>
                    <td>{receptionLabel(o.receptionStatus)}</td>
                    <td>{poStatusLabel(o.status)}</td>
                    <td className="purchasing-col-action">
                      <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {canReceive ? (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={busy}
                            onClick={() => void openReception(o.id)}
                          >
                            Réception
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busy}
                            onClick={() => void openReception(o.id)}
                          >
                            Voir
                          </button>
                        )}
                        {isAdmin && o.receptionStatus === 'pending' ? (
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            disabled={busy}
                            onClick={() => void onDeleteOrder(o)}
                          >
                            Supprimer
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {activeOrder ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={closeReception}
        >
          <div
            className="modal card modal-purchasing"
            role="dialog"
            aria-modal
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
              <h2 style={{ margin: 0 }}>
                #{activeOrder.reference ?? activeOrder.id} · {receptionLabel(activeOrder.receptionStatus)}
              </h2>
              <button type="button" className="btn btn-secondary btn-sm" onClick={closeReception}>
                ×
              </button>
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Produit</th>
                    <th>Commandé</th>
                    <th>Reçu</th>
                    <th>Reste</th>
                    {!receptionReadOnly ? (
                      <>
                        <th>Qté</th>
                        <th>Prix / u.</th>
                      </>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {activeOrder.lines.map((line) => {
                    const editable = !receptionReadOnly && line.quantityRemaining > 0;
                    return (
                      <tr key={line.id}>
                        <td>{line.product.name}</td>
                        <td className="journal-amt">{formatQuantity(line.quantityOrdered)}</td>
                        <td className="journal-amt">{formatQuantity(line.quantityReceived)}</td>
                        <td className="journal-amt">{formatQuantity(line.quantityRemaining)}</td>
                        {!receptionReadOnly ? (
                          <>
                            <td style={{ maxWidth: '7rem' }}>
                              {editable ? (
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  disabled={busy}
                                  value={receiveQty[line.productId] ?? ''}
                                  onChange={(e) =>
                                    setReceiveQty((prev) => ({
                                      ...prev,
                                      [line.productId]: e.target.value,
                                    }))
                                  }
                                />
                              ) : (
                                '—'
                              )}
                            </td>
                            <td style={{ maxWidth: '8rem' }}>
                              {editable ? (
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  disabled={busy}
                                  value={receiveCost[line.productId] ?? ''}
                                  onChange={(e) =>
                                    setReceiveCost((prev) => ({
                                      ...prev,
                                      [line.productId]: e.target.value,
                                    }))
                                  }
                                />
                              ) : (
                                '—'
                              )}
                            </td>
                          </>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {!receptionReadOnly ? (
              <form onSubmit={(e) => void onReceive(e)} style={{ marginTop: '0.75rem' }}>
                <label>
                  Note
                  <input value={receiveNote} disabled={busy} onChange={(e) => setReceiveNote(e.target.value)} />
                </label>
                <div className="modal-actions" style={{ marginTop: '0.75rem' }}>
                  <button type="button" className="btn btn-secondary" onClick={closeReception}>
                    Fermer
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={busy}>
                    Valider réception
                  </button>
                </div>
              </form>
            ) : (
              <div className="modal-actions" style={{ marginTop: '0.75rem' }}>
                <button type="button" className="btn btn-secondary" onClick={closeReception}>
                  Fermer
                </button>
              </div>
            )}

            {activeOrder.goodsReceipts && activeOrder.goodsReceipts.length > 0 ? (
              <div style={{ marginTop: '0.75rem' }}>
                <strong>Historique</strong>
                <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem' }}>
                  {activeOrder.goodsReceipts.map((gr) => (
                    <li key={gr.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span>
                        {formatDateTime(gr.receivedAt)} — {formatUserLabel(gr.createdBy)} —{' '}
                        {gr.lines.length} ligne(s)
                      </span>
                      {isAdmin ? (
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          disabled={busy}
                          onClick={() => void onDeleteReceipt(gr.id)}
                        >
                          Supprimer
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
