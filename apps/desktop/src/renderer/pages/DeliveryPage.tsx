import { useEffect, useMemo, useState } from 'react';
import {
  getCompanies,
  getCompanyById,
  getDepartments,
  getPrinterSettings,
  getSaleById,
  listDeliveries,
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

export function DeliveryPage() {
  const { user, canPerm } = useAuth();
  const canManage = canPerm('deliveries.manage');
  const lockedScope = user?.role === 'CASHIER' || user?.role === 'LIVREUR';
  const canFilter = !lockedScope;

  const [companies, setCompanies] = useState<CompanyListItem[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [companyId, setCompanyId] = useState<number | ''>('');
  const [departmentId, setDepartmentId] = useState<number | ''>('');
  const [statusFilter, setStatusFilter] = useState<'' | Delivery['status']>('');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Delivery | null>(null);
  const [draftQty, setDraftQty] = useState<Record<number, string>>({});
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
        if (user?.role === 'MANAGER' && typeof user.companyId === 'number') {
          setCompanyId(user.companyId);
        } else if (list.length === 1) {
          setCompanyId(list[0].id);
        }
      })
      .catch(() => setCompanies([]));
  }, [lockedScope, user?.role, user?.companyId]);

  useEffect(() => {
    if (!canFilter || companyId === '') {
      setDepartments([]);
      return;
    }
    void getDepartments(companyId)
      .then(setDepartments)
      .catch(() => setDepartments([]));
  }, [canFilter, companyId]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
      setPage(0);
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(0);
  }, [companyId, departmentId, statusFilter, lockedScope]);

  async function reload() {
    setLoading(true);
    try {
      const data = await listDeliveries({
        companyId: canFilter && companyId !== '' ? companyId : undefined,
        departmentId: canFilter && departmentId !== '' ? departmentId : undefined,
        status: statusFilter || undefined,
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
  }, [companyId, departmentId, statusFilter, lockedScope, searchQuery, page]);

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

  function openCard(d: Delivery) {
    setSelected(d);
    const next: Record<number, string> = {};
    for (const it of d.items ?? []) {
      next[it.saleItemId] = String(Number(it.quantityDelivered));
    }
    setDraftQty(next);
  }

  async function savePartial() {
    if (!selected || !canManage) return;
    setSaving(true);
    try {
      const updated = await updateDelivery(selected.id, {
        items: (selected.items ?? []).map((it) => ({
          saleItemId: it.saleItemId,
          quantityDelivered: Number(draftQty[it.saleItemId] ?? 0) || 0,
        })),
      });
      setSelected(updated);
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setMessage('Enregistré');
    } catch {
      setMessage('Échec de la mise à jour');
    } finally {
      setSaving(false);
    }
  }

  async function markAllDelivered() {
    if (!selected || !canManage) return;
    setSaving(true);
    try {
      const updated = await updateDelivery(selected.id, { markDelivered: true });
      setSelected(updated);
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setMessage('Livré');
    } catch {
      setMessage('Échec de la mise à jour');
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
                  </div>
                  <div className="delivery-card-meta">
                    {d.company?.name}
                    {d.department?.name ? ` · ${d.department.name}` : ''}
                  </div>
                  <div className="delivery-card-foot">
                    <span>{formatWhen(d.sale?.createdAt ?? d.createdAt)}</span>
                    <span className="delivery-card-total">{formatMoney(d.sale?.total)}</span>
                  </div>
                </button>
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
                </div>
              </div>
              <span className={`delivery-card-badge ${statusClass(selected.status)}`}>
                {STATUS_LABEL[selected.status]}
              </span>
            </div>

            <div className="delivery-modal-meta">
              <span>{selected.company?.name}</span>
              {selected.department?.name ? <span>{selected.department.name}</span> : null}
              <span>{formatMoney(selected.sale?.total)}</span>
            </div>

            <ul className="delivery-lines">
              {(selected.items ?? []).map((it) => {
                const ordered = Number(it.quantityOrdered);
                const label = it.saleItem?.lineLabel || it.saleItem?.product?.name || 'Article';
                return (
                  <li key={it.id} className="delivery-line">
                    <div className="delivery-line-label">
                      <span>{label}</span>
                      <span className="delivery-muted">× {formatQuantity(ordered)}</span>
                    </div>
                    {canManage && selected.status !== 'DELIVERED' ? (
                      <input
                        type="number"
                        min={0}
                        max={ordered}
                        step="any"
                        value={draftQty[it.saleItemId] ?? '0'}
                        onChange={(e) =>
                          setDraftQty((prev) => ({
                            ...prev,
                            [it.saleItemId]: e.target.value,
                          }))
                        }
                        aria-label={`Livré ${label}`}
                      />
                    ) : (
                      <span className="delivery-line-qty">
                        {formatQuantity(Number(it.quantityDelivered))} / {formatQuantity(ordered)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="modal-actions delivery-modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setSelected(null)}>
                Fermer
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={printingId != null || saving}
                onClick={() => void reprintSaleSlip(selected)}
              >
                {printingId === selected.id ? 'Impression…' : 'Réimprimer fiche'}
              </button>
              {canManage && selected.status !== 'DELIVERED' ? (
                <>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={saving || printingId != null}
                    onClick={() => void savePartial()}
                  >
                    Enregistrer
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
