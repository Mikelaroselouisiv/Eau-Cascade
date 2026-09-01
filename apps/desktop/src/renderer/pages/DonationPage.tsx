import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useAutoClearMessage } from '../hooks/useAutoClearMessage';
import {
  createDonation,
  createDonationBeneficiary,
  getCompanies,
  getDepartments,
  getDonationBeneficiary,
  getDonationSummary,
  getProducts,
  listDonationBeneficiaries,
  updateDonationBeneficiary,
} from '../services/api';
import type {
  CompanyListItem,
  Department,
  DonationBeneficiaryDetail,
  DonationBeneficiaryListItem,
  DonationSummary,
  Product,
} from '../types/api';
import { formatDateTime } from '../utils/datetime';
import { formatQuantity } from '../utils/formatQuantity';
import { defaultAssignedPlantDepartmentId, departmentsForUser } from '../utils/user-scope';

function formatApiError(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const d = err.response?.data;
    if (typeof d === 'string' && d.trim()) return d;
    if (d && typeof d === 'object') {
      const m = (d as { message?: unknown }).message;
      if (typeof m === 'string') return m;
      if (Array.isArray(m)) return m.join(', ');
      const e = (d as { error?: unknown }).error;
      if (typeof e === 'string') return e;
    }
    if (err.code === 'ERR_NETWORK') {
      return 'Pas de réponse du serveur (réseau ou API arrêtée).';
    }
    if (typeof err.message === 'string' && err.message.trim()) return err.message;
  }
  return fallback;
}

type PanelMode = 'overview' | 'new-beneficiary' | 'fiche';

