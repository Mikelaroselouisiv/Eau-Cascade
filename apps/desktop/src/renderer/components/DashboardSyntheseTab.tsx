import { useEffect, useMemo, useState } from 'react';

import {

  Bar,

  BarChart,

  CartesianGrid,

  Cell,

  Legend,

  Pie,

  PieChart,

  ResponsiveContainer,

  Tooltip,

  XAxis,

  YAxis,

} from 'recharts';

import {

  exportFinancialSynthesisPdf,

  getDashboardSalesByProduct,

  getDashboardSummaryRange,

  getDepartments,

} from '../services/api';

import type {

  CompanyListItem,

  DashboardBalanceSnapshot,

  DashboardSalesByProductRow,

  Department,

} from '../types/api';

import { formatMoney } from '../utils/currency';
import { formatQuantity } from '../utils/formatQuantity';
import { addDaysYmd, defaultMonthStartYmd, formatYmd } from '../utils/datetime';

const PIE_COLORS = ['#7a5230', '#a67c52', '#8b6914', '#c4a574', '#5c4033', '#9a7b4f', '#6b4423', '#b08968'];

type Props = {
  companies: CompanyListItem[];
  onMessage: (msg: string, opts?: { persist?: boolean }) => void;
};

export function DashboardSyntheseTab({ companies, onMessage }: Props) {

  const [selectedCompanyIds, setSelectedCompanyIds] = useState<number[]>([]);

  const [allDepartments, setAllDepartments] = useState<Department[]>([]);



  const [dateFrom, setDateFrom] = useState(defaultMonthStartYmd);

  const [dateTo, setDateTo] = useState(() => formatYmd(new Date()));

  const [departmentId, setDepartmentId] = useState<number | ''>('');

  const [rangeSnap, setRangeSnap] = useState<DashboardBalanceSnapshot | null>(null);

  const [rangeLoading, setRangeLoading] = useState(false);

  const [rows, setRows] = useState<DashboardSalesByProductRow[]>([]);

  const [rowsLoading, setRowsLoading] = useState(false);



  const [productQuery, setProductQuery] = useState('');

  const [sortKey, setSortKey] = useState<'productName' | 'totalSubtotal' | 'quantity'>('quantity');

  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [synthesisPdfLoading, setSynthesisPdfLoading] = useState(false);



  useEffect(() => {

    if (companies.length === 0) return;

    setSelectedCompanyIds((prev) => {

      if (prev.length === 0) return companies.map((c) => c.id);

      const valid = prev.filter((id) => companies.some((c) => c.id === id));

      return valid.length ? valid : companies.map((c) => c.id);

    });

  }, [companies]);



  useEffect(() => {

    void getDepartments()

      .then(setAllDepartments)

      .catch(() => setAllDepartments([]));

  }, []);



  const companyQuery = useMemo(

    () => (selectedCompanyIds.length ? { companyIds: selectedCompanyIds } : {}),

    [selectedCompanyIds],

  );



  const departmentsFiltered = useMemo(() => {

    if (selectedCompanyIds.length === 0) return allDepartments;

    return allDepartments.filter((d) => selectedCompanyIds.includes(d.company?.id ?? -1));

  }, [allDepartments, selectedCompanyIds]);



  const multiCompany = selectedCompanyIds.length !== 1;

  useEffect(() => {

    if (departmentId === '') return;

    if (!departmentsFiltered.some((d) => d.id === departmentId)) {

      setDepartmentId('');

    }

  }, [departmentId, departmentsFiltered]);

  useEffect(() => {
    if (selectedCompanyIds.length === 0 || !dateFrom || !dateTo || dateFrom > dateTo) return;

    setRangeLoading(true);

    void getDashboardSummaryRange({

      ...companyQuery,

      dateFrom,

      dateTo,

      departmentId: departmentId === '' ? undefined : Number(departmentId),

    })

      .then(setRangeSnap)

      .catch(() => onMessage('Impossible de charger la synthèse financière.', { persist: true }))

      .finally(() => setRangeLoading(false));

  }, [companyQuery, dateFrom, dateTo, departmentId, onMessage, selectedCompanyIds.length]);



  useEffect(() => {

    if (selectedCompanyIds.length === 0 || !dateFrom || !dateTo || dateFrom > dateTo) return;

    setRowsLoading(true);

    void getDashboardSalesByProduct({

      ...companyQuery,

      dateFrom,

      dateTo,

      departmentId: departmentId === '' ? undefined : Number(departmentId),

    })

      .then(setRows)

      .catch(() => onMessage('Impossible de charger le détail par article.', { persist: true }))

      .finally(() => setRowsLoading(false));

  }, [companyQuery, dateFrom, dateTo, departmentId, onMessage, selectedCompanyIds.length]);



  const marginPct = useMemo(() => {

    if (!rangeSnap || rangeSnap.sales <= 0) return null;

    return (rangeSnap.balance / rangeSnap.sales) * 100;

  }, [rangeSnap]);



  const flowBars = useMemo(() => {

    if (!rangeSnap) return [];

    return [

      { name: 'Ventes', value: rangeSnap.sales, fill: '#7a5230' },

      { name: 'Achats', value: rangeSnap.purchases, fill: '#a67c52' },

      { name: 'Dépenses', value: rangeSnap.manualExpenses, fill: '#8b6914' },

      { name: 'Résultat', value: rangeSnap.balance, fill: rangeSnap.balance >= 0 ? '#3f6b3a' : '#b42318' },

    ];

  }, [rangeSnap]);



  const pieSlices = useMemo(() => {

    const sorted = [...rows].sort((a, b) => b.quantity - a.quantity).slice(0, 8);

    return sorted.map((r) => ({

      name: r.productName.length > 28 ? `${r.productName.slice(0, 26)}…` : r.productName,

      value: r.quantity,

    }));

  }, [rows]);



  const filteredSortedRows = useMemo(() => {

    const q = productQuery.trim().toLowerCase();

    let list = q

      ? rows.filter((r) => r.productName.toLowerCase().includes(q))

      : [...rows];

    const mul = sortDir === 'asc' ? 1 : -1;

    list.sort((a, b) => {

      if (sortKey === 'productName') return a.productName.localeCompare(b.productName, 'fr') * mul;

      if (sortKey === 'quantity') return (a.quantity - b.quantity) * mul;

      return (a.totalSubtotal - b.totalSubtotal) * mul;

    });

    return list;

  }, [rows, productQuery, sortKey, sortDir]);



  const grandTotal = useMemo(() => filteredSortedRows.reduce((s, r) => s + r.totalSubtotal, 0), [filteredSortedRows]);



  function toggleCompany(id: number) {

    setSelectedCompanyIds((prev) => {

      if (prev.includes(id)) {

        const next = prev.filter((x) => x !== id);

        return next.length ? next : prev;

      }

      return [...prev, id];

    });

  }



  function selectAllCompanies() {

    setSelectedCompanyIds(companies.map((c) => c.id));

  }



  function deptLabel(d: Department) {
    if (!multiCompany) return d.name;
    const co = d.company?.name ?? companies.find((c) => c.id === d.company?.id)?.name;
    return co ? `${co} — ${d.name}` : d.name;
  }

  async function downloadSynthesisPdf() {

    if (!dateFrom || !dateTo || dateFrom > dateTo) {

      onMessage('Indiquez une plage de dates valide.', { persist: true });

      return;

    }

    if (selectedCompanyIds.length === 0) return;

    setSynthesisPdfLoading(true);

    onMessage('');

    try {

      const blob = await exportFinancialSynthesisPdf({

        ...companyQuery,

        dateFrom,

        dateTo,

        departmentId: departmentId === '' ? undefined : Number(departmentId),

      });

      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');

      a.href = url;

      a.download = `synthese-financiere_${dateFrom}_${dateTo}.pdf`;

      a.click();

      URL.revokeObjectURL(url);

    } catch {

      onMessage("Impossible d'exporter le PDF de synthèse.", { persist: true });

    } finally {

      setSynthesisPdfLoading(false);

    }

  }



  const invalidRange = !dateFrom || !dateTo || dateFrom > dateTo;
  const noCompanySelected = selectedCompanyIds.length === 0;

  const activeDatePreset = useMemo((): 'today' | 'week' | 'month' | null => {
    const today = formatYmd(new Date());
    if (dateFrom === today && dateTo === today) return 'today';

    const weekFrom = addDaysYmd(today, -6);
    if (dateFrom === weekFrom && dateTo === today) return 'week';

    if (dateFrom === defaultMonthStartYmd() && dateTo === today) return 'month';

    return null;
  }, [dateFrom, dateTo]);

  function applyDatePreset(preset: 'today' | 'week' | 'month') {
    const to = formatYmd(new Date());

    if (preset === 'today') {
      setDateFrom(to);
      setDateTo(to);
      return;
    }

    if (preset === 'week') {
      setDateFrom(addDaysYmd(to, -6));
      setDateTo(to);
      return;
    }

    setDateFrom(defaultMonthStartYmd());
    setDateTo(to);
  }



  return (

    <div className="synthese-tab">

      <section className="card synthese-toolbar">
        <div className="synthese-toolbar-head">
          <button
            type="button"
            className="btn btn-primary"
            disabled={synthesisPdfLoading || invalidRange || rangeLoading || noCompanySelected}
            onClick={() => void downloadSynthesisPdf()}
          >
            {synthesisPdfLoading ? 'Export PDF…' : 'Exporter la synthèse (PDF)'}
          </button>
        </div>

        <div className="synthese-toolbar-grid">
          <div className="synthese-filter-block">
            <span className="synthese-filter-block-label">Période</span>
            <div className="synthese-preset-group" role="group" aria-label="Raccourcis de période">
              <button
                type="button"
                className={activeDatePreset === 'today' ? 'synthese-preset active' : 'synthese-preset'}
                onClick={() => applyDatePreset('today')}
              >
                Aujourd&apos;hui
              </button>
              <button
                type="button"
                className={activeDatePreset === 'week' ? 'synthese-preset active' : 'synthese-preset'}
                onClick={() => applyDatePreset('week')}
              >
                7 jours
              </button>
              <button
                type="button"
                className={activeDatePreset === 'month' ? 'synthese-preset active' : 'synthese-preset'}
                onClick={() => applyDatePreset('month')}
              >
                Mois en cours
              </button>
            </div>
            <div className="synthese-date-fields">
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
                  {departmentsFiltered.map((d) => (
                    <option key={d.id} value={d.id}>
                      {deptLabel(d)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="synthese-filter-block">
            <div className="synthese-filter-block-head">
              <span className="synthese-filter-block-label">Entreprises</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={selectAllCompanies}>
                Toutes
              </button>
            </div>
            <div className="synthese-company-chips">
              {companies.map((c) => (
                <label
                  key={c.id}
                  className={
                    selectedCompanyIds.includes(c.id) ? 'synthese-company-chip active' : 'synthese-company-chip'
                  }
                >
                  <input
                    type="checkbox"
                    checked={selectedCompanyIds.includes(c.id)}
                    onChange={() => toggleCompany(c.id)}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
        </div>

        {noCompanySelected ? (
          <p className="dept-hint synthese-toolbar-hint">Sélectionnez au moins une entreprise.</p>
        ) : null}
        {invalidRange ? (
          <p className="dept-hint synthese-toolbar-hint">
            Ajustez les dates pour afficher les graphiques et le tableau.
          </p>
        ) : null}
      </section>



      {invalidRange || noCompanySelected ? null : (

        <>

          <section className="grid synthese-kpi-grid" style={{ marginTop: '1rem' }}>

            <div className="card synthese-kpi synthese-kpi--sales">

              <div className="synthese-kpi-label">Chiffre d&apos;affaires</div>

              <div className="synthese-kpi-value">

                {rangeLoading || !rangeSnap ? '…' : formatMoney(rangeSnap.sales)}

              </div>

            </div>

            <div className="card synthese-kpi synthese-kpi--out">

              <div className="synthese-kpi-label">Total sorties</div>

              <div className="synthese-kpi-value">

                {rangeLoading || !rangeSnap ? '…' : formatMoney(rangeSnap.totalOutflows)}

              </div>

              <div className="synthese-kpi-sub">

                {rangeSnap && !rangeLoading

                  ? `Achats ${formatMoney(rangeSnap.purchases)} · Dép. ${formatMoney(rangeSnap.manualExpenses)}`

                  : ''}

              </div>

            </div>

            <div className="card synthese-kpi synthese-kpi--result">

              <div className="synthese-kpi-label">Résultat net</div>

              <div

                className="synthese-kpi-value"

                style={{ color: rangeSnap && rangeSnap.balance < 0 ? '#dc2626' : '#0f172a' }}

              >

                {rangeLoading || !rangeSnap ? '…' : formatMoney(rangeSnap.balance)}

              </div>

              {marginPct != null ? (

                <div className="synthese-kpi-sub">Marge sur CA : {marginPct.toFixed(1)} %</div>

              ) : null}

            </div>

          </section>



          <section className="grid two-col synthese-charts-grid" style={{ marginTop: '1rem' }}>

            <div className="card synthese-chart-card">

              <h3 className="synthese-chart-title">Structure des flux (période sélectionnée)</h3>

              <div className="synthese-chart-area">

                {rangeLoading || !rangeSnap ? (

                  <p className="dept-hint">Chargement…</p>

                ) : (

                  <ResponsiveContainer width="100%" height={280}>

                    <BarChart data={flowBars} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>

                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />

                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />

                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}`} />

                      <Tooltip

                        formatter={(value: number) => [formatMoney(value), '']}

                        contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }}

                      />

                      <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={56}>

                        {flowBars.map((entry) => (

                          <Cell key={entry.name} fill={entry.fill} />

                        ))}

                      </Bar>

                    </BarChart>

                  </ResponsiveContainer>

                )}

              </div>

            </div>



            <div className="card synthese-chart-card">

              <h3 className="synthese-chart-title">Top articles (unités)</h3>

              <div className="synthese-chart-area">

                {rowsLoading ? (

                  <p className="dept-hint">Chargement…</p>

                ) : pieSlices.length === 0 ? (

                  <p className="dept-hint">Pas assez de données pour un camembert.</p>

                ) : (

                  <ResponsiveContainer width="100%" height={280}>

                    <PieChart>

                      <Pie

                        data={pieSlices}

                        dataKey="value"

                        nameKey="name"

                        cx="50%"

                        cy="50%"

                        innerRadius={52}

                        outerRadius={88}

                        paddingAngle={2}

                      >

                        {pieSlices.map((_, i) => (

                          <Cell key={String(i)} fill={PIE_COLORS[i % PIE_COLORS.length]} />

                        ))}

                      </Pie>

                      <Tooltip formatter={(v: number) => formatQuantity(v)} />

                      <Legend layout="horizontal" verticalAlign="bottom" wrapperStyle={{ fontSize: 11 }} />

                    </PieChart>

                  </ResponsiveContainer>

                )}

              </div>

            </div>

          </section>



          <section className="card" style={{ marginTop: '1rem' }}>

            <h3 className="synthese-chart-title">Détail des ventes par article</h3>

            <div

              className="form-grid inline"

              style={{

                marginBottom: '0.85rem',

                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',

                alignItems: 'end',

              }}

            >

              <label style={{ gridColumn: 'span 2' }}>

                Rechercher un article

                <input

                  type="search"

                  placeholder="Nom du produit ou service…"

                  value={productQuery}

                  onChange={(e) => setProductQuery(e.target.value)}

                />

              </label>

              <label>

                Trier par

                <select

                  value={sortKey}

                  onChange={(e) => setSortKey(e.target.value as typeof sortKey)}

                >

                  <option value="quantity">Quantité (unités)</option>

                  <option value="totalSubtotal">Montant (CA)</option>

                  <option value="productName">Nom</option>

                </select>

              </label>

              <label>

                Ordre

                <select value={sortDir} onChange={(e) => setSortDir(e.target.value as 'asc' | 'desc')}>

                  <option value="desc">Décroissant</option>

                  <option value="asc">Croissant</option>

                </select>

              </label>

            </div>



            {rowsLoading ? (

              <p className="dept-hint">Chargement du détail…</p>

            ) : (

              <>

                <div className="table-wrap">

                  <table className="data-table synthese-table">

                    <thead>

                      <tr>

                        <th>Article</th>

                        {multiCompany ? <th>Entreprise</th> : null}

                        <th>Département</th>

                        <th>Type</th>

                        <th className="journal-amt">Qté</th>

                        <th className="journal-amt">Montant</th>

                      </tr>

                    </thead>

                    <tbody>

                      {filteredSortedRows.length === 0 ? (

                        <tr>

                          <td colSpan={multiCompany ? 6 : 5}>

                            {productQuery.trim() ? 'Aucun article ne correspond au filtre.' : 'Aucune ligne.'}

                          </td>

                        </tr>

                      ) : (

                        filteredSortedRows.map((r) => (

                          <tr key={`${r.companyId ?? 'x'}-${r.productId}-${r.departmentId ?? 'x'}`}>

                            <td>{r.productName}</td>

                            {multiCompany ? <td>{r.companyName?.trim() || '—'}</td> : null}

                            <td>{r.departmentName?.trim() || '—'}</td>

                            <td>{r.isService ? 'Service' : 'Produit'}</td>

                            <td className="journal-amt">{formatQuantity(r.quantity)}</td>

                            <td className="journal-amt">{formatMoney(r.totalSubtotal)}</td>

                          </tr>

                        ))

                      )}

                    </tbody>

                  </table>

                </div>

                <p className="dept-hint" style={{ marginTop: '0.75rem', marginBottom: 0 }}>

                  {filteredSortedRows.length} ligne{filteredSortedRows.length > 1 ? 's' : ''} · Total filtré :{' '}

                  <strong>{formatMoney(grandTotal)}</strong>

                </p>

              </>

            )}

          </section>

        </>

      )}

    </div>

  );

}


