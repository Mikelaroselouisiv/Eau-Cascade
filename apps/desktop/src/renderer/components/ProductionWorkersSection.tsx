import { useEffect, useState } from 'react';
import axios from 'axios';
import {
  createProductionWorker,
  declareProductionWorkerIssue,
  declareProductionWorkerOutput,
  getProductionWorker,
  listProductionWorkerIssues,
  listProductionWorkerOutputs,
  listProductionWorkers,
  updateProductionWorker,
} from '../services/api';
import type {
  Product,
  ProductionWorkerFiche,
  ProductionWorkerMovementRow,
  ProductionWorkerRow,
} from '../types/api';
import { formatMoney, moneyLabel } from '../utils/currency';
import { defaultMonthStartYmd, formatDateTimeShort, formatYmd } from '../utils/datetime';
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
  productionEnabled: boolean;
  finishedGoods: Product[];
  rawMaterials: Product[];
  canManageWorkers: boolean;
  onRefuseClosed: () => void;
  onMessage: (msg: string) => void;
};

export function ProductionWorkersSection({
  departmentId,
  productionEnabled,
  finishedGoods,
  rawMaterials,
  canManageWorkers,
  onRefuseClosed,
  onMessage,
}: Props) {
  const [workers, setWorkers] = useState<ProductionWorkerRow[]>([]);
  const [issues, setIssues] = useState<ProductionWorkerMovementRow[]>([]);
  const [outputs, setOutputs] = useState<ProductionWorkerMovementRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [op, setOp] = useState<'issue' | 'return'>('issue');

  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState('');
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newCoef, setNewCoef] = useState('');

  const [workerId, setWorkerId] = useState<number | ''>('');
  const [qty, setQty] = useState<Record<number, string>>({});

  const [fiche, setFiche] = useState<ProductionWorkerFiche | null>(null);
  const [dateFrom, setDateFrom] = useState(defaultMonthStartYmd());
  const [dateTo, setDateTo] = useState(formatYmd());
  const [ficheBusy, setFicheBusy] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editCoef, setEditCoef] = useState('');
  const [editError, setEditError] = useState('');

  const catalog = op === 'issue' ? rawMaterials : finishedGoods;

  async function reload() {
    const [w, i, o] = await Promise.all([
      listProductionWorkers(departmentId),
      listProductionWorkerIssues({ departmentId }),
      listProductionWorkerOutputs({ departmentId }),
    ]);
    setWorkers(w);
    setIssues(i);
    setOutputs(o);
    setWorkerId((prev) => (prev !== '' && w.some((row) => row.id === prev) ? prev : (w[0]?.id ?? '')));
  }

  useEffect(() => {
    setError('');
    setQty({});
    void reload().catch((e) => onMessage(errMsg(e, 'Chargement impossible.')));
  }, [departmentId]);

  async function onCreate() {
    const name = newName.trim();
    const phone = newPhone.trim();
    const coef = Number(newCoef.replace(',', '.'));
    if (!name || !phone || !Number.isFinite(coef) || coef <= 0) {
      setCreateError('Nom, téléphone et coefficient sont requis.');
      return;
    }
    setBusy(true);
    setCreateError('');
    try {
      await createProductionWorker({
        departmentId,
        name,
        phone,
        payrollCoefficient: coef,
      });
      setNewName('');
      setNewPhone('');
      setNewCoef('');
      setCreateOpen(false);
      await reload();
      onMessage('Ouvrier créé.');
    } catch (e) {
      setCreateError(errMsg(e, 'Création impossible.'));
    } finally {
      setBusy(false);
    }
  }

  async function onRecord() {
    if (!productionEnabled) {
      onRefuseClosed();
      return;
    }
    if (workerId === '') {
      setError('Ouvrier requis.');
      return;
    }
    const items = catalog
      .map((p) => ({
        productId: p.id,
        quantity: Number((qty[p.id] ?? '').replace(',', '.')),
      }))
      .filter((i) => Number.isFinite(i.quantity) && i.quantity > 0);
    if (items.length === 0) {
      setError('Quantité requise.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (op === 'issue') {
        await declareProductionWorkerIssue({ workerId, departmentId, items });
      } else {
        await declareProductionWorkerOutput({ workerId, departmentId, items });
      }
      setQty({});
      await reload();
      onMessage('Enregistré.');
    } catch (e) {
      setError(errMsg(e, 'Enregistrement impossible.'));
    } finally {
      setBusy(false);
    }
  }

  async function openFiche(id: number, from = dateFrom, to = dateTo) {
    setFicheBusy(true);
    try {
      const row = await getProductionWorker(id, { dateFrom: from, dateTo: to });
      const switched = fiche?.id !== row.id;
      setFiche(row);
      if (switched) {
        setEditName(row.name);
        setEditPhone(row.phone);
        setEditCoef(String(row.payrollCoefficient));
        setEditError('');
      }
    } catch (e) {
      onMessage(errMsg(e, 'Fiche impossible.'));
    } finally {
      setFicheBusy(false);
    }
  }

  async function onSaveFiche() {
    if (!fiche || !canManageWorkers) return;
    const name = editName.trim();
    const phone = editPhone.trim();
    const coef = Number(editCoef.replace(',', '.'));
    if (!name || !phone || !Number.isFinite(coef) || coef <= 0) {
      setEditError('Nom, téléphone et coefficient sont requis.');
      return;
    }
    setFicheBusy(true);
    setEditError('');
    try {
      await updateProductionWorker(fiche.id, {
        name,
        phone,
        payrollCoefficient: coef,
      });
      await reload();
      const row = await getProductionWorker(fiche.id, { dateFrom, dateTo });
      setFiche(row);
      setEditName(row.name);
      setEditPhone(row.phone);
      setEditCoef(String(row.payrollCoefficient));
      onMessage('Ouvrier enregistré.');
    } catch (e) {
      setEditError(errMsg(e, 'Enregistrement impossible.'));
    } finally {
      setFicheBusy(false);
    }
  }

  return (
    <>
      {error ? <p className="error-text">{error}</p> : null}

      <section className="card" style={{ marginBottom: '0.75rem' }}>
        <h2 style={{ marginTop: 0 }}>Enregistrement</h2>
        <div className="pos-sale-mode" style={{ marginBottom: 12 }}>
          <button
            type="button"
            className={`pos-sale-mode-btn${op === 'issue' ? ' active' : ''}`}
            onClick={() => {
              setOp('issue');
              setQty({});
            }}
          >
            Matière première
          </button>
          <button
            type="button"
            className={`pos-sale-mode-btn${op === 'return' ? ' active' : ''}`}
            onClick={() => {
              setOp('return');
              setQty({});
            }}
          >
            Produit fini
          </button>
        </div>
        <div className="form-grid">
          <label>
            Ouvrier *
            <select
              value={workerId}
              onChange={(e) => setWorkerId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">—</option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          {catalog.map((p) => (
            <label key={p.id}>
              {p.name}
              <input
                type="number"
                min={0}
                step="any"
                value={qty[p.id] ?? ''}
                onChange={(e) => setQty((prev) => ({ ...prev, [p.id]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || workerId === '' || catalog.length === 0}
          onClick={() => void onRecord()}
        >
          Enregistrer
        </button>
      </section>

      <section className="card" style={{ marginBottom: '0.75rem' }}>
        <div
          className="modal-heading"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}
        >
          <h2 style={{ margin: 0 }}>Ouvriers</h2>
          {canManageWorkers ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setCreateError('');
                setNewName('');
                setNewPhone('');
                setNewCoef('');
                setCreateOpen(true);
              }}
            >
              Nouvel ouvrier
            </button>
          ) : null}
        </div>
        {workers.length === 0 ? (
          <p className="muted">Aucun ouvrier</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Téléphone</th>
                  {canManageWorkers ? (
                    <>
                      <th>Entrée</th>
                      <th>{moneyLabel('Coefficient')}</th>
                      <th>MP</th>
                      <th>PF</th>
                      <th>Paie</th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {workers.map((w) => (
                  <tr
                    key={w.id}
                    className={canManageWorkers ? 'dashboard-sale-row' : undefined}
                    role={canManageWorkers ? 'button' : undefined}
                    tabIndex={canManageWorkers ? 0 : undefined}
                    style={canManageWorkers ? { cursor: 'pointer' } : undefined}
                    onClick={canManageWorkers ? () => void openFiche(w.id) : undefined}
                    onKeyDown={
                      canManageWorkers
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
                    {canManageWorkers ? (
                      <>
                        <td>{formatYmd(w.startedAt)}</td>
                        <td className="journal-amt">{formatMoney(w.payrollCoefficient)}</td>
                        <td className="journal-amt">{formatQuantity(w.sessionIssuedQty ?? 0)}</td>
                        <td className="journal-amt">{formatQuantity(w.sessionQuantity ?? 0)}</td>
                        <td className="journal-amt">{formatMoney(w.sessionPayroll ?? 0)}</td>
                      </>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" style={{ marginBottom: '0.75rem' }}>
        <h2 style={{ marginTop: 0 }}>Matière première</h2>
        {issues.length === 0 ? (
          <p className="muted">Aucun enregistrement</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Ouvrier</th>
                  <th>Produit</th>
                  <th>Qté</th>
                </tr>
              </thead>
              <tbody>
                {issues.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTimeShort(row.createdAt)}</td>
                    <td>{row.worker.name}</td>
                    <td>{row.product.name}</td>
                    <td className="journal-amt">{formatQuantity(row.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Produit fini</h2>
        {outputs.length === 0 ? (
          <p className="muted">Aucun enregistrement</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Ouvrier</th>
                  <th>Produit</th>
                  <th>Qté</th>
                  {canManageWorkers ? <th>Paie</th> : null}
                </tr>
              </thead>
              <tbody>
                {outputs.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTimeShort(row.createdAt)}</td>
                    <td>{row.worker.name}</td>
                    <td>{row.product.name}</td>
                    <td className="journal-amt">{formatQuantity(row.quantity)}</td>
                    {canManageWorkers ? (
                      <td className="journal-amt">{formatMoney(row.payrollAmount ?? 0)}</td>
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
          <div
            className="modal card"
            role="dialog"
            aria-modal
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="modal-heading"
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <h2 style={{ margin: 0 }}>Nouvel ouvrier</h2>
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
              <label>
                {moneyLabel('Coefficient')} *
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={newCoef}
                  onChange={(e) => setNewCoef(e.target.value)}
                />
              </label>
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
            {canManageWorkers ? (
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
                    {moneyLabel('Coefficient')} *
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={editCoef}
                      onChange={(e) => setEditCoef(e.target.value)}
                    />
                  </label>
                  <label>
                    Entrée
                    <input value={formatYmd(fiche.startedAt)} readOnly />
                  </label>
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
                <dt>{moneyLabel('Coefficient')}</dt>
                <dd style={{ margin: 0 }}>{formatMoney(fiche.payrollCoefficient)}</dd>
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
              MP {formatQuantity(fiche.issuedQty)} · PF {formatQuantity(fiche.finishedQty)} ·{' '}
              {formatMoney(fiche.payrollAmount)}
            </p>
            <h3 style={{ fontSize: '1rem' }}>Matière première</h3>
            {fiche.issuedByProduct.length === 0 ? (
              <p className="muted">Aucun</p>
            ) : (
              <table className="data-table">
                <tbody>
                  {fiche.issuedByProduct.map((r) => (
                    <tr key={r.productId}>
                      <td>{r.name}</td>
                      <td className="journal-amt">{formatQuantity(r.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <h3 style={{ fontSize: '1rem' }}>Produit fini</h3>
            {fiche.finishedByProduct.length === 0 ? (
              <p className="muted">Aucun</p>
            ) : (
              <table className="data-table">
                <tbody>
                  {fiche.finishedByProduct.map((r) => (
                    <tr key={r.productId}>
                      <td>{r.name}</td>
                      <td className="journal-amt">{formatQuantity(r.quantity)}</td>
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
