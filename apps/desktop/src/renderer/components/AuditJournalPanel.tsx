import { useEffect, useState } from 'react';
import { getDepartments, getUsers, listAuditLogs } from '../services/api';
import type { AuditLogRow, Department, SessionUser } from '../types/api';
import { auditActionLabel } from '../utils/auditActionLabel';
import { formatUserLabel } from '../utils/userAttribution';
import { formatDateTime, formatYmd, defaultMonthStartYmd } from '../utils/datetime';

type Props = {
  companyId: number;
};

export function AuditJournalPanel({ companyId }: Props) {
  const [items, setItems] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [skip, setSkip] = useState(0);
  const take = 25;

  const [dateFrom, setDateFrom] = useState(defaultMonthStartYmd);
  const [dateTo, setDateTo] = useState(() => formatYmd(new Date()));
  const [userId, setUserId] = useState<number | ''>('');
  const [departmentId, setDepartmentId] = useState<number | ''>('');
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');

  const [users, setUsers] = useState<SessionUser[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);

  useEffect(() => {
    void getUsers()
      .then((list) => setUsers(list.filter((u) => u.companyId === companyId || u.companyId == null)))
      .catch(() => setUsers([]));
    void getDepartments(companyId)
      .then(setDepartments)
      .catch(() => setDepartments([]));
  }, [companyId]);

  async function load(reset = true) {
    setLoading(true);
    const nextSkip = reset ? 0 : skip;
    try {
      const res = await listAuditLogs({
        skip: nextSkip,
        take,
        companyId,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        userId: userId === '' ? undefined : userId,
        departmentId: departmentId === '' ? undefined : departmentId,
        entity: entity.trim() || undefined,
        action: action.trim() || undefined,
      });
      setItems(reset ? res.items : [...items, ...res.items]);
      setTotal(res.total);
      setSkip(nextSkip);
    } catch {
      if (reset) {
        setItems([]);
        setTotal(0);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on company / filter apply via bouton
  }, [companyId]);

  return (
    <section className="card" style={{ marginTop: '1rem' }}>
      <h2>Journal d&apos;audit (actions utilisateurs)</h2>
      <p className="dept-hint" style={{ marginTop: 0 }}>
        Filtrez pour consulter l&apos;historique sans charger des millions de lignes. {total} entrée
        {total > 1 ? 's' : ''} correspondent aux filtres.
      </p>

      <div
        className="form-grid inline"
        style={{
          marginBottom: '0.85rem',
          alignItems: 'end',
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        }}
      >
        <label>
          Date début
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label>
          Date fin
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
        <label>
          Utilisateur
          <select
            value={userId === '' ? '' : String(userId)}
            onChange={(e) => setUserId(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">Tous</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName?.trim() || u.phone || `#${u.id}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          Département
          <select
            value={departmentId === '' ? '' : String(departmentId)}
            onChange={(e) => setDepartmentId(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">Tous</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Entité
          <input
            value={entity}
            onChange={(e) => setEntity(e.target.value)}
            placeholder="Sale, Product…"
          />
        </label>
        <label>
          Action
          <input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="CREATED, OPENED…"
          />
        </label>
        <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void load(true)}>
          {loading ? '…' : 'Filtrer'}
        </button>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Utilisateur</th>
              <th>Action</th>
              <th>Entité</th>
              <th>Réf.</th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr>
                <td colSpan={5}>Chargement…</td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={5}>Aucune entrée pour ces filtres.</td>
              </tr>
            ) : (
              items.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.createdAt)}</td>
                  <td>{formatUserLabel(row.user)}</td>
                  <td>
                    <small>{auditActionLabel(row.action)}</small>
                  </td>
                  <td>{row.entity}</td>
                  <td>{row.entityId ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {items.length > 0 && skip + take < total ? (
        <div className="table-actions" style={{ marginTop: '0.75rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={loading}
            onClick={() => {
              void (async () => {
                setLoading(true);
                const nextSkip = skip + take;
                try {
                  const res = await listAuditLogs({
                    skip: nextSkip,
                    take,
                    companyId,
                    dateFrom: dateFrom || undefined,
                    dateTo: dateTo || undefined,
                    userId: userId === '' ? undefined : userId,
                    departmentId: departmentId === '' ? undefined : departmentId,
                    entity: entity.trim() || undefined,
                    action: action.trim() || undefined,
                  });
                  setItems((prev) => [...prev, ...res.items]);
                  setTotal(res.total);
                  setSkip(nextSkip);
                } finally {
                  setLoading(false);
                }
              })();
            }}
          >
            {loading ? 'Chargement…' : 'Charger plus'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
