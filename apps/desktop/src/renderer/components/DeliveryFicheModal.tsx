import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { addDeliveryDrop, getCompanyById, getDeliveryById, getPrinterSettings, getSaleById, updateDelivery } from '../services/api';
import type { Delivery, Department } from '../types/api';
import { formatMoney } from '../utils/currency';
import { formatQuantity } from '../utils/formatQuantity';
import { buildReceiptPayloadFromSale } from '../utils/receiptPayload';
import { buildSaleDetailPrintHtml, openBrowserPrintWindow } from '../utils/saleReceiptBrowserHtml';
import { saleTxnNumber } from '../utils/saleTxnNumber';
import { useAuth } from '../context/AuthContext';
import {
  DELIVERY_STATUS_LABEL,
  deliverySaleRef,
  deliveryStatusClass,
  isHomeDelivery,
} from './deliveryFiche';

function errMsg(err: unknown, fallback: string) {
  if (axios.isAxiosError(err) && err.response?.data && typeof err.response.data === 'object') {
    const m = (err.response.data as { message?: unknown }).message;
    if (Array.isArray(m)) return m.join(', ');
    if (typeof m === 'string' && m.trim()) return m;
  }
  return fallback;
}

type Props = {
  delivery: Delivery;
  departments: Department[];
  lockDepartmentId?: number;
  canManage: boolean;
  canPrint?: boolean;
  executeEnabled?: boolean;
  executorDefault?: string;
  onDisabledAction?: () => void;
  onClose: () => void;
  onUpdated: (d: Delivery) => void;
  onMessage: (msg: string) => void;
};

