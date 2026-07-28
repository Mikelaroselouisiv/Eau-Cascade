import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import {
  cancelInventorySession,
  completeInventorySession,
  createInventorySession,
  exportInventoryCountSheetPdf,
  exportInventorySessionsPdf,
  getDepartments,
  getInventoryCountSheet,
  getInventorySession,
  listInventorySessions,
  patchInventoryLine,
} from '../services/api';
import type {
  CompanyListItem,
  InventoryCountSheet,
  InventorySessionDetail,
  InventorySessionKind,
  InventorySessionListItem,
} from '../types/api';
import { formatQuantity } from '../utils/formatQuantity';
import { formatDateTime, formatYmd } from '../utils/datetime';
import { formatUserLabel } from '../utils/userAttribution';

function formatApiError(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const d = err.response?.data;
    if (typeof d === 'string' && d.trim()) return d;
    if (d && typeof d === 'object') {
      const m = (d as { message?: unknown }).message;
      if (typeof m === 'string') return m;
      if (Array.isArray(m)) return m.join(', ');
    }
    if (typeof err.message === 'string' && err.message.trim()) return err.message;
  }
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
}

function kindLabel(k: InventorySessionKind | undefined): string {
  switch (k) {
    case 'OPENING':
      return 'Ouverture de période';
    case 'CLOSING':
      return 'Clôture de période';
    case 'AD_HOC':
      return 'Contrôle ponctuel';
    default:
      return 'Contrôle ponctuel';
  }
}

function referenceStockHint(kind: InventorySessionKind | undefined): string {
  return kind === 'CLOSING'
    ? 'Quantité enregistrée dans le système au moment où cette session a été ouverte.'
    : 'Quantité enregistrée dans le système au démarrage de ce comptage (référence pour l’écart).';
}

