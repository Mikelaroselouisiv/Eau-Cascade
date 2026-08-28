import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  getCompanies,
  getCompanyById,
  getDepartments,
  getPrinterSettings,
  getSaleById,
  listDeliveries,
  addDeliveryDrop,
  updateDelivery,
} from '../services/api';
import type { CompanyListItem, Delivery, Department } from '../types/api';
import { useAuth } from '../context/AuthContext';
import { formatMoney } from '../utils/currency';
import { formatQuantity } from '../utils/formatQuantity';
import { useAutoClearMessage } from '../hooks/useAutoClearMessage';
import { buildReceiptPayloadFromSale } from '../utils/receiptPayload';
import { buildSaleDetailPrintHtml, openBrowserPrintWindow } from '../utils/saleReceiptBrowserHtml';
import { formatDateTimeShort } from '../utils/datetime';
import { saleTxnNumber } from '../utils/saleTxnNumber';
import {
  departmentsForUser,
  isAdminRole,
} from '../utils/user-scope';

const PAGE_SIZE = 100;

const STATUS_LABEL: Record<Delivery['status'], string> = {
  PENDING: 'Non livré',
  PARTIAL: 'Partiel',
  DELIVERED: 'Livré',
};

function statusClass(status: Delivery['status']) {
  if (status === 'DELIVERED') return 'delivery-card--done';
  if (status === 'PARTIAL') return 'delivery-card--partial';
  return 'delivery-card--pending';
}

function formatWhen(iso: string) {
  return formatDateTimeShort(iso);
}

function isHomeDelivery(d: Delivery) {
  return d.fulfillmentType === 'HOME' || d.sale?.fulfillmentType === 'HOME';
}

function apiErrorMessage(err: unknown, fallback: string) {
  if (axios.isAxiosError(err) && err.response?.data && typeof err.response.data === 'object') {
    const m = (err.response.data as { message?: unknown }).message;
    if (Array.isArray(m)) return m.join(', ');
    if (typeof m === 'string' && m.trim()) return m;
  }
  return fallback;
}

