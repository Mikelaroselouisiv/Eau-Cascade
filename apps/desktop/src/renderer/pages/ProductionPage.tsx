import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  claimProductionSession,
  closeProductionSession,
  getCompanies,
  getDepartments,
  getProductionCountSheet,
  getProductionSessionContext,
  getProducts,
  openProductionSession,
} from '../services/api';
import type {
  CompanyListItem,
  Department,
  InventoryCountSheetRow,
  Product,
  ProductionSessionDetail,
} from '../types/api';
import { useAuth } from '../context/AuthContext';
import { getPosDeviceId, getPosDeviceName } from '../services/pos-device';
import { departmentsForUser } from '../utils/user-scope';
import { RegisterStockCountForm } from '../components/RegisterStockCountForm';
import { ProductionOutflowSection } from '../components/ProductionOutflowSection';

function errMsg(err: unknown, fallback: string) {
  if (axios.isAxiosError(err) && err.response?.data && typeof err.response.data === 'object') {
    const m = (err.response.data as { message?: unknown }).message;
    if (Array.isArray(m)) return m.join(', ');
    if (typeof m === 'string' && m.trim()) return m;
  }
  return fallback;
}

function sessionHolder(s: ProductionSessionDetail) {
  const who = s.openedBy?.fullName?.trim() || s.openedBy?.phone?.trim() || 'Utilisateur';
  const device = s.openedDeviceName?.trim();
  return device ? `${who} · ${device}` : who;
}

function toCountRows(
  products: Array<{ id: number; name: string; sku?: string | null; stock: number; unitLabel?: string }>,
): InventoryCountSheetRow[] {
  return products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku ?? null,
    stock: p.stock,
    unitLabel: p.unitLabel ?? '',
  }));
}

