import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { getDepartments, getMarginAnalysis } from '../services/api';
import type { Department, MarginAnalysisReport } from '../types/api';
import { useAuth } from '../context/AuthContext';
import { formatMoney } from '../utils/currency';
import { defaultMonthStartYmd, formatYmd } from '../utils/datetime';
import { formatQuantity } from '../utils/formatQuantity';

function formatApiError(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const d = err.response?.data;
    if (typeof d === 'string' && d.trim()) return d;
    if (d && typeof d === 'object') {
      const m = (d as { message?: unknown }).message;
      if (typeof m === 'string') return m;
      if (Array.isArray(m)) return m.join(', ');
    }
  }
  return fallback;
}

type Props = {
  companyId: number;
};

export function DashboardBeneficesTab({ companyId }: Props) {
  const { can } = useAuth();
  const canSeePurchaseCosts = can(['ADMIN']);
  const [dateFrom, setDateFrom] = useState(defaultMonthStartYmd);
  const [dateTo, setDateTo] = useState(() => formatYmd(new Date()));
  const [departmentId, setDepartmentId] = useState<number | ''>('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [report, setReport] = useState<MarginAnalysisReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    void getDepartments(companyId)
      .then((d) => {
        setDepartments(d);
        setDepartmentId('');
      })
      .catch(() => setDepartments([]));
  }, [companyId]);

  async function load() {
    if (!dateFrom || !dateTo || dateFrom > dateTo) {
      setErr('Plage de dates invalide.');
      return;
    }
    setLoading(true);
    setErr('');
    try {
      const res = await getMarginAnalysis({
        companyId,
        dateFrom,
        dateTo,
        departmentId: departmentId === '' ? undefined : departmentId,
      });
      setReport(res);
    } catch (e) {
      setReport(null);
      setErr(formatApiError(e, 'Analyse impossible.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const filteredProducts = useMemo(() => {
    const rows = report?.products ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        (p.sku ?? '').toLowerCase().includes(needle) ||
        (p.departmentName ?? '').toLowerCase().includes(needle),
    );
  }, [report, q]);

  const colSpan = canSeePurchaseCosts ? 7 : 4;

  return (
    <div>
      <section className="card">
        <h2>Analyse des bénéfices</h2>
        <div
          className="form-grid inline"
          style={{
            marginBottom: '0.85rem',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            alignItems: 'end',
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
            Département
            <select
              value={departmentId === '' ? '' : String(departmentId)}
              onChange={(e) => setDepartmentId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">Tous</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void load()}>
            {loading ? 'Analyse…' : 'Analyser'}
          </button>
        </div>
        {err ? <p className="error-text">{err}</p> : null}
      </section>

      <section className="credit-kpi-strip" style={{ marginTop: '1rem' }}>
        <div className="credit-kpi credit-kpi-receivable">
          <span className="credit-kpi-label">Chiffre d’affaires</span>
          <strong className="credit-kpi-value">{formatMoney(report?.revenue ?? 0)}</strong>
        </div>
        {canSeePurchaseCosts ? (
          <>
            <div className="credit-kpi credit-kpi-debt">
              <span className="credit-kpi-label">Coût marchandises</span>
              <strong className="credit-kpi-value">{formatMoney(report?.cost ?? 0)}</strong>
            </div>
            <div className={`credit-kpi ${(report?.margin ?? 0) >= 0 ? 'credit-kpi-clear' : 'credit-kpi-overdue'}`}>
              <span className="credit-kpi-label">Bénéfice brut</span>
              <strong className="credit-kpi-value">{formatMoney(report?.margin ?? 0)}</strong>
            </div>
            <div className="credit-kpi">
              <span className="credit-kpi-label">Marge</span>
              <strong className="credit-kpi-value">
                {report?.marginPct != null ? `${report.marginPct.toFixed(1)} %` : '—'}
              </strong>
            </div>
          </>
        ) : null}
      </section>

      <section className="card" style={{ marginTop: '1rem' }}>
        <div className="bank-tx-toolbar">
          <h2 style={{ margin: 0 }}>Détail par produit</h2>
          <label>
            Rechercher
            <input
              type="search"
              placeholder="Nom, SKU, département…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
        </div>
        <div className="table-wrap" style={{ marginTop: '0.75rem' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Produit</th>
                <th>Département</th>
                <th>Qté (base)</th>
                <th>CA</th>
                {canSeePurchaseCosts ? (
                  <>
                    <th>Coût</th>
                    <th>Bénéfice</th>
                    <th>Marge</th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {loading && !report ? (
                <tr>
                  <td colSpan={colSpan} className="muted">
                    Chargement…
                  </td>
                </tr>
              ) : null}
              {!loading && filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} className="muted">
                    Aucune vente sur cette période.
                  </td>
                </tr>
              ) : null}
              {filteredProducts.map((p) => (
                <tr key={p.productId}>
                  <td>
                    <strong>{p.name}</strong>
                    {p.sku ? <div className="dept-hint">{p.sku}</div> : null}
                  </td>
                  <td>{p.departmentName ?? '—'}</td>
                  <td className="journal-amt">{formatQuantity(p.quantity)}</td>
                  <td className="journal-amt">{formatMoney(p.revenue)}</td>
                  {canSeePurchaseCosts ? (
                    <>
                      <td className="journal-amt">{formatMoney(p.cost)}</td>
                      <td className={`journal-amt ${p.margin >= 0 ? 'ok' : 'debt'}`}>
                        {formatMoney(p.margin)}
                      </td>
                      <td className="journal-amt">
                        {p.marginPct != null ? `${p.marginPct.toFixed(1)} %` : '—'}
                      </td>
                    </>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {report ? (
          <p className="dept-hint" style={{ marginTop: '0.65rem', marginBottom: 0 }}>
            {report.productsCount} produit(s) · période {report.dateFrom} → {report.dateTo}
          </p>
        ) : null}
      </section>
    </div>
  );
}