export function DeliveryFicheModal({
  delivery,
  departments,
  lockDepartmentId,
  canManage,
  canPrint,
  executeEnabled = true,
  executorDefault = '',
  onDisabledAction,
  onClose,
  onUpdated,
  onMessage,
}: Props) {
  const { user } = useAuth();
  const [selected, setSelected] = useState(delivery);
  const [dropSaleItemId, setDropSaleItemId] = useState<number | ''>('');
  const [dropQty, setDropQty] = useState('');
  const [dropDeptId, setDropDeptId] = useState<number | ''>('');
  const [dropExecutor, setDropExecutor] = useState('');
  const [dropStopId, setDropStopId] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);
  const [printingId, setPrintingId] = useState<number | null>(null);

  const home = isHomeDelivery(selected);
  const dropDepartments = useMemo(() => {
    if (lockDepartmentId != null) {
      return departments.filter((d) => d.id === lockDepartmentId);
    }
    return home ? departments.filter((d) => d.offersHomeDelivery) : departments;
  }, [departments, home, lockDepartmentId]);

  function applyForm(d: Delivery) {
    setSelected(d);
    const remainingItem = (d.items ?? []).find((it) => {
      const remaining = Number(
        it.quantityRemaining ?? Math.max(0, Number(it.quantityOrdered) - Number(it.quantityDelivered)),
      );
      return remaining > 0.0001;
    });
    setDropSaleItemId(remainingItem?.saleItemId ?? d.items?.[0]?.saleItemId ?? '');
    setDropQty(
      remainingItem
        ? String(
            Number(
              remainingItem.quantityRemaining ??
                Number(remainingItem.quantityOrdered) - Number(remainingItem.quantityDelivered),
            ),
          )
        : '',
    );
    const locked = lockDepartmentId ?? d.departmentId ?? dropDepartments[0]?.id;
    setDropDeptId(locked ?? '');
    setDropExecutor(d.executorName?.trim() || executorDefault);
    const stops = d.sale?.deliveryStops ?? [];
    const remainingStop = stops.find((s) => Number(s.quantityRemaining ?? s.quantity) > 0.0001);
    setDropStopId(remainingStop?.id ?? stops[0]?.id ?? '');
  }

  useEffect(() => {
    let cancelled = false;
    applyForm(delivery);
    void getDeliveryById(delivery.id)
      .then((full) => {
        if (!cancelled) applyForm(full);
      })
      .catch(() => {
        /* keep the list payload */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-init when the opened fiche changes
  }, [delivery.id, lockDepartmentId, executorDefault]);

  function guardExecute() {
    if (executeEnabled) return true;
    onDisabledAction?.();
    return false;
  }

  async function addLine() {
    if (!canManage || !guardExecute()) return;
    if (dropSaleItemId === '') {
      onMessage('Choisissez un article');
      return;
    }
    const qty = Number(String(dropQty).replace(',', '.'));
    if (!Number.isFinite(qty) || qty <= 0) {
      onMessage('Quantité invalide');
      return;
    }
    if (dropDeptId === '') {
      onMessage('Choisissez le département');
      return;
    }
    if (home && !dropExecutor.trim()) {
      onMessage('Indiquez le livreur');
      return;
    }
    setSaving(true);
    try {
      const updated = await addDeliveryDrop(selected.id, {
        saleItemId: dropSaleItemId,
        quantity: qty,
        departmentId: dropDeptId,
        ...(home
          ? {
              executorName: dropExecutor.trim(),
              stopId: dropStopId === '' ? null : dropStopId,
            }
          : { executorName: dropExecutor.trim() || null }),
      });
      applyForm(updated);
      onUpdated(updated);
      onMessage('Ligne enregistrée');
    } catch (err) {
      onMessage(errMsg(err, 'Échec de la mise à jour'));
    } finally {
      setSaving(false);
    }
  }

  async function markAllDelivered() {
    if (!canManage || !guardExecute()) return;
    if (dropDeptId === '') {
      onMessage('Choisissez le département');
      return;
    }
    if (home && !dropExecutor.trim()) {
      onMessage('Indiquez le livreur');
      return;
    }
    setSaving(true);
    try {
      const updated = await updateDelivery(selected.id, {
        markDelivered: true,
        stockDepartmentId: dropDeptId,
        ...(home
          ? {
              executorName: dropExecutor.trim(),
              stopId: dropStopId === '' ? undefined : dropStopId,
            }
          : {}),
      });
      applyForm(updated);
      onUpdated(updated);
      onMessage('Livré');
    } catch (err) {
      onMessage(errMsg(err, 'Échec de la mise à jour'));
    } finally {
      setSaving(false);
    }
  }

  async function reprintSaleSlip() {
    const saleId = selected.sale?.id ?? selected.saleId;
    if (!saleId) {
      onMessage('Vente introuvable pour impression');
      return;
    }
    setPrintingId(selected.id);
    try {
      const sale = await getSaleById(saleId);
      const cid =
        selected.companyId ||
        sale.items?.[0]?.product?.companyId ||
        (typeof user?.companyId === 'number' ? user.companyId : undefined);
      const deptId =
        selected.departmentId ??
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
          onMessage(result.reason || "L'impression n'a pas pu aboutir");
          return;
        }
        onMessage(`Fiche #${saleTxnNumber(sale)} réimprimée`);
      } else {
        openBrowserPrintWindow(
          buildSaleDetailPrintHtml(sale, company?.name ?? selected.company?.name),
        );
        onMessage('Fenêtre d’impression ouverte');
      }
    } catch {
      onMessage('Impossible de réimprimer la fiche');
    } finally {
      setPrintingId(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card delivery-modal" onClick={(e) => e.stopPropagation()}>
        <div className="delivery-modal-head">
          <div>
            <div className="delivery-modal-ref">Vente #{deliverySaleRef(selected)}</div>
            <div className="delivery-modal-client">
              {selected.sale?.clientName?.trim() || 'Client'}
              {home ? ' · À domicile' : ' · Sur place'}
            </div>
          </div>
          <span className={`delivery-card-badge ${deliveryStatusClass(selected.status)}`}>
            {DELIVERY_STATUS_LABEL[selected.status]}
          </span>
        </div>

        <div className="delivery-modal-meta">
          <span>{selected.company?.name}</span>
          {home
            ? selected.department?.name
              ? <span>Livré depuis {selected.department.name}</span>
              : null
            : selected.department?.name
              ? <span>{selected.department.name}</span>
              : null}
          <span>{formatMoney(selected.sale?.total)}</span>
        </div>
        {home ? (
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
            const remaining = Number(it.quantityRemaining ?? Math.max(0, ordered - delivered));
            const label = it.saleItem?.lineLabel || it.saleItem?.product?.name || 'Article';
            return (
              <li key={it.id} className="delivery-line">
                <div className="delivery-line-label">
                  <span>{label}</span>
                  <span className="delivery-muted">
                    Livré {formatQuantity(delivered)} · Reste {formatQuantity(remaining)} · Commandé{' '}
                    {formatQuantity(ordered)}
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

        {canManage && selected.status !== 'DELIVERED' ? (
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
            {lockDepartmentId == null ? (
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
            ) : null}
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
            {home && (selected.sale?.deliveryStops?.length ?? 0) > 0 ? (
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
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Fermer
          </button>
          {canPrint ? (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={printingId != null || saving}
              onClick={() => void reprintSaleSlip()}
            >
              {printingId === selected.id ? 'Impression…' : 'Réimprimer fiche'}
            </button>
          ) : null}
          {canManage && selected.status !== 'DELIVERED' ? (
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
  );
}