function statusLabel(s: InventorySessionListItem['status']): string {
  switch (s) {
    case 'DRAFT':
      return 'Brouillon';
    case 'COMPLETED':
      return 'Validé';
    case 'CANCELLED':
      return 'Annulé';
    default:
      return s;
  }
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

type Props = {
  companies: CompanyListItem[];
  visible: boolean;
  onStockChanged: () => void;
  /** Si fourni, l’historique des comptages est rendu dans ce nœud (en bas de l’onglet Stock). */
  historyPortalTarget?: HTMLElement | null;
};

type SheetProductRow = InventoryCountSheet['products'][number] & {
  departmentId: number;
  departmentName: string;
};

type CombinedSheet = {
  generatedAt: string;
  asOf: string | null;
  products: SheetProductRow[];
};

export function InventoryPhysicalSection({
  companies,
  visible,
  onStockChanged,
  historyPortalTarget = null,
}: Props) {
  const [companyId, setCompanyId] = useState<number | ''>('');
  const [selectedDeptIds, setSelectedDeptIds] = useState<number[]>([]);
  const [departments, setDepartments] = useState<Awaited<ReturnType<typeof getDepartments>>>([]);

  const [sheet, setSheet] = useState<CombinedSheet | null>(null);
  const [sheetLoading, setSheetLoading] = useState(false);

  const [sessions, setSessions] = useState<InventorySessionListItem[]>([]);
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [detail, setDetail] = useState<InventorySessionDetail | null>(null);

  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [exportingSheet, setExportingSheet] = useState(false);
  const [exportingHistory, setExportingHistory] = useState(false);
  const [sessionKind, setSessionKind] = useState<InventorySessionKind>('OPENING');
  const [asOfDate, setAsOfDate] = useState('');
  const [onlyPositiveStock, setOnlyPositiveStock] = useState(true);

  useEffect(() => {
    if (companyId === '') {
      setDepartments([]);
      setSelectedDeptIds([]);
      return;
    }
    void getDepartments(companyId).then((d) => {
      setDepartments(d);
      setSelectedDeptIds((prev) => prev.filter((id) => d.some((x) => x.id === id)));
    });
  }, [companyId]);

  const loadSheet = useCallback(async () => {
    if (selectedDeptIds.length === 0) {
      setSheet(null);
      return;
    }
    setSheetLoading(true);
    setMsg('');
    try {
      const asOf = asOfDate.trim() || undefined;
      const sheets = await Promise.all(
        selectedDeptIds.map((id) =>
          getInventoryCountSheet(id, { asOf, onlyPositiveStock }),
        ),
      );
      const products: SheetProductRow[] = [];
      let generatedAt = new Date().toISOString();
      let asOfIso: string | null = null;
      for (const s of sheets) {
        generatedAt = s.generatedAt;
        asOfIso = s.asOf ?? asOfIso;
        const deptName = s.department.name;
        const deptId = s.department.id;
        for (const p of s.products) {
          products.push({ ...p, departmentId: deptId, departmentName: deptName });
        }
      }
      setSheet({ generatedAt, asOf: asOfIso, products });
    } catch (err) {
      setSheet(null);
      setMsg(formatApiError(err, 'Impossible de charger la feuille d’inventaire.'));
    } finally {
      setSheetLoading(false);
    }
  }, [selectedDeptIds, asOfDate, onlyPositiveStock]);

  const loadSessions = useCallback(async () => {
    setMsg('');
    try {
      const list = await listInventorySessions({
        companyId: companyId !== '' ? companyId : undefined,
      });
      const filtered =
        selectedDeptIds.length > 0
          ? list.filter((s) => selectedDeptIds.includes(s.departmentId))
          : list;
      setSessions(filtered);
    } catch (err) {
      setMsg(formatApiError(err, 'Chargement des sessions impossible.'));
    }
  }, [companyId, selectedDeptIds]);

  useEffect(() => {
    if (!visible) return;
    void loadSheet();
    void loadSessions();
  }, [visible, loadSheet, loadSessions]);

  const draftSessions = useMemo(
    () => sessions.filter((s) => s.status === 'DRAFT'),
    [sessions],
  );

  const countedProgress = useMemo(() => {
    if (!detail || detail.status !== 'DRAFT') return null;
    const total = detail.lines.length;
    const done = detail.lines.filter((l) => l.countedQty != null).length;
    return { done, total };
  }, [detail]);

  function toggleDept(id: number) {
    setSelectedDeptIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function toggleAllDepts() {
    if (selectedDeptIds.length === departments.length) {
      setSelectedDeptIds([]);
    } else {
      setSelectedDeptIds(departments.map((d) => d.id));
    }
  }

  async function openSession(id: number) {
    setMsg('');
    setBusy(true);
    try {
      setDetail(await getInventorySession(id));
      setView('detail');
    } catch (err) {
      setMsg(formatApiError(err, 'Session introuvable.'));
    } finally {
      setBusy(false);
    }
  }

  async function startCountSession() {
    if (selectedDeptIds.length === 0) {
      setMsg('Choisissez au moins un département.');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const opened: InventorySessionDetail[] = [];
      for (const deptId of selectedDeptIds) {
        const existing = draftSessions.find((s) => s.departmentId === deptId);
        if (existing) {
          opened.push(await getInventorySession(existing.id));
          continue;
        }
        opened.push(
          await createInventorySession({
            departmentId: deptId,
            kind: sessionKind,
            onlyPositiveStock,
          }),
        );
      }
      await loadSessions();
      if (opened.length === 1) {
        setDetail(opened[0]);
        setView('detail');
        setMsg(`Session « ${kindLabel(sessionKind)} » ouverte.`);
      } else {
        setMsg(`${opened.length} sessions ouvertes — reprenez-les dans l’historique.`);
      }
    } catch (err) {
      setMsg(formatApiError(err, 'Impossible d’ouvrir une session.'));
    } finally {
      setBusy(false);
    }
  }

  async function onExportSheet() {
    if (selectedDeptIds.length === 0) {
      setMsg('Choisissez au moins un département.');
      return;
    }
    setExportingSheet(true);
    setMsg('');
    try {
      const co = companies.find((c) => c.id === companyId)?.name ?? 'entreprise';
      const asOfSuffix = asOfDate.trim() ? `_au_${asOfDate.trim()}` : `_${formatYmd(new Date())}`;
      for (const deptId of selectedDeptIds) {
        const blob = await exportInventoryCountSheetPdf(deptId, {
          asOf: asOfDate.trim() || undefined,
          onlyPositiveStock,
        });
        const dept = departments.find((d) => d.id === deptId)?.name ?? 'dept';
        const safe = `${co}_${dept}`.replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_').slice(0, 50);
        downloadBlob(blob, `feuille_inventaire_${safe}${asOfSuffix}.pdf`);
      }
      setMsg(
        selectedDeptIds.length === 1
          ? 'Feuille d’inventaire exportée (PDF).'
          : `${selectedDeptIds.length} feuilles exportées (PDF).`,
      );
    } catch (err) {
      setMsg(formatApiError(err, 'Export PDF impossible.'));
    } finally {
      setExportingSheet(false);
    }
  }

  async function onExportHistory() {
    setExportingHistory(true);
    setMsg('');
    try {
      const blob = await exportInventorySessionsPdf({
        companyId: companyId !== '' ? companyId : undefined,
        departmentId: selectedDeptIds.length === 1 ? selectedDeptIds[0] : undefined,
      });
      downloadBlob(blob, `historique_inventaires_${formatYmd(new Date())}.pdf`);
      setMsg('Historique exporté (PDF).');
    } catch (err) {
      setMsg(formatApiError(err, 'Export historique impossible.'));
    } finally {
      setExportingHistory(false);
    }
  }

  async function saveLine(lineId: number, countedRaw: string) {
    if (!detail) return;
    const trimmed = countedRaw.trim();
    const countedQty = trimmed === '' ? null : Number(trimmed.replace(',', '.'));
    if (countedQty !== null && (!Number.isFinite(countedQty) || countedQty < 0)) {
      setMsg('Quantité comptée invalide.');
      return;
    }
    setMsg('');
    try {
      await patchInventoryLine(detail.id, lineId, { countedQty });
      setDetail(await getInventorySession(detail.id));
    } catch (err) {
      setMsg(formatApiError(err, 'Enregistrement impossible.'));
    }
  }

  async function onComplete() {
    if (!detail) return;
    if (
      !confirm(
        detail.kind === 'CLOSING'
          ? 'Valider l’inventaire de clôture ?\n\nLe stock sera ajusté pour correspondre aux quantités comptées.'
          : detail.kind === 'OPENING'
            ? 'Valider l’inventaire d’ouverture ?\n\nLe stock sera ajusté si vos comptages diffèrent de la référence système.'
            : 'Valider l’inventaire ?\n\nLe stock de chaque produit compté sera ajusté pour correspondre à la quantité saisie.',
      )
    ) {
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      setDetail(await completeInventorySession(detail.id));
      await loadSessions();
      await loadSheet();
      onStockChanged();
      setMsg('Inventaire validé — stocks mis à jour.');
    } catch (err) {
      setMsg(formatApiError(err, 'Validation impossible.'));
    } finally {
      setBusy(false);
    }
  }

  async function onCancelSession() {
    if (!detail) return;
    if (!confirm('Annuler cette session ? Aucun stock ne sera modifié.')) return;
    setBusy(true);
    setMsg('');
    try {
      await cancelInventorySession(detail.id);
      setView('list');
      setDetail(null);
      await loadSessions();
    } catch (err) {
      setMsg(formatApiError(err, 'Annulation impossible.'));
    } finally {
      setBusy(false);
    }
  }

  if (!visible) return null;

  if (view === 'detail' && detail) {
    const readOnly = detail.status !== 'DRAFT';
    return (
      <section className="card">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={() => {
              setView('list');
              setDetail(null);
              void loadSessions();
            }}
          >
            ← Retour
          </button>
          <span className="info-text" style={{ margin: 0 }}>
            {detail.department.company.name} — {detail.department.name} · {kindLabel(detail.kind)} ·{' '}
            {statusLabel(detail.status)}
            {detail.label ? ` · ${detail.label}` : ''}
          </span>
        </div>

        {countedProgress ? (
          <p className="dept-hint" style={{ margin: '0 0 0.75rem' }}>
            Progression : {countedProgress.done} / {countedProgress.total} produit(s) compté(s)
          </p>
        ) : null}

        {msg ? (
          <p className={/validé|exporté|exportée|ouverte|mis à jour/i.test(msg) ? 'info-text' : 'error-text'}>
            {msg}
          </p>
        ) : null}

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Produit</th>
                <th title={referenceStockHint(detail.kind)}>Stock enregistré</th>
                {readOnly ? <th title="Stock système après validation">Stock final</th> : null}
                <th>Compté</th>
                <th>Écart</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.length === 0 ? (
                <tr>
                  <td colSpan={readOnly ? 5 : 4}>Aucun produit avec stock suivi dans ce département.</td>
                </tr>
              ) : (
                detail.lines.map((line) => {
                  const open = Number(line.systemQtyAtOpen);
                  const current = Number(line.product.stock ?? 0);
                  const counted = line.countedQty != null ? Number(line.countedQty) : null;
                  const variance = counted != null ? counted - open : null;
                  return (
                    <tr key={line.id}>
                      <td>
                        <strong>{line.product.name}</strong>
                        {line.product.sku ? <small> · {line.product.sku}</small> : null}
                      </td>
                      <td className="journal-amt">{formatQuantity(open)}</td>
                      {readOnly ? <td className="journal-amt">{formatQuantity(current)}</td> : null}
                      <td style={{ maxWidth: '8rem' }}>
                        {readOnly ? (
                          counted != null ? (
                            <span className="journal-amt">{formatQuantity(counted)}</span>
                          ) : (
                            '—'
                          )
                        ) : (
                          <LineCountInput
                            lineId={line.id}
                            initial={line.countedQty != null ? String(line.countedQty) : ''}
                            onSave={(raw) => void saveLine(line.id, raw)}
                          />
                        )}
                      </td>
                      <td className="journal-amt">
                        {variance != null ? (
                          <span style={{ color: variance === 0 ? '#64748b' : variance > 0 ? '#059669' : '#dc2626' }}>
                            {variance > 0 ? '+' : ''}
                            {formatQuantity(variance)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {!readOnly ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '1rem' }}>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void onComplete()}>
              Valider et ajuster les stocks
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void onCancelSession()}>
              Annuler la session
            </button>
          </div>
        ) : detail.completedAt ? (
          <p className="dept-hint" style={{ marginTop: '1rem' }}>
            Clôturé le {formatDateTime(detail.completedAt)}
            {detail.completedBy ? ` · par ${formatUserLabel(detail.completedBy)}` : ''}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <>
      <section className="card">
        <h2>Inventaire physique</h2>

        <div className="form-grid" style={{ maxWidth: '42rem', marginBottom: '1rem' }}>
          <label>
            Entreprise
            <select
              value={companyId === '' ? '' : String(companyId)}
              onChange={(e) => {
                const v = e.target.value;
                setCompanyId(v ? Number(v) : '');
                setSelectedDeptIds([]);
              }}
            >
              <option value="">— Choisir</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Stock au
            <input
              type="date"
              value={asOfDate}
              max={formatYmd(new Date())}
              onChange={(e) => setAsOfDate(e.target.value)}
            />
          </label>
          {asOfDate ? (
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsOfDate('')}>
                Stock actuel
              </button>
            </div>
          ) : null}
        </div>

        {companyId !== '' ? (
          <div style={{ marginBottom: '1rem' }}>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.75rem',
                alignItems: 'center',
                marginBottom: '0.35rem',
              }}
            >
              <strong>Départements</strong>
              {departments.length > 0 ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={toggleAllDepts}>
                  {selectedDeptIds.length === departments.length ? 'Tout décocher' : 'Tout cocher'}
                </button>
              ) : null}
            </div>
            {departments.length === 0 ? (
              <p className="info-text" style={{ margin: 0 }}>
                Aucun département.
              </p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1.25rem' }}>
                {departments.map((d) => (
                  <li key={d.id}>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={selectedDeptIds.includes(d.id)}
                        onChange={() => toggleDept(d.id)}
                      />
                      {d.name}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {msg ? (
          <p className={/validé|exporté|exportée|ouverte|mis à jour|sessions ouvertes/i.test(msg) ? 'info-text' : 'error-text'}>
            {msg}
          </p>
        ) : null}

        {selectedDeptIds.length === 0 ? null : sheetLoading ? (
          <p className="info-text">Chargement…</p>
        ) : sheet ? (
          <>
            <fieldset
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: '6px',
                padding: '0.75rem 1rem',
                marginBottom: '0.75rem',
                maxWidth: '42rem',
              }}
            >
              <legend style={{ fontWeight: 600, padding: '0 0.25rem' }}>Type de comptage</legend>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
                {(['OPENING', 'CLOSING', 'AD_HOC'] as const).map((k) => (
                  <label key={k} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="sessionKind"
                      value={k}
                      checked={sessionKind === k}
                      onChange={() => setSessionKind(k)}
                    />
                    {kindLabel(k)}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="checkbox-row" style={{ marginBottom: '0.75rem' }}>
              <input
                type="checkbox"
                checked={onlyPositiveStock}
                onChange={(e) => setOnlyPositiveStock(e.target.checked)}
              />
              Inventaire des stocks disponibles (&gt;&nbsp;0) uniquement
            </label>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.5rem',
                alignItems: 'center',
                marginBottom: '0.75rem',
              }}
            >
              <button
                type="button"
                className="btn btn-primary"
                disabled={exportingSheet || sheet.products.length === 0}
                onClick={() => void onExportSheet()}
              >
                {exportingSheet ? 'Export…' : 'Exporter la feuille (PDF)'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy || sheet.products.length === 0}
                onClick={() => void startCountSession()}
              >
                Démarrer le comptage
              </button>
              <span className="dept-hint" style={{ margin: 0 }}>
                {sheet.products.length} produit(s)
                {onlyPositiveStock ? ' · stock > 0' : ''}
                {sheet.asOf ? ` · ${formatDateTime(sheet.asOf)}` : ''}
              </span>
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    {selectedDeptIds.length > 1 ? <th>Département</th> : null}
                    <th>Produit</th>
                    <th>SKU</th>
                    <th>Unité</th>
                    <th>Stock</th>
                    <th>Compté</th>
                    <th>Écart</th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.products.length === 0 ? (
                    <tr>
                      <td colSpan={selectedDeptIds.length > 1 ? 8 : 7}>Aucun produit avec stock suivi.</td>
                    </tr>
                  ) : (
                    sheet.products.map((p, i) => (
                      <tr key={`${p.departmentId}-${p.id}`}>
                        <td>{i + 1}</td>
                        {selectedDeptIds.length > 1 ? <td>{p.departmentName}</td> : null}
                        <td>
                          <strong>{p.name}</strong>
                        </td>
                        <td>{p.sku ?? '—'}</td>
                        <td>
                          <small>{p.unitLabel}</small>
                        </td>
                        <td className="journal-amt">{formatQuantity(p.stock)}</td>
                        <td className="journal-amt" style={{ color: '#94a3b8' }}>
                          —
                        </td>
                        <td className="journal-amt" style={{ color: '#94a3b8' }}>
                          —
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>

      {(() => {
        const historyCard: ReactNode = (
      <section className="card" style={{ marginTop: '1rem' }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.75rem',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '0.75rem',
          }}
        >
          <h2 style={{ margin: 0 }}>Historique des comptages</h2>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={exportingHistory || companyId === ''}
            onClick={() => void onExportHistory()}
          >
            {exportingHistory ? 'Export…' : 'Exporter l’historique (PDF)'}
          </button>
        </div>

        {draftSessions.length > 0 ? (
          <p className="info-text">
            {draftSessions.length} comptage(s) en cours
            {draftSessions.slice(0, 5).map((s) => (
              <button
                key={s.id}
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ marginLeft: '0.35rem' }}
                onClick={() => void openSession(s.id)}
              >
                #{s.id} {s.department.name}
              </button>
            ))}
          </p>
        ) : null}

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Entreprise — Département</th>
                <th>Libellé</th>
                <th>Statut</th>
                <th>Par</th>
                <th>Lignes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    {companyId === ''
                      ? 'Choisissez une entreprise.'
                      : 'Aucune session pour ce filtre.'}
                  </td>
                </tr>
              ) : (
                sessions.map((s) => (
                  <tr key={s.id}>
                    <td>{formatDateTime(s.createdAt)}</td>
                    <td>{kindLabel(s.kind)}</td>
                    <td>
                      {s.department.company.name} — {s.department.name}
                    </td>
                    <td>{s.label ?? '—'}</td>
                    <td>{statusLabel(s.status)}</td>
                    <td>{formatUserLabel(s.createdBy)}</td>
                    <td>{s._count.lines}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => void openSession(s.id)}
                      >
                        Ouvrir
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
        );
        return historyPortalTarget ? createPortal(historyCard, historyPortalTarget) : historyCard;
      })()}
    </>
  );
}

function LineCountInput({
  lineId,
  initial,
  onSave,
}: {
  lineId: number;
  initial: string;
  onSave: (raw: string) => void;
}) {
  const [v, setV] = useState(initial);

  useEffect(() => {
    setV(initial);
  }, [lineId, initial]);

  return (
    <input
      type="number"
      min={0}
      step="any"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v.trim() === initial.trim()) return;
        onSave(v);
      }}
      placeholder="Qté"
    />
  );
}
