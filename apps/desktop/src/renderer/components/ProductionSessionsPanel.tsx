import { useEffect, useState } from 'react';
import { getDepartments, getUsers, listProductionSessions } from '../services/api';
import type { Department, ProductionSessionDetail, SessionUser } from '../types/api';
import { formatDateTime, formatYmd, defaultMonthStartYmd } from '../utils/datetime';
import { formatQuantity } from '../utils/formatQuantity';
import { formatUserLabel } from '../utils/userAttribution';

type Props = {
  companyId: number;
  onSelect: (session: ProductionSessionDetail) => void;
};

function usedTotal(session: ProductionSessionDetail) {
  if (session.status !== 'CLOSED' || !session.usage?.length) return null;
  return session.usage.reduce((sum, row) => sum + row.usedQty, 0);
}

export function ProductionSessionsPanel({ companyId, onSelect }: Props) {
  const [sessions, setSessions] = useState<ProductionSessionDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState(defaultMonthStartYmd);
  const [dateTo, setDateTo] = useState(() => formatYmd(new Date()));
  const [openedById, setOpenedById] = useState<number | ''>('');
  const [departmentId, setDepartmentId] = useState<number | ''>('');
  const [sortBy, setSortBy] = useState<'openedAt' | 'userName'>('openedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [users, setUsers] = useState<SessionUser[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);

  useEffect(() => {
    void getUsers()
      .then((list) => setUsers(list.filter((u) => u.companyId === companyId || u.companyId == null)))
      .catch(() => setUsers([]));
    void getDepartments(companyId)
      .then((rows) => setDepartments(rows.filter((d) => d.kind === 'PRODUCTION_DISTRIBUTION')))
      .catch(() => setDepartments([]));
  }, [companyId]);

  async function load() {
    setLoading(true);
    try {
      const rows = await listProductionSessions({
        companyId,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        openedById: openedById === '' ? undefined : openedById,
        departmentId: departmentId === '' ? undefined : departmentId,
        sortBy,
        sortDir,
        take: 80,
      });
      setSessions(rows);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  return (
    <section className="card" style={{ marginTop: '1rem' }}>
      <h2>Sessions production</h2>
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
            value={openedById === '' ? '' : String(openedById)}
            onChange={(e) => setOpenedById(e.target.value === '' ? '' : Number(e.target.value))}
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
          Trier par
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'openedAt' | 'userName')}
          >
            <option value="openedAt">Date</option>
            <option value="userName">Nom utilisateur</option>
          </select>
        </label>
        <label>
          Ordre
          <select value={sortDir} onChange={(e) => setSortDir(e.target.value as 'asc' | 'desc')}>
            <option value="desc">Décroissant</option>
            <option value="asc">Croissant</option>
          </select>
        </label>
        <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void load()}>
          {loading ? '…' : 'Filtrer'}
        </button>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Département</th>
              <th>Utilisateur</th>
              <th>Ouverture</th>
              <th>Fermeture</th>
              <th>Statut</th>
              <th>MP utilisée</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6}>…</td>
              </tr>
            ) : sessions.length === 0 ? (
              <tr>
                <td colSpan={6}>Aucune session pour ces filtres.</td>
              </tr>
            ) : (
              sessions.map((s) => {
                const used = usedTotal(s);
                return (
                  <tr
                    key={s.id}
                    className="dashboard-sale-row"
                    role="button"
                    tabIndex={0}
                    style={{ cursor: 'pointer' }}
                    onClick={() => onSelect(s)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelect(s);
                      }
                    }}
                  >
                    <td>{s.department?.name ?? '—'}</td>
                    <td>{formatUserLabel(s.openedBy)}</td>
                    <td>{formatDateTime(s.openedAt)}</td>
                    <td>{s.closedAt ? formatDateTime(s.closedAt) : '—'}</td>
                    <td>{s.status === 'OPEN' ? 'Ouverte' : 'Fermée'}</td>
                    <td className="journal-amt">{used != null ? formatQuantity(used) : '—'}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
