import { useEffect, useState } from 'react';
import axios from 'axios';
import { createCarrier, getCarrier, listCarriers, updateCarrier } from '../services/api';
import type { CarrierFiche, CarrierRow, Product } from '../types/api';
import { formatMoney, moneyLabel } from '../utils/currency';
import { defaultMonthStartYmd, formatYmd } from '../utils/datetime';
import { formatQuantity } from '../utils/formatQuantity';

function errMsg(err: unknown, fallback: string) {
  if (axios.isAxiosError(err) && err.response?.data && typeof err.response.data === 'object') {
    const m = (err.response.data as { message?: unknown }).message;
    if (Array.isArray(m)) return m.join(', ');
    if (typeof m === 'string' && m.trim()) return m;
  }
  return fallback;
}

type Props = {
  departmentId: number;
  finishedGoods: Product[];
  canManage: boolean;
  onMessage: (msg: string) => void;
};

export function CarriersSection({ departmentId, finishedGoods, canManage, onMessage }: Props) {
  const [rows, setRows] = useState<CarrierRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState('');
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newRates, setNewRates] = useState<Record<number, string>>({});
  const [fiche, setFiche] = useState<CarrierFiche | null>(null);
  const [dateFrom, setDateFrom] = useState(defaultMonthStartYmd());
  const [dateTo, setDateTo] = useState(formatYmd());
  const [ficheBusy, setFicheBusy] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editRates, setEditRates] = useState<Record<number, string>>({});
  const [editError, setEditError] = useState('');

  async function reload() {
    setRows(await listCarriers(departmentId));
  }

  useEffect(() => {
    void reload().catch((e) => onMessage(errMsg(e, 'Chargement impossible.')));
  }, [departmentId]);

  function collectRates(src: Record<number, string>) {
    return finishedGoods
      .map((p) => ({
        productId: p.id,
        coefficient: Number((src[p.id] ?? '').replace(',', '.')),
      }))
      .filter((r) => Number.isFinite(r.coefficient) && r.coefficient >= 0);
  }

  async function onCreate() {
    const name = newName.trim();
    const phone = newPhone.trim();
    if (!name || !phone) {
      setCreateError('Nom et téléphone sont requis.');
      return;
    }
    setBusy(true);
    setCreateError('');
    try {
      await createCarrier({ departmentId, name, phone, rates: collectRates(newRates) });
      setNewName('');
      setNewPhone('');
      setNewRates({});
      setCreateOpen(false);
      await reload();
      onMessage('Transporteur créé.');
    } catch (e) {
      setCreateError(errMsg(e, 'Création impossible.'));
    } finally {
      setBusy(false);
    }
  }

  async function openFiche(id: number, from = dateFrom, to = dateTo) {
    setFicheBusy(true);
    try {
      const row = await getCarrier(id, { dateFrom: from, dateTo: to });
      const switched = fiche?.id !== row.id;
      setFiche(row);
      if (switched) {
        setEditName(row.name);
        setEditPhone(row.phone);
        const next: Record<number, string> = {};
        for (const r of row.rates) next[r.productId] = String(r.coefficient);
        setEditRates(next);
        setEditError('');
      }
    } catch (e) {
      onMessage(errMsg(e, 'Fiche impossible.'));
    } finally {
      setFicheBusy(false);
    }
  }

  async function onSaveFiche() {
    if (!fiche || !canManage) return;
    const name = editName.trim();
    const phone = editPhone.trim();
    if (!name || !phone) {
      setEditError('Nom et téléphone sont requis.');
      return;
    }
    setFicheBusy(true);
    setEditError('');
    try {
      await updateCarrier(fiche.id, { name, phone, rates: collectRates(editRates) });
      await reload();
      const row = await getCarrier(fiche.id, { dateFrom, dateTo });
      setFiche(row);
      setEditName(row.name);
      setEditPhone(row.phone);
      onMessage('Transporteur enregistré.');
    } catch (e) {
      setEditError(errMsg(e, 'Enregistrement impossible.'));
    } finally {
      setFicheBusy(false);
    }
  }

  return (
    <>
      <section className="card" style={{ marginBottom: '0.75rem' }}>
        <div
          className="modal-heading"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}
        >
          <h2 style={{ margin: 0 }}>Transporteurs</h2>
          {canManage ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setCreateError('');
                setNewName('');
                setNewPhone('');
                setNewRates({});
                setCreateOpen(true);
              }}
            >
              Nouveau transporteur
            </button>
          ) : null}
        </div>
        {rows.length === 0 ? (
          <p className="muted">Aucun transporteur</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Téléphone</th>
                  {canManage ? (
                    <>
                      <th>Entrée</th>
                      <th>Livré</th>
                      <th>Paie</th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => (
                  <tr
                    key={w.id}
                    className={canManage ? 'dashboard-sale-row' : undefined}
                    role={canManage ? 'button' : undefined}
                    tabIndex={canManage ? 0 : undefined}
                    style={canManage ? { cursor: 'pointer' } : undefined}
                    onClick={canManage ? () => void openFiche(w.id) : undefined}
                    onKeyDown={
                      canManage
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              void openFiche(w.id);
                            }
                          }
                        : undefined
                    }
                  >
                    <td>{w.name}</td>
                    <td>{w.phone}</td>
                    {canManage ? (
                      <>
                        <td>{formatYmd(w.startedAt)}</td>
                        <td className="journal-amt">{formatQuantity(w.deliveredQty ?? 0)}</td>
                        <td className="journal-amt">{formatMoney(w.payrollAmount ?? 0)}</td>
                      </>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {createOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setCreateOpen(false)}>
          <div className="modal card" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
            <div
              className="modal-heading"
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <h2 style={{ margin: 0 }}>Nouveau transporteur</h2>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCreateOpen(false)}>
                ×
              </button>
            </div>
            {createError ? <p className="error-text">{createError}</p> : null}
            <div className="form-grid">
              <label>
                Nom *
                <input value={newName} onChange={(e) => setNewName(e.target.value)} />
              </label>
              <label>
                Téléphone *
                <input type="tel" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
              </label>
            </div>
            <h3 style={{ fontSize: '1rem' }}>{moneyLabel('Coefficient')}</h3>
            <div className="form-grid">
              {finishedGoods.map((p) => (
                <label key={p.id}>
                  {p.name}
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={newRates[p.id] ?? ''}
                    onChange={(e) => setNewRates((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
            <div className="modal-actions" style={{ marginTop: '0.75rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setCreateOpen(false)}>
                Annuler
              </button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void onCreate()}>
                Créer
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {fiche ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setFiche(null)}>
          <div
            className="modal card modal-purchasing"
            role="dialog"
            aria-modal
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="modal-heading"
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <h2 style={{ margin: 0 }}>{fiche.name}</h2>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFiche(null)}>
                ×
              </button>
            </div>
            {canManage ? (
              <>
                {editError ? <p className="error-text">{editError}</p> : null}
                <div className="form-grid">
                  <label>
                    Nom *
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                  </label>
                  <label>
                    Téléphone *
                    <input type="tel" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
                  </label>
                  <label>
                    Entrée
                    <input value={formatYmd(fiche.startedAt)} readOnly />
                  </label>
                </div>
                <h3 style={{ fontSize: '1rem' }}>{moneyLabel('Coefficient')}</h3>
                <div className="form-grid">
                  {finishedGoods.map((p) => (
                    <label key={p.id}>
                      {p.name}
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={editRates[p.id] ?? ''}
                        onChange={(e) => setEditRates((prev) => ({ ...prev, [p.id]: e.target.value }))}
                      />
                    </label>
                  ))}
                </div>
                <div className="modal-actions" style={{ margin: '0 0 0.75rem' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={ficheBusy}
                    onClick={() => void onSaveFiche()}
                  >
                    Enregistrer
                  </button>
                </div>
              </>
            ) : (
              <dl className="form-grid" style={{ gridTemplateColumns: 'auto 1fr' }}>
                <dt>Téléphone</dt>
                <dd style={{ margin: 0 }}>{fiche.phone}</dd>
                <dt>Entrée</dt>
                <dd style={{ margin: 0 }}>{formatYmd(fiche.startedAt)}</dd>
              </dl>
            )}
            <div className="form-grid">
              <label>
                Du
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDateFrom(v);
                    void openFiche(fiche.id, v, dateTo);
                  }}
                />
              </label>
              <label>
                Au
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDateTo(v);
                    void openFiche(fiche.id, dateFrom, v);
                  }}
                />
              </label>
            </div>
            {ficheBusy ? <p className="muted">Chargement…</p> : null}
            <p>
              Livré {formatQuantity(fiche.deliveredQty)} · {formatMoney(fiche.payrollAmount)}
            </p>
            {fiche.deliveredByProduct.length === 0 ? (
              <p className="muted">Aucun</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Produit</th>
                    <th>Qté</th>
                    <th>Paie</th>
                  </tr>
                </thead>
                <tbody>
                  {fiche.deliveredByProduct.map((r) => (
                    <tr key={r.productId}>
                      <td>{r.name}</td>
                      <td className="journal-amt">{formatQuantity(r.quantity)}</td>
                      <td className="journal-amt">{formatMoney(r.payrollAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
