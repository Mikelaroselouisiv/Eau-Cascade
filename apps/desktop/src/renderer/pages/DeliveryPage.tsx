import { useEffect, useMemo, useState } from 'react';
import {
  getCompanies,
  getCompanyById,
  getDepartments,
  getPrinterSettings,
  getSaleById,
  listDeliveries,
} from '../services/api';
import type { CompanyListItem, Delivery, Department } from '../types/api';
import { useAuth } from '../context/AuthContext';
import { useAutoClearMessage } from '../hooks/useAutoClearMessage';
import { buildReceiptPayloadFromSale } from '../utils/receiptPayload';
import { buildSaleDetailPrintHtml, openBrowserPrintWindow } from '../utils/saleReceiptBrowserHtml';
import { saleTxnNumber } from '../utils/saleTxnNumber';
import {
  departmentsForUser,
  isAdminRole,
} from '../utils/user-scope';
import { DeliveryFicheCard } from '../components/DeliveryFicheCard';
import { DeliveryFicheModal } from '../components/DeliveryFicheModal';
import { isHomeDelivery } from '../components/deliveryFiche';

const PAGE_SIZE = 100;

export function DeliveryPage() {
  const { user, canPerm } = useAuth();
  const canManageAll = canPerm('deliveries.manage');
  const canManageOnsite = canPerm('deliveries.manage_onsite');
  const canManageHome = canPerm('deliveries.manage_home');
  const canPrintFiche = canPerm('deliveries.print');
  const lockedScope =
    user?.role === 'CASHIER' || user?.role === 'LIVREUR' || user?.role === 'CHEF_PRODUCTION';
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

  function openCard(d: Delivery) {
    setSelected(d);
  }

  function canManageDelivery(d: Delivery) {
    if (canManageAll) return true;
    return isHomeDelivery(d) ? canManageHome : canManageOnsite;
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
          {user?.role !== 'CASHIER' ? (
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
          ) : null}
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
          {rows.map((d) => (
            <DeliveryFicheCard
              key={d.id}
              delivery={d}
              canPrint={canPrintFiche}
              printing={printingId === d.id}
              printBusy={printingId != null}
              onOpen={openCard}
              onPrint={(row) => void reprintSaleSlip(row)}
            />
          ))}
        </div>
      )}

      {selected ? (
        <DeliveryFicheModal
          delivery={selected}
          departments={departments}
          canManage={canManageDelivery(selected)}
          canPrint={canPrintFiche}
          onClose={() => setSelected(null)}
          onUpdated={(d) => {
            setSelected(d);
            setRows((prev) => prev.map((r) => (r.id === d.id ? d : r)));
          }}
          onMessage={setMessage}
        />
      ) : null}
    </div>
  );
}