export function ProductionPage() {
  const { user, canPerm } = useAuth();
  const canOpen = canPerm('production.use');
  const canTransfer = canPerm('transfers.manage');
  const canConfirm = canPerm('transfers.confirm');
  const canManageDeliveries = canPerm('deliveries.manage');
  const canPrintFiche = canPerm('deliveries.print');

  const [companies, setCompanies] = useState<CompanyListItem[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [companyId, setCompanyId] = useState<number | ''>('');
  const [departmentId, setDepartmentId] = useState<number | ''>('');
  const [session, setSession] = useState<ProductionSessionDetail | null>(null);
  const [mineElsewhere, setMineElsewhere] = useState<ProductionSessionDetail | null>(null);
  const [occupancy, setOccupancy] = useState<ProductionSessionDetail | null>(null);
  const [countProducts, setCountProducts] = useState<InventoryCountSheetRow[]>([]);
  const [panel, setPanel] = useState<'open' | 'close' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showClosedAlert, setShowClosedAlert] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);

  const productionEnabled = session != null;
  const plants = useMemo(
    () => departments.filter((d) => d.kind === 'PRODUCTION_DISTRIBUTION'),
    [departments],
  );
  const scopedDepts = useMemo(() => departmentsForUser(departments, user), [user, departments]);
  const currentPlant = plants.find((d) => d.id === departmentId);

  useEffect(() => {
    void getCompanies()
      .then((rows) => {
        setCompanies(rows);
        if (rows.length === 1) setCompanyId(rows[0].id);
      })
      .catch(() => setCompanies([]));
  }, []);

  useEffect(() => {
    if (companyId === '') {
      setDepartments([]);
      return;
    }
    void getDepartments(companyId)
      .then((rows) => {
        const scoped = departmentsForUser(rows, user);
        setDepartments(scoped);
        const firstPlant = scoped.find((d) => d.kind === 'PRODUCTION_DISTRIBUTION');
        setDepartmentId((prev) =>
          prev !== '' && scoped.some((d) => d.id === prev) ? prev : (firstPlant?.id ?? ''),
        );
      })
      .catch(() => setDepartments([]));
  }, [companyId, user]);

  async function loadSession(deptId: number) {
    const ctx = await getProductionSessionContext({
      deviceId: getPosDeviceId(),
      departmentId: deptId,
    });
    setSession(ctx.local);
    setMineElsewhere(ctx.mineElsewhere);
    setOccupancy(ctx.occupancy);
    const sheet = await getProductionCountSheet(deptId);
    setCountProducts(toCountRows(sheet.products));
  }

  useEffect(() => {
    if (departmentId === '') {
      setSession(null);
      setMineElsewhere(null);
      setOccupancy(null);
      setCountProducts([]);
      return;
    }
    void loadSession(departmentId).catch((e) => setMessage(errMsg(e, 'Chargement impossible.')));
    void getProducts(departmentId)
      .then((rows) => setProducts(rows.filter((p) => p.nature !== 'RAW_MATERIAL')))
      .catch(() => setProducts([]));
  }, [departmentId]);

  async function openPanel(mode: 'open' | 'close') {
    setError('');
    if (departmentId !== '') {
      try {
        const sheet = await getProductionCountSheet(departmentId);
        setCountProducts(toCountRows(sheet.products));
      } catch (e) {
        setError(errMsg(e, 'Feuille de comptage impossible.'));
      }
    }
    setPanel(mode);
  }

  async function onOpen(lines: Array<{ productId: number; countedQty: number }>) {
    if (departmentId === '') return;
    setBusy(true);
    setError('');
    try {
      const opened = await openProductionSession({
        departmentId,
        lines,
        deviceId: getPosDeviceId(),
        deviceName: getPosDeviceName(),
      });
      setSession(opened);
      setMineElsewhere(null);
      setOccupancy(opened);
      setPanel(null);
      setMessage('Production ouverte.');
    } catch (e) {
      setError(errMsg(e, 'Ouverture impossible.'));
    } finally {
      setBusy(false);
    }
  }

  async function onClose(lines: Array<{ productId: number; countedQty: number }>) {
    const closeSession = session ?? mineElsewhere;
    if (!closeSession) return;
    setBusy(true);
    setError('');
    try {
      await closeProductionSession(closeSession.id, { lines });
      setSession(null);
      setMineElsewhere(null);
      setOccupancy(null);
      setPanel(null);
      setMessage('Production fermée.');
      if (departmentId !== '') await loadSession(departmentId);
    } catch (e) {
      setError(errMsg(e, 'Fermeture impossible.'));
    } finally {
      setBusy(false);
    }
  }

  async function onClaim() {
    if (!mineElsewhere) return;
    setBusy(true);
    setError('');
    try {
      const next = await claimProductionSession(mineElsewhere.id, {
        deviceId: getPosDeviceId(),
        deviceName: getPosDeviceName(),
      });
      setSession(next);
      setMineElsewhere(null);
      setOccupancy(next);
      setDepartmentId(next.departmentId);
      setMessage('Production reprise sur cet appareil.');
    } catch (e) {
      setError(errMsg(e, 'Impossible de reprendre la production.'));
    } finally {
      setBusy(false);
    }
  }

  function refuseClosedProduction() {
    setShowClosedAlert(true);
  }

  return (
    <div className="page-inner pos-page">
      <header
        className="page-header"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}
      >
        <h1 style={{ margin: 0 }}>Production</h1>
        {session ? (
          <span className="info-text" style={{ margin: 0 }}>
            Ouverte · {session.department?.name ?? currentPlant?.name} · {sessionHolder(session)}
          </span>
        ) : mineElsewhere ? (
          <span className="info-text" style={{ margin: 0 }}>
            Ouverte sur {mineElsewhere.openedDeviceName?.trim() || 'un autre appareil'} ·{' '}
            {mineElsewhere.department?.name} · {sessionHolder(mineElsewhere)}
          </span>
        ) : occupancy ? (
          <span className="info-text" style={{ margin: 0 }}>
            Occupée · {occupancy.department?.name} · {sessionHolder(occupancy)}
          </span>
        ) : null}
        {canOpen && session ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={departmentId === ''}
            onClick={() => void openPanel('close')}
          >
            Fermer production
          </button>
        ) : canOpen && mineElsewhere ? (
          <>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy}
              onClick={() => void onClaim()}
            >
              Reprendre
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void openPanel('close')}
            >
              Fermer production
            </button>
          </>
        ) : canOpen ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={departmentId === '' || occupancy != null || !currentPlant}
            onClick={() => void openPanel('open')}
          >
            Ouvrir production
          </button>
        ) : null}
      </header>

      {message ? <p className="info-text">{message}</p> : null}

      <section className="card" style={{ marginBottom: '0.75rem' }}>
        <div className="form-grid">
          {companies.length > 1 ? (
            <label>
              Entreprise
              <select
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">—</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            Département
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">—</option>
              {plants.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {departmentId !== '' && !currentPlant ? (
          <p className="muted">Ce département n’est pas une unité de production.</p>
        ) : null}
      </section>

      {panel && canOpen ? (
        <section className="card" style={{ marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
            <h2 style={{ margin: 0 }}>
              {panel === 'open' ? 'Ouverture production' : 'Fermeture production'}
            </h2>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy}
              onClick={() => setPanel(null)}
            >
              ×
            </button>
          </div>
          {panel === 'open' ? (
            <RegisterStockCountForm
              key={`open-${countProducts.map((p) => p.id).join('-')}`}
              products={countProducts}
              submitLabel="Ouvrir"
              busy={busy}
              error={error}
              onSubmit={(lines) => void onOpen(lines)}
            />
          ) : session || mineElsewhere ? (
            <RegisterStockCountForm
              key={`close-${countProducts.map((p) => p.id).join('-')}`}
              products={countProducts}
              submitLabel="Fermer"
              busy={busy}
              error={error}
              onSubmit={(lines) => void onClose(lines)}
            />
          ) : null}
        </section>
      ) : null}

      {departmentId !== '' && currentPlant ? (
        <ProductionOutflowSection
          departmentId={departmentId}
          companyId={companyId === '' ? undefined : companyId}
          productionEnabled={productionEnabled}
          products={products}
          scopedDepts={scopedDepts}
          canTransfer={canTransfer}
          canConfirm={canConfirm}
          canManageDeliveries={canManageDeliveries}
          canPrint={canPrintFiche}
          executorDefault={user?.fullName?.trim() || user?.phone || ''}
          onRefuseClosed={refuseClosedProduction}
          onMessage={setMessage}
        />
      ) : null}

      {showClosedAlert ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setShowClosedAlert(false)}
        >
          <div
            className="modal card"
            role="dialog"
            aria-modal
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0 }}>Production fermée</h2>
            <p style={{ margin: '0 0 1rem' }}>
              L’opération n’a pas été enregistrée. Ouvrez la production d’abord.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowClosedAlert(false)}
              >
                OK
              </button>
              {canOpen ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setShowClosedAlert(false);
                    void openPanel('open');
                  }}
                >
                  Ouvrir production
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
