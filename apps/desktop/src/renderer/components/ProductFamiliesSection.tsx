import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  createProductFamily,
  deleteProductFamily,
  getProductFamilies,
  updateProductFamily,
} from '../services/api';
import type { Product, ProductFamily } from '../types/api';
import { MoneyField } from '../components/MoneyField';
import { formatMoney } from '../utils/currency';
import { useAutoClearMessage } from '../hooks/useAutoClearMessage';

type TierDraft = { minQty: string; unitPrice: string };

export function ProductFamiliesSection({
  companyId,
  companies,
  products,
  onCompanyChange,
  onChanged,
}: {
  companyId: number | '';
  companies: Array<{ id: number; name: string }>;
  products: Product[];
  onCompanyChange?: (id: number | '') => void;
  onChanged: () => void | Promise<void>;
}) {
  const [families, setFamilies] = useState<ProductFamily[]>([]);
  const [msg, setMsg] = useAutoClearMessage();
  const [name, setName] = useState('');
  const [tiers, setTiers] = useState<TierDraft[]>([{ minQty: '5', unitPrice: '' }]);
  const [selectedProductIds, setSelectedProductIds] = useState<number[]>([]);
  const [editId, setEditId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const companyProducts = useMemo(
    () =>
      products
        .filter((p) => companyId !== '' && p.companyId === companyId)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })),
    [products, companyId],
  );

  async function reload() {
    if (companyId === '') {
      setFamilies([]);
      return;
    }
    const rows = await getProductFamilies(Number(companyId));
    setFamilies(rows);
  }

  useEffect(() => {
    void reload().catch(() => setFamilies([]));
  }, [companyId]);

  function resetForm() {
    setEditId(null);
    setName('');
    setTiers([{ minQty: '5', unitPrice: '' }]);
    setSelectedProductIds([]);
  }

  function startEdit(f: ProductFamily) {
    setEditId(f.id);
    setName(f.name);
    setTiers(
      (f.tiers ?? []).length
        ? f.tiers.map((t) => ({
            minQty: String(t.minQuantity),
            unitPrice: String(t.unitPrice),
          }))
        : [{ minQty: '5', unitPrice: '' }],
    );
    setSelectedProductIds((f.products ?? []).map((p) => p.id));
  }

  function parsedTiers(): Array<{ minQuantity: number; unitPrice: number }> | null {
    const out: Array<{ minQuantity: number; unitPrice: number }> = [];
    for (const t of tiers) {
      const minQuantity = Number(t.minQty);
      const unitPrice = Number(t.unitPrice);
      if (!Number.isFinite(minQuantity) || minQuantity <= 0) return null;
      if (!Number.isFinite(unitPrice) || unitPrice < 0) return null;
      out.push({ minQuantity, unitPrice });
    }
    return out.length ? out : null;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (companyId === '') {
      setMsg('Choisissez une entreprise.', { persist: true });
      return;
    }
    const nameTrim = name.trim();
    const tierRows = parsedTiers();
    if (!nameTrim || !tierRows) {
      setMsg('Nom et paliers valides requis.', { persist: true });
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      if (editId != null) {
        await updateProductFamily(editId, {
          name: nameTrim,
          tiers: tierRows,
          productIds: selectedProductIds,
        });
        setMsg('Famille mise à jour.');
      } else {
        await createProductFamily({
          companyId: Number(companyId),
          name: nameTrim,
          tiers: tierRows,
          productIds: selectedProductIds,
        });
        setMsg('Famille créée.');
      }
      resetForm();
      await reload();
      await onChanged();
    } catch {
      setMsg('Enregistrement impossible.', { persist: true });
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: number) {
    if (!window.confirm('Supprimer cette famille ? Les produits seront détachés.')) return;
    setBusy(true);
    try {
      await deleteProductFamily(id);
      if (editId === id) resetForm();
      await reload();
      await onChanged();
      setMsg('Famille supprimée.');
    } catch {
      setMsg('Suppression impossible.', { persist: true });
    } finally {
      setBusy(false);
    }
  }

  function toggleProduct(id: number) {
    setSelectedProductIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  return (
    <section className="grid two-col" style={{ marginTop: '1rem' }}>
      <div className="card">
        <h2>{editId != null ? 'Modifier la famille' : 'Nouvelle famille de produits'}</h2>
        <p className="dept-hint">
          Les quantités du panier de tous les produits de la famille sont additionnées pour
          appliquer le palier (ex. 2 Pepsi + 3 Red Bull = 5 → prix palier sur chaque ligne).
        </p>
        {onCompanyChange ? (
          <label style={{ display: 'block', marginBottom: '0.75rem' }}>
            Entreprise
            <select
              value={companyId === '' ? '' : String(companyId)}
              onChange={(e) =>
                onCompanyChange(e.target.value ? Number(e.target.value) : '')
              }
            >
              <option value="">— Choisir —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {companyId === '' ? (
          <p className="dept-hint">Choisissez une entreprise pour gérer les familles.</p>
        ) : (
          <form className="form-grid" onSubmit={(e) => void onSubmit(e)}>
            <label>
              Nom de la famille
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <div className="volume-tiers-block">
              <strong>Paliers de prix</strong>
              {tiers.map((row, idx) => (
                <div key={idx} className="volume-tier-row">
                  <label>
                    À partir de (qté famille)
                    <input
                      type="number"
                      min={0.0001}
                      step="any"
                      value={row.minQty}
                      onChange={(e) => {
                        const next = [...tiers];
                        next[idx] = { ...next[idx], minQty: e.target.value };
                        setTiers(next);
                      }}
                      required
                    />
                  </label>
                  <MoneyField
                    label="Prix unitaire"
                    min={0}
                    step={0.01}
                    value={row.unitPrice}
                    onChange={(e) => {
                      const next = [...tiers];
                      next[idx] = { ...next[idx], unitPrice: e.target.value };
                      setTiers(next);
                    }}
                    required
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setTiers(tiers.filter((_, i) => i !== idx))}
                    disabled={tiers.length <= 1}
                  >
                    Retirer
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setTiers([...tiers, { minQty: '', unitPrice: '' }])}
              >
                + Palier
              </button>
            </div>
            <fieldset>
              <legend>Produits de la famille</legend>
              <div style={{ maxHeight: '14rem', overflow: 'auto', display: 'grid', gap: '0.35rem' }}>
                {companyProducts.length === 0 ? (
                  <span className="dept-hint">Aucun produit pour cette entreprise.</span>
                ) : (
                  companyProducts.map((p) => (
                    <label key={p.id} className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={selectedProductIds.includes(p.id)}
                        onChange={() => toggleProduct(p.id)}
                      />
                      {p.name}
                      {p.department?.name ? ` · ${p.department.name}` : ''}
                    </label>
                  ))
                )}
              </div>
            </fieldset>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {editId != null ? 'Enregistrer' : 'Créer la famille'}
              </button>
              {editId != null ? (
                <button type="button" className="btn btn-secondary" onClick={resetForm} disabled={busy}>
                  Annuler
                </button>
              ) : null}
            </div>
          </form>
        )}
        {msg ? <p className="info-text">{msg}</p> : null}
      </div>

      <div className="card">
        <h2>Familles ({families.length})</h2>
        {families.length === 0 ? (
          <p className="dept-hint">Aucune famille pour cette entreprise.</p>
        ) : (
          <ul className="journal-list">
            {families.map((f) => (
              <li key={f.id} className="journal-row journal-row--actions">
                <span>
                  <strong>{f.name}</strong>
                  <span className="dept-hint" style={{ display: 'block', marginTop: '0.2rem' }}>
                    {(f.tiers ?? [])
                      .map(
                        (t) =>
                          `≥ ${t.minQuantity} → ${formatMoney(Number(t.unitPrice))}`,
                      )
                      .join(' · ') || 'Sans palier'}
                  </span>
                  <span className="dept-hint" style={{ display: 'block' }}>
                    {(f.products ?? []).map((p) => p.name).join(', ') || 'Aucun produit'}
                  </span>
                </span>
                <span />
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => startEdit(f)}
                >
                  Modifier
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => void onDelete(f.id)}
                >
                  Supprimer
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