export function DeliveryPage() {
  const { user, canPerm } = useAuth();
  const canManageAll = canPerm('deliveries.manage');
  const canManageOnsite = canPerm('deliveries.manage_onsite');
  const canManageHome = canPerm('deliveries.manage_home');
  const canPrintFiche = canPerm('deliveries.print');
  const lockedScope = user?.role === 'CASHIER' || user?.role === 'LIVREUR';
  const canFilter = !lockedScope;

  const [companies, setCompanies] = useState<CompanyListItem[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [companyId, setCompanyId] = useState<number | ''>('');
  const [departmentId, setDepartmentId] = useState<number | ''>('');
  const [statusFilter, setStatusFilter] = useState<'' | Delivery['status']>('');
  const [fulfillmentFilter, setFulfillmentFilter] = useState<'' | 'ON_SITE' | 'HOME'>('');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Delivery | null>(null);
  const [dropSaleItemId, setDropSaleItemId] = useState<number | ''>('');
  const [dropQty, setDropQty] = useState('');
  const [dropDeptId, setDropDeptId] = useState<number | ''>('');
  const [dropExecutor, setDropExecutor] = useState('');
  const [dropStopId, setDropStopId] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);
  const [printingId, setPrintingId] = useState<number | null>(null);
  const [message, setMessage] = useAutoClearMessage();
  const [scopeLabel, setScopeLabel] = useState('');

  useEffect(() => {
    if (!lockedScope) return;
    const cid = typeof user?.companyId === 'number' ? user.companyId : null;
    if (!cid) {
      setScopeLabel('');
      return;
    }
    void getCompanyById(cid)
      .then((company) => setScopeLabel(company.name))
      .catch(() => setScopeLabel(''));
  }, [lockedScope, user?.companyId]);

  useEffect(() => {
    if (!lockedScope || !rows.length) return;
    const first = rows[0];
    const companyName = first.company?.name;
    const deptName = first.department?.name;
    if (companyName) {
      setScopeLabel(deptName ? `${companyName} · ${deptName}` : companyName);
    }
  }, [lockedScope, rows]);

  useEffect(() => {
    if (lockedScope) return;
    void getCompanies()
      .then((list) => {
        setCompanies(list);
        const scopedCompanyId = user?.companyId;
        if (!isAdminRole(user?.role) && typeof scopedCompanyId === 'number') {
          setCompanyId(scopedCompanyId);
        } else if (list.length === 1) {
          setCompanyId(list[0].id);
        }
      })
      .catch(() => setCompanies([]));
  }, [lockedScope, user?.role, user?.companyId]);

  useEffect(() => {
    if (canFilter && companyId === '') {
      setDepartments([]);
      return;
    }
    const cid =
      canFilter && companyId !== ''
        ? companyId
        : typeof user?.companyId === 'number'
          ? user.companyId
          : undefined;
    if (cid == null) {
      setDepartments([]);
      return;
    }
    void getDepartments(cid)
      .then((list) => setDepartments(canFilter ? departmentsForUser(list, user) : list))
      .catch(() => setDepartments([]));
  }, [canFilter, companyId, user?.role, user?.companyId, user?.departmentId, user?.departmentIds]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
      setPage(0);
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(0);
  }, [companyId, departmentId, statusFilter, fulfillmentFilter, lockedScope]);

  async function reload() {
    setLoading(true);
    try {
      const data = await listDeliveries({
        companyId: canFilter && companyId !== '' ? companyId : undefined,
        departmentId: canFilter && departmentId !== '' ? departmentId : undefined,
        status: statusFilter || undefined,
        fulfillmentType: fulfillmentFilter || undefined,
        q: searchQuery || undefined,
        skip: page * PAGE_SIZE,
        take: PAGE_SIZE,
      });
      setRows(data.items);
      setTotal(data.total);
    } catch {
      setRows([]);
      setTotal(0);
      setMessage('Impossible de charger les livraisons');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, departmentId, statusFilter, fulfillmentFilter, lockedScope, searchQuery, page]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);

  const counts = useMemo(() => {
    let pending = 0;
    let partial = 0;
    let done = 0;
    for (const r of rows) {
      if (r.status === 'PENDING') pending += 1;
      else if (r.status === 'PARTIAL') partial += 1;
      else done += 1;
    }
    return { pending, partial, done };
  }, [rows]);

  function applyDeliveryToForm(d: Delivery) {
    const remainingItem = (d.items ?? []).find(
      (it) => Number(it.quantityRemaining ?? Number(it.quantityOrdered) - Number(it.quantityDelivered)) > 0.0001,
    );
    setDropSaleItemId(remainingItem?.saleItemId ?? d.items?.[0]?.saleItemId ?? '');
    setDropQty(
      remainingItem
        ? String(Number(remainingItem.quantityRemaining ?? Number(remainingItem.quantityOrdered) - Number(remainingItem.quantityDelivered)))
        : '',
    );
    const depts = isHomeDelivery(d)
      ? departments.filter((x) => x.offersHomeDelivery)
      : departments;
    setDropDeptId(d.departmentId ?? depts[0]?.id ?? '');
    setDropExecutor(d.executorName?.trim() ?? '');
    const stops = d.sale?.deliveryStops ?? [];
    const remainingStop = stops.find((s) => Number(s.quantityRemaining ?? s.quantity) > 0.0001);
    setDropStopId(remainingStop?.id ?? stops[0]?.id ?? '');
  }

  function openCard(d: Delivery) {
    setSelected(d);
    applyDeliveryToForm(d);
  }

  function canManageDelivery(d: Delivery) {
    if (canManageAll) return true;
    return isHomeDelivery(d) ? canManageHome : canManageOnsite;
  }

  const dropDepartments = useMemo(() => {
    if (!selected) return departments;
    return isHomeDelivery(selected)
      ? departments.filter((d) => d.offersHomeDelivery)
      : departments;
  }, [selected, departments]);

  async function addLine() {
    if (!selected || !canManageDelivery(selected)) return;
    if (dropSaleItemId === '') {
      setMessage('Choisissez un article');
      return;
    }
    const qty = Number(String(dropQty).replace(',', '.'));
    if (!Number.isFinite(qty) || qty <= 0) {
      setMessage('Quantité invalide');
      return;
    }
    if (dropDeptId === '') {
      setMessage('Choisissez le département');
      return;
    }
    if (isHomeDelivery(selected) && !dropExecutor.trim()) {
      setMessage('Indiquez le livreur');
      return;
    }
    setSaving(true);
    try {
      const updated = await addDeliveryDrop(selected.id, {
        saleItemId: dropSaleItemId,
        quantity: qty,
        departmentId: dropDeptId,
        ...(isHomeDelivery(selected)
          ? {
              executorName: dropExecutor.trim(),
              stopId: dropStopId === '' ? null : dropStopId,
            }
          : { executorName: dropExecutor.trim() || null }),
      });
      setSelected(updated);
      applyDeliveryToForm(updated);
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setMessage('Ligne enregistrée');
    } catch (err) {
      setMessage(apiErrorMessage(err, 'Échec de la mise à jour'));
    } finally {
      setSaving(false);
    }
  }

  async function markAllDelivered() {
    if (!selected || !canManageDelivery(selected)) return;
    if (dropDeptId === '') {
      setMessage('Choisissez le département');
      return;
    }
    if (isHomeDelivery(selected) && !dropExecutor.trim()) {
      setMessage('Indiquez le livreur');
      return;
    }
    setSaving(true);
    try {
      const updated = await updateDelivery(selected.id, {
        markDelivered: true,
        stockDepartmentId: dropDeptId,
        ...(isHomeDelivery(selected)
          ? {
              executorName: dropExecutor.trim(),
              stopId: dropStopId === '' ? undefined : dropStopId,
            }
          : {}),
      });
      setSelected(updated);
      applyDeliveryToForm(updated);
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setMessage('Livré');
    } catch (err) {
      setMessage(apiErrorMessage(err, 'Échec de la mise à jour'));
    } finally {
      setSaving(false);
    }
  }

  async function reprintSaleSlip(delivery: Delivery) {
    const saleId = delivery.sale?.id ?? delivery.saleId;
    if (!saleId) {
      setMessage('Vente introuvable pour impression');
      return;
    }
    setPrintingId(delivery.id);
    try {
      const sale = await getSaleById(saleId);
      const cid =
        delivery.companyId ||
        sale.items?.[0]?.product?.companyId ||
        (typeof user?.companyId === 'number' ? user.companyId : undefined);
      const deptId =
        delivery.departmentId ??
        sale.items?.[0]?.product?.departmentId ??
        sale.items?.[0]?.product?.department?.id ??
        undefined;

      const company = cid != null ? await getCompanyById(cid).catch(() => null) : null;
      const printer =
        typeof deptId === 'number' ? await getPrinterSettings(deptId).catch(() => null) : null;

      const hasElectronPrint = typeof window.desktopApp?.printReceipt === 'function';
      if (hasElectronPrint) {
        const payload = buildReceiptPayloadFromSale(sale, company, printer);
        const result = await window.desktopApp!.printReceipt!(payload);
        if (!result.ok) {
          setMessage(result.reason || "L'impression n'a pas pu aboutir");
          return;
        }
        setMessage(`Fiche #${saleTxnNumber(sale)} réimprimée`);
      } else {
        openBrowserPrintWindow(
          buildSaleDetailPrintHtml(sale, company?.name ?? delivery.company?.name),
        );
        setMessage('Fenêtre d’impression ouverte');
      }
    } catch {
      setMessage('Impossible de réimprimer la fiche');
    } finally {
      setPrintingId(null);
    }
  }

  return (
    <div className="page delivery-page">
      <header className="delivery-header">
        <div>
          <h1 className="delivery-title">Livraisons</h1>
          <div className="delivery-stats">
            <span className="delivery-stat delivery-stat--pending">{counts.pending}</span>
            <span className="delivery-stat delivery-stat--partial">{counts.partial}</span>
            <span className="delivery-stat delivery-stat--done">{counts.done}</span>
          </div>
        </div>
        <div className="delivery-filters">
          <input
            type="search"
            className="delivery-search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="N° ticket (vente) ou client…"
            aria-label="Rechercher par numéro ticket ou client"
          />
          {canFilter ? (
            <>
              <select
                value={companyId === '' ? '' : String(companyId)}
                onChange={(e) => {
                  setCompanyId(e.target.value ? Number(e.target.value) : '');
                  setDepartmentId('');
                }}
                aria-label="Entreprise"
              >
                <option value="">Entreprise</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                value={departmentId === '' ? '' : String(departmentId)}
                onChange={(e) =>
                  setDepartmentId(e.target.value ? Number(e.target.value) : '')
                }
                aria-label="Département"
                disabled={companyId === ''}
              >
                <option value="">Département</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </>
          ) : scopeLabel ? (
            <div className="delivery-scope-chip">{scopeLabel}</div>
          ) : null}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as '' | Delivery['status'])}
            aria-label="Statut"
          >
            <option value="">Tous</option>
            <option value="PENDING">Non livré</option>
            <option value="PARTIAL">Partiel</option>
            <option value="DELIVERED">Livré</option>
          </select>
          <select
            value={fulfillmentFilter}
            onChange={(e) =>
              setFulfillmentFilter(e.target.value as '' | 'ON_SITE' | 'HOME')
            }
            aria-label="Type de fiche"
          >
            <option value="">Toutes les fiches</option>
            <option value="ON_SITE">Sur place</option>
            <option value="HOME">À domicile</option>
          </select>
        </div>
      </header>

      {message ? <p className="delivery-toast">{message}</p> : null}

      <div className="delivery-toolbar">
        <p className="delivery-muted delivery-range">
          {loading
            ? 'Chargement…'
            : total === 0
              ? 'Aucune fiche'
              : `${from}–${to} sur ${total}`}
        </p>
        {total > PAGE_SIZE ? (
          <div className="delivery-pager">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loading || page <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Précédent
            </button>
            <span className="delivery-page-label">
              Page {page + 1} / {pageCount}
            </span>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loading || page + 1 >= pageCount}
              onClick={() => setPage((p) => p + 1)}
            >
              Suivant
            </button>
          </div>
        ) : null}
      </div>

      {loading && rows.length === 0 ? (
        <p className="delivery-muted">Chargement…</p>
      ) : rows.length === 0 ? (
        <p className="delivery-empty">Aucune fiche</p>
      ) : (
        <div className="delivery-grid">
          {rows.map((d) => {
            const busyPrint = printingId === d.id;
            return (
              <article key={d.id} className={`delivery-card ${statusClass(d.status)}`}>
                <button
                  type="button"
                  className="delivery-card-body"
                  onClick={() => openCard(d)}
                >
                  <div className="delivery-card-top">
                    <span className="delivery-card-ref">
                      Vente #{d.saleRef ?? (d.sale ? saleTxnNumber(d.sale) : d.saleId)}
                    </span>
                    <span className="delivery-card-badge">{STATUS_LABEL[d.status]}</span>
                  </div>
                  <div className="delivery-card-client">
                    {d.sale?.clientName?.trim() || 'Client'}
                    {isHomeDelivery(d) ? (
                      <span className="delivery-card-home"> · À domicile</span>
                    ) : null}
                  </div>
                  {isHomeDelivery(d) && d.sale?.clientPhone?.trim() ? (
                    <div className="delivery-card-meta">{d.sale.clientPhone.trim()}</div>
                  ) : null}
                  <div className="delivery-card-meta">
                    {d.company?.name}
                    {isHomeDelivery(d)
                      ? d.department?.name
                        ? ` · Livré depuis ${d.department.name}`
                        : ''
                      : d.department?.name
                        ? ` · ${d.department.name}`
                        : ''}
                  </div>
                  <div className="delivery-card-foot">
                    <span>{formatWhen(d.sale?.createdAt ?? d.createdAt)}</span>
                    <span className="delivery-card-total">{formatMoney(d.sale?.total)}</span>
                  </div>
                  {isHomeDelivery(d) && d.executorName?.trim() ? (
                    <div className="delivery-card-executor">Par {d.executorName.trim()}</div>
                  ) : null}
                </button>
                {canPrintFiche ? (
                  <button
                    type="button"
                    className="btn btn-secondary delivery-card-print"
                    disabled={busyPrint || printingId != null}
                    onClick={(e) => {
                      e.stopPropagation();
                      void reprintSaleSlip(d);
                    }}
                  >
                    {busyPrint ? 'Impression…' : 'Imprimer'}
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {selected ? (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <div className="modal card delivery-modal" onClick={(e) => e.stopPropagation()}>
            <div className="delivery-modal-head">
              <div>
                <div className="delivery-modal-ref">
                  Vente #
                  {selected.saleRef ??
                    (selected.sale ? saleTxnNumber(selected.sale) : selected.saleId)}
                </div>
                <div className="delivery-modal-client">
                  {selected.sale?.clientName?.trim() || 'Client'}
                  {isHomeDelivery(selected) ? ' · À domicile' : ' · Sur place'}
                </div>
              </div>
              <span className={`delivery-card-badge ${statusClass(selected.status)}`}>
                {STATUS_LABEL[selected.status]}
              </span>
            </div>

            <div className="delivery-modal-meta">
              <span>{selected.company?.name}</span>
              {isHomeDelivery(selected)
                ? selected.department?.name
                  ? <span>Livré depuis {selected.department.name}</span>
                  : null
                : selected.department?.name
                  ? <span>{selected.department.name}</span>
                  : null}
              <span>{formatMoney(selected.sale?.total)}</span>
            </div>
            {isHomeDelivery(selected) ? (
              <div className="delivery-modal-contact">
                {selected.sale?.clientPhone?.trim() ? (
                  <div>Tél. {selected.sale.clientPhone.trim()}</div>
                ) : null}
                {(selected.sale?.deliveryStops?.length
                  ? selected.sale.deliveryStops
                  : selected.sale?.clientAddress?.trim()
                    ? [{ id: 0, address: selected.sale.clientAddress.trim(), quantity: 0 }]
                    : []
                ).map((st) => (
                  <div key={st.id || st.address}>
                    {st.address}
                    {Number(st.quantity) > 0
                      ? ` · ${formatQuantity(Number(st.quantityDelivered ?? 0))} / ${formatQuantity(Number(st.quantity))}`
                      : ''}
                  </div>
                ))}
              </div>
            ) : null}

            <ul className="delivery-lines">
              {(selected.items ?? []).map((it) => {
                const ordered = Number(it.quantityOrdered);
                const delivered = Number(it.quantityDelivered);
                const remaining = Number(
                  it.quantityRemaining ?? Math.max(0, ordered - delivered),
                );
                const label = it.saleItem?.lineLabel || it.saleItem?.product?.name || 'Article';
                return (
                  <li key={it.id} className="delivery-line">
                    <div className="delivery-line-label">
                      <span>{label}</span>
                      <span className="delivery-muted">
                        Livré {formatQuantity(delivered)} · Reste {formatQuantity(remaining)} · Commandé {formatQuantity(ordered)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>

            {(selected.drops ?? []).length ? (
              <ul className="delivery-drops">
                {(selected.drops ?? []).map((drop) => {
                  const item = (selected.items ?? []).find((it) => it.saleItemId === drop.saleItemId);
                  const label = item?.saleItem?.lineLabel || item?.saleItem?.product?.name || 'Article';
                  return (
                    <li key={drop.id} className="delivery-drop">
                      {formatQuantity(Number(drop.quantity))} {label}
                      {drop.department?.name ? ` · ${drop.department.name}` : ''}
                      {drop.executorName?.trim() ? ` · ${drop.executorName.trim()}` : ''}
                      {drop.stop?.address ? ` · ${drop.stop.address}` : ''}
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {canManageDelivery(selected) && selected.status !== 'DELIVERED' ? (
              <div className="delivery-add-line">
                <label>
                  Article
                  <select
                    value={dropSaleItemId === '' ? '' : String(dropSaleItemId)}
                    onChange={(e) => setDropSaleItemId(e.target.value ? Number(e.target.value) : '')}
                    disabled={saving}
                  >
                    {(selected.items ?? []).map((it) => {
                      const remaining = Number(
                        it.quantityRemaining ??
                          Math.max(0, Number(it.quantityOrdered) - Number(it.quantityDelivered)),
                      );
                      const label = it.saleItem?.lineLabel || it.saleItem?.product?.name || 'Article';
                      return (
                        <option key={it.id} value={it.saleItemId} disabled={remaining <= 0.0001}>
                          {label} ({formatQuantity(remaining)})
                        </option>
                      );
                    })}
                  </select>
                </label>
                <label>
                  Quantité livrée
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={dropQty}
                    onChange={(e) => setDropQty(e.target.value)}
                    disabled={saving}
                  />
                </label>
                <label>
                  Département
                  <select
                    value={dropDeptId === '' ? '' : String(dropDeptId)}
                    onChange={(e) => setDropDeptId(e.target.value ? Number(e.target.value) : '')}
                    disabled={saving}
                  >
                    <option value="">—</option>
                    {dropDepartments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Livreur
                  <input
                    type="text"
                    value={dropExecutor}
                    maxLength={120}
                    onChange={(e) => setDropExecutor(e.target.value)}
                    disabled={saving}
                  />
                </label>
                {isHomeDelivery(selected) && (selected.sale?.deliveryStops?.length ?? 0) > 0 ? (
                  <label>
                    Adresse
                    <select
                      value={dropStopId === '' ? '' : String(dropStopId)}
                      onChange={(e) => setDropStopId(e.target.value ? Number(e.target.value) : '')}
                      disabled={saving}
                    >
                      {(selected.sale?.deliveryStops ?? []).map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.address} ({formatQuantity(Number(st.quantityRemaining ?? st.quantity))})
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
            ) : null}

            <div className="modal-actions delivery-modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setSelected(null)}>
                Fermer
              </button>
              {canPrintFiche ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={printingId != null || saving}
                  onClick={() => void reprintSaleSlip(selected)}
                >
                  {printingId === selected.id ? 'Impression…' : 'Réimprimer fiche'}
                </button>
              ) : null}
              {canManageDelivery(selected) && selected.status !== 'DELIVERED' ? (
                <>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={saving || printingId != null}
                    onClick={() => void addLine()}
                  >
                    Ajouter
                  </button>
                  <button
                    type="button"
                    disabled={saving || printingId != null}
                    onClick={() => void markAllDelivered()}
                  >
                    Tout livrer
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