export function DonationPage() {
  const { canPerm, user } = useAuth();
  const canManage = canPerm('donation.manage');
  const [message, setMessage] = useAutoClearMessage();

  const [companies, setCompanies] = useState<CompanyListItem[]>([]);
  const [companyId, setCompanyId] = useState<number | ''>('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [summary, setSummary] = useState<DonationSummary | null>(null);
  const [beneficiaries, setBeneficiaries] = useState<DonationBeneficiaryListItem[]>([]);
  const [query, setQuery] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<DonationBeneficiaryDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [mode, setMode] = useState<PanelMode>('overview');

  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newNote, setNewNote] = useState('');
  const [newDeptId, setNewDeptId] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);

  const [showDonateModal, setShowDonateModal] = useState(false);
  const [donateDeptId, setDonateDeptId] = useState<number | ''>('');
  const [products, setProducts] = useState<Product[]>([]);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [donateNote, setDonateNote] = useState('');
  const [donateBusy, setDonateBusy] = useState(false);

  const [editNote, setEditNote] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const list = await getCompanies();
        setCompanies(list);
        setCompanyId(list[0]?.id ?? '');
      } catch (e) {
        setMessage(formatApiError(e, 'Impossible de charger les entreprises'), { persist: true });
      }
    })();
  }, [setMessage]);

  useEffect(() => {
    if (typeof companyId !== 'number') return;
    void getDepartments(companyId)
      .then((list) => {
        const scoped = departmentsForUser(list, user);
        setDepartments(scoped);
        setNewDeptId((prev) =>
          prev === '' ? defaultAssignedPlantDepartmentId(scoped, user) : prev,
        );
      })
      .catch(() => setDepartments([]));
  }, [companyId, user]);

  async function refreshList(cid = companyId) {
    if (typeof cid !== 'number') return;
    setLoadingList(true);
    try {
      const [sum, rows] = await Promise.all([
        getDonationSummary(cid),
        listDonationBeneficiaries({ companyId: cid, q: query, includeInactive }),
      ]);
      setSummary(sum);
      setBeneficiaries(rows);
    } catch (e) {
      setMessage(formatApiError(e, 'Erreur chargement dons'), { persist: true });
    } finally {
      setLoadingList(false);
    }
  }

  useEffect(() => {
    void refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, includeInactive]);

  async function openFiche(id: number) {
    setSelectedId(id);
    setMode('fiche');
    setLoadingDetail(true);
    try {
      const d = await getDonationBeneficiary(id);
      setDetail(d);
      setEditNote(d.note ?? '');
    } catch (e) {
      setMessage(formatApiError(e, 'Impossible d’ouvrir la fiche'), { persist: true });
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }

  async function onCreateBeneficiary(e: FormEvent) {
    e.preventDefault();
    if (typeof companyId !== 'number' || !canManage) return;
    setSaving(true);
    try {
      const row = await createDonationBeneficiary({
        companyId,
        name: newName.trim(),
        phone: newPhone.trim() || undefined,
        address: newAddress.trim() || undefined,
        note: newNote.trim() || undefined,
        departmentId: typeof newDeptId === 'number' ? newDeptId : undefined,
      });
      setMessage(`Bénéficiaire « ${newName.trim()} » créé`);
      setNewName('');
      setNewPhone('');
      setNewAddress('');
      setNewNote('');
      await refreshList();
      await openFiche(row.id);
    } catch (err) {
      setMessage(formatApiError(err, 'Création impossible'), { persist: true });
    } finally {
      setSaving(false);
    }
  }

  async function onSaveFiche() {
    if (!detail || !canManage) return;
    try {
      await updateDonationBeneficiary(detail.id, { note: editNote.trim() || null });
      setMessage('Fiche mise à jour');
      await openFiche(detail.id);
    } catch (e) {
      setMessage(formatApiError(e, 'Mise à jour impossible'), { persist: true });
    }
  }

  async function toggleActive() {
    if (!detail || !canManage) return;
    try {
      await updateDonationBeneficiary(detail.id, { isActive: !detail.isActive });
      setMessage(detail.isActive ? 'Bénéficiaire désactivé' : 'Bénéficiaire réactivé');
      await openFiche(detail.id);
      await refreshList();
    } catch (e) {
      setMessage(formatApiError(e, 'Action impossible'), { persist: true });
    }
  }

  async function openDonateModal() {
    if (!detail) return;
    const firstDept = defaultAssignedPlantDepartmentId(departments, user, detail.departmentId);
    setDonateDeptId(firstDept);
    setQty({});
    setDonateNote('');
    setShowDonateModal(true);
    if (typeof firstDept === 'number') {
      try {
        const list = await getProducts(firstDept);
        setProducts(list.filter((p) => p.nature !== 'RAW_MATERIAL'));
      } catch {
        setProducts([]);
      }
    } else {
      setProducts([]);
    }
  }

  async function onDonateDeptChange(id: number | '') {
    setDonateDeptId(id);
    setQty({});
    if (id === '') {
      setProducts([]);
      return;
    }
    try {
      const list = await getProducts(id);
      setProducts(list.filter((p) => p.nature !== 'RAW_MATERIAL'));
    } catch {
      setProducts([]);
    }
  }

  const donateItems = useMemo(
    () =>
      products
        .map((p) => ({ productId: p.id, quantity: Number(qty[p.id] ?? 0) }))
        .filter((i) => i.quantity > 0),
    [products, qty],
  );

  async function submitDonation(e: FormEvent) {
    e.preventDefault();
    if (!detail || !canManage || donateDeptId === '') return;
    if (!donateItems.length) {
      setMessage('Indiquez une quantité.');
      return;
    }
    setDonateBusy(true);
    try {
      await createDonation({
        beneficiaryId: detail.id,
        departmentId: donateDeptId,
        items: donateItems,
        note: donateNote.trim() || undefined,
      });
      setMessage('Don enregistré.');
      setShowDonateModal(false);
      await openFiche(detail.id);
      await refreshList();
    } catch (err) {
      setMessage(formatApiError(err, 'Don impossible'), { persist: true });
    } finally {
      setDonateBusy(false);
    }
  }

  return (
    <div className="page page-inner credit-page">
      <header className="page-header credit-header">
        <div>
          <h1>Dons</h1>
        </div>
        <div className="credit-header-actions">
          <label className="credit-company">
            Entreprise
            <select
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value ? Number(e.target.value) : '');
                setSelectedId(null);
                setDetail(null);
                setMode('overview');
              }}
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {canManage ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setMode('new-beneficiary');
                setSelectedId(null);
                setDetail(null);
              }}
            >
              + Nouveau bénéficiaire
            </button>
          ) : null}
        </div>
      </header>

      {message ? <div className="credit-toast">{message}</div> : null}

      <section className="credit-kpi-strip">
        <div className="credit-kpi credit-kpi-receivable">
          <span className="credit-kpi-label">Bénéficiaires</span>
          <strong className="credit-kpi-value">{summary?.beneficiariesTotal ?? 0}</strong>
        </div>
        <div className="credit-kpi credit-kpi-debt">
          <span className="credit-kpi-label">Dons</span>
          <strong className="credit-kpi-value">{summary?.donationsTotal ?? 0}</strong>
        </div>
        <div className="credit-kpi credit-kpi-clear">
          <span className="credit-kpi-label">Quantité donnée</span>
          <strong className="credit-kpi-value">{formatQuantity(summary?.quantityTotal ?? 0)}</strong>
        </div>
        <div className="credit-kpi credit-kpi-overdue">
          <span className="credit-kpi-label">Dernier don</span>
          <strong className="credit-kpi-value" style={{ fontSize: '1rem' }}>
            {summary?.lastDonationAt ? formatDateTime(summary.lastDonationAt) : '—'}
          </strong>
        </div>
      </section>

      <div className="credit-workspace">
        <aside className="credit-list-panel">
          <div className="credit-list-toolbar">
            <input
              type="search"
              placeholder="Rechercher nom ou téléphone…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void refreshList();
              }}
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void refreshList()}>
              OK
            </button>
          </div>
          <label className="credit-inactive-toggle">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
            />
            Inclure inactifs
          </label>
          <div className="credit-customer-list">
            {loadingList ? <p className="muted">Chargement…</p> : null}
            {!loadingList && beneficiaries.length === 0 ? (
              <p className="muted">Aucun bénéficiaire</p>
            ) : null}
            {beneficiaries.map((b) => (
              <button
                key={b.id}
                type="button"
                className={`credit-customer-row${selectedId === b.id ? ' selected' : ''}`}
                onClick={() => void openFiche(b.id)}
              >
                <span className="credit-row-main">
                  <strong>{b.name}</strong>
                </span>
                <span className="credit-row-meta">
                  <span>{b.donationsCount} don{b.donationsCount > 1 ? 's' : ''}</span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <main className="credit-detail-panel">
          {mode === 'overview' && !detail ? (
            <div className="credit-empty-state">
              <h2>Dons</h2>
            </div>
          ) : null}

          {mode === 'new-beneficiary' ? (
            <form className="credit-form-card" onSubmit={onCreateBeneficiary}>
              <h2>Nouveau bénéficiaire</h2>
              <label>
                Nom *
                <input required value={newName} onChange={(e) => setNewName(e.target.value)} />
              </label>
              <label>
                Téléphone
                <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
              </label>
              <label>
                Adresse
                <input value={newAddress} onChange={(e) => setNewAddress(e.target.value)} />
              </label>
              <label>
                Département
                <select
                  value={newDeptId}
                  onChange={(e) => setNewDeptId(e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">—</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Note
                <textarea value={newNote} onChange={(e) => setNewNote(e.target.value)} rows={3} />
              </label>
              <div className="credit-form-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setMode('overview')}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving || !canManage}>
                  {saving ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </form>
          ) : null}

          {mode === 'fiche' ? (
            loadingDetail ? (
              <p className="muted">Chargement…</p>
            ) : detail ? (
              <div className="credit-fiche">
                <div className="credit-fiche-hero">
                  <div>
                    <h2>{detail.name}</h2>
                    <p className="credit-fiche-contact">
                      {detail.phone || '—'}
                      {detail.address ? ` · ${detail.address}` : ''}
                    </p>
                  </div>
                  <div className="credit-fiche-balances">
                    <div>
                      <span>Dons</span>
                      <strong>{detail.donationsCount}</strong>
                    </div>
                    <div>
                      <span>Quantité</span>
                      <strong>{formatQuantity(detail.quantityTotal)}</strong>
                    </div>
                  </div>
                </div>

                {canManage ? (
                  <div className="credit-fiche-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={!detail.isActive}
                      onClick={() => void openDonateModal()}
                    >
                      Enregistrer un don
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => void toggleActive()}>
                      {detail.isActive ? 'Désactiver' : 'Réactiver'}
                    </button>
                  </div>
                ) : null}

                <section className="credit-section">
                  <h3>Note</h3>
                  <label>
                    <textarea value={editNote} onChange={(e) => setEditNote(e.target.value)} rows={2} />
                  </label>
                  {canManage ? (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => void onSaveFiche()}>
                      Enregistrer
                    </button>
                  ) : null}
                </section>

                <section className="credit-section">
                  <h3>Historique</h3>
                  {detail.donations.length === 0 ? <p className="muted">Aucun don</p> : null}
                  {detail.donations.map((d) => (
                    <details key={d.id} className="credit-sale-details" open>
                      <summary>
                        {formatDateTime(d.createdAt)} — {d.department?.name ?? 'Département'}
                      </summary>
                      <ul>
                        {d.items.map((it) => (
                          <li key={it.id}>
                            {it.product?.name} · {formatQuantity(it.quantity)}
                          </li>
                        ))}
                      </ul>
                      {d.note ? <p className="muted">{d.note}</p> : null}
                    </details>
                  ))}
                </section>
              </div>
            ) : (
              <p className="muted">Fiche introuvable</p>
            )
          ) : null}
        </main>
      </div>

      {showDonateModal && detail ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal card credit-modal">
            <header className="modal-heading">
              <h2>Don — {detail.name}</h2>
              <button type="button" className="btn btn-ghost" onClick={() => setShowDonateModal(false)}>
                Fermer
              </button>
            </header>
            <form onSubmit={submitDonation} className="credit-sale-form">
              <label>
                Département
                <select
                  value={donateDeptId}
                  onChange={(e) => void onDonateDeptChange(e.target.value ? Number(e.target.value) : '')}
                  required
                >
                  <option value="">—</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              {products.map((p) => (
                <label key={p.id}>
                  {p.name}
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={qty[p.id] ?? ''}
                    onChange={(e) => setQty((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  />
                </label>
              ))}
              <label>
                Note
                <textarea value={donateNote} onChange={(e) => setDonateNote(e.target.value)} rows={2} />
              </label>
              <div className="credit-form-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setShowDonateModal(false)}>
                  Annuler
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={donateBusy || donateDeptId === '' || !donateItems.length}
                >
                  {donateBusy ? 'Enregistrement…' : 'Valider'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
