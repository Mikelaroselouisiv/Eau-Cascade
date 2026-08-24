import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import axios from 'axios';
import {
  createProduct,
  deleteProduct,
  getCompanies,
  getDepartments,
  getPackagingUnits,
  getProductFamilies,
  getProducts,
  getRecipeByProduct,
  stockAdjust,
  stockIn,
  updateProduct,
  upsertRecipe,
} from '../services/api';
import type {
  CompanyListItem,
  Department,
  PackagingUnit,
  Product,
  ProductFamily,
} from '../types/api';
import { useAutoClearMessage } from '../hooks/useAutoClearMessage';
import { useAuth } from '../context/AuthContext';
import { MoneyField } from '../components/MoneyField';
import { ProductFamiliesSection } from '../components/ProductFamiliesSection';
import { PurchasingSection } from '../components/PurchasingSection';
import { formatMoney } from '../utils/currency';
import { formatQuantity } from '../utils/formatQuantity';
import { formatYmd } from '../utils/datetime';
import {
  stockPackagingLabel,
} from '../utils/packagingDisplay';

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
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
}

type StockTab = 'catalog' | 'operations' | 'purchases' | 'families';

function defaultSaleUnit(p: Product) {
  return p.saleUnits?.find((s) => s.isDefault) ?? p.saleUnits?.[0];
}

function defaultUnitPrice(p: Product) {
  const u = defaultSaleUnit(p);
  return u ? Number(u.salePrice) : null;
}

function compareProductsByCompanyDept(a: Product, b: Product): number {
  const ca = (a.company?.name ?? '').localeCompare(b.company?.name ?? '', 'fr', { sensitivity: 'base' });
  if (ca !== 0) return ca;
  const da = (a.department?.name ?? '').localeCompare(b.department?.name ?? '', 'fr', { sensitivity: 'base' });
  if (da !== 0) return da;
  return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
}

type TierDraft = { minQty: string; unitPrice: string };

const DEFAULT_PRODUCT_CARD_COLOR = '#7a5230';
const PRODUCT_CARD_COLOR_PRESETS = [
  '#7a5230',
  '#a67c52',
  '#8b6914',
  '#6b4423',
  '#c4a574',
  '#5c4033',
  '#9a7b4f',
  '#b42318',
];

function ProductCardColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="product-card-color-picker">
      <span className="product-card-color-label">Couleur à la caisse</span>
      <div className="product-card-color-swatches" role="group" aria-label="Couleurs prédéfinies">
        {PRODUCT_CARD_COLOR_PRESETS.map((color) => (
          <button
            key={color}
            type="button"
            className={`product-card-color-swatch${value === color ? ' is-active' : ''}`}
            style={{ backgroundColor: color }}
            aria-label={`Couleur ${color}`}
            aria-pressed={value === color}
            onClick={() => onChange(color)}
          />
        ))}
      </div>
      <label className="product-card-color-custom">
        Personnalisée
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}

export function StockPage() {
  const { can } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [packaging, setPackaging] = useState<PackagingUnit[]>([]);
  const [companies, setCompanies] = useState<CompanyListItem[]>([]);
  const [companyId, setCompanyId] = useState<number | ''>('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState<number | ''>('');
  const [name, setName] = useState('');
  const [cardColor, setCardColor] = useState(DEFAULT_PRODUCT_CARD_COLOR);
  const [price, setPrice] = useState('');
  const [packId, setPackId] = useState<number | ''>('');
  const [volumeTiers, setVolumeTiers] = useState<TierDraft[]>([]);
  const [productFamilyId, setProductFamilyId] = useState<number | ''>('');
  const [productFamilies, setProductFamilies] = useState<ProductFamily[]>([]);
  const [msg, setMsg] = useAutoClearMessage();
  const [tab, setTab] = useState<StockTab>('purchases');
  const [opProductId, setOpProductId] = useState<number | ''>('');
  const [opQty, setOpQty] = useState('');
  const [opReason, setOpReason] = useState('');
  const [opKind, setOpKind] = useState<'in' | 'out'>('in');
  const [opFilterCompanyId, setOpFilterCompanyId] = useState<number | ''>('');
  const [opFilterDeptId, setOpFilterDeptId] = useState<number | ''>('');
  const [opFilterDepartments, setOpFilterDepartments] = useState<Department[]>([]);
  const [opMsg, setOpMsg] = useAutoClearMessage();
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  /** Filtres catalogue (liste à droite) — indépendants du formulaire de création */
  const [catalogFilterCompanyId, setCatalogFilterCompanyId] = useState<number | ''>('');
  const [catalogFilterDeptId, setCatalogFilterDeptId] = useState<number | ''>('');
  const [catalogFilterDepartments, setCatalogFilterDepartments] = useState<Department[]>([]);
  const [catalogAsOf, setCatalogAsOf] = useState('');
  const [catalogAsOfApplied, setCatalogAsOfApplied] = useState('');
  const [catalogStockById, setCatalogStockById] = useState<Map<number, number> | null>(null);
  const [catalogAsOfLoading, setCatalogAsOfLoading] = useState(false);
  const [addProductOpen, setAddProductOpen] = useState(false);

  const isAdmin = can(['ADMIN']);

  const stockableProducts = useMemo(
    () =>
      products
        .filter((p) => p.trackStock && !p.isService)
        .sort(compareProductsByCompanyDept),
    [products],
  );

  const opFilteredProducts = useMemo(() => {
    if (opFilterCompanyId === '' || opFilterDeptId === '') return [];
    return stockableProducts
      .filter((p) => (p.companyId ?? p.company?.id) === opFilterCompanyId)
      .filter((p) => p.department?.id === opFilterDeptId)
      .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  }, [stockableProducts, opFilterCompanyId, opFilterDeptId]);

  const opSelectedProduct = useMemo(
    () => (opProductId === '' ? null : products.find((x) => x.id === opProductId) ?? null),
    [opProductId, products],
  );

  const catalogFilteredSorted = useMemo(() => {
    let list = products;
    if (catalogFilterCompanyId !== '') {
      const cid = catalogFilterCompanyId;
      list = list.filter((p) => (p.companyId ?? p.company?.id) === cid);
    }
    if (catalogFilterDeptId !== '') {
      const did = catalogFilterDeptId;
      list = list.filter((p) => p.department?.id === did);
    }
    return [...list].sort(compareProductsByCompanyDept);
  }, [products, catalogFilterCompanyId, catalogFilterDeptId]);

  const load = async () => {
    const [p, co] = await Promise.all([getProducts(), getCompanies()]);
    setProducts(p);
    setCompanies(co);
    if (co.length && companyId === '') setCompanyId(co[0].id);
    if (catalogAsOfApplied.trim()) {
      const hist = await getProducts(undefined, { asOf: catalogAsOfApplied.trim() });
      setCatalogStockById(new Map(hist.map((x) => [x.id, Number(x.stock)])));
    }
  };

  async function applyCatalogAsOf() {
    const asOf = catalogAsOf.trim();
    if (!asOf) {
      setCatalogAsOfApplied('');
      setCatalogStockById(null);
      return;
    }
    setCatalogAsOfLoading(true);
    setMsg('');
    try {
      const hist = await getProducts(undefined, { asOf });
      setCatalogStockById(new Map(hist.map((x) => [x.id, Number(x.stock)])));
      setCatalogAsOfApplied(asOf);
    } catch (err) {
      setMsg(formatApiError(err, 'Impossible de charger le stock rétrospectif.'), { persist: true });
    } finally {
      setCatalogAsOfLoading(false);
    }
  }

  function clearCatalogAsOf() {
    setCatalogAsOf('');
    setCatalogAsOfApplied('');
    setCatalogStockById(null);
  }

  useEffect(() => {
    if (companyId === '') {
      setDepartments([]);
      setDepartmentId('');
      setProductFamilies([]);
      setProductFamilyId('');
      return;
    }
    void getDepartments(companyId).then((d) => {
      setDepartments(d);
      setDepartmentId((prev) => {
        if (prev === '') return '';
        const ok = d.some((x) => x.id === prev);
        return ok ? prev : '';
      });
    });
    void getProductFamilies(companyId)
      .then((rows) => {
        setProductFamilies(rows);
        setProductFamilyId((prev) =>
          prev !== '' && rows.some((f) => f.id === prev) ? prev : '',
        );
      })
      .catch(() => {
        setProductFamilies([]);
        setProductFamilyId('');
      });
  }, [companyId]);

  useEffect(() => {
    if (catalogFilterCompanyId === '') {
      setCatalogFilterDepartments([]);
      setCatalogFilterDeptId('');
      return;
    }
    void getDepartments(catalogFilterCompanyId).then((d) => {
      setCatalogFilterDepartments(d);
      setCatalogFilterDeptId((prev) => {
        if (prev === '') return '';
        return d.some((x) => x.id === prev) ? prev : '';
      });
    });
  }, [catalogFilterCompanyId]);

  useEffect(() => {
    if (opFilterCompanyId === '') {
      setOpFilterDepartments([]);
      setOpFilterDeptId('');
      setOpProductId('');
      return;
    }
    void getDepartments(opFilterCompanyId).then((d) => {
      setOpFilterDepartments(d);
      setOpFilterDeptId((prev) => {
        if (prev === '') return '';
        return d.some((x) => x.id === prev) ? prev : '';
      });
    });
  }, [opFilterCompanyId]);

  useEffect(() => {
    if (opProductId === '') return;
    if (!opFilteredProducts.some((p) => p.id === opProductId)) {
      setOpProductId('');
    }
  }, [opFilteredProducts, opProductId]);

  useEffect(() => {
    void load().catch(() => setMsg('Erreur chargement stock.', { persist: true }));
  }, []);

  useEffect(() => {
    // Sécurité UI: évite l'accès au formulaire d'opérations si le rôle n'est pas ADMIN.
    if (tab === 'operations' && !isAdmin) setTab('purchases');
  }, [tab, isAdmin]);

  useEffect(() => {
    if (departmentId === '') {
      setPackaging([]);
      setPackId('');
      return;
    }
    void getPackagingUnits(departmentId)
      .then((pk) => {
        setPackaging(pk);
        setPackId((prev) => {
          if (prev !== '' && pk.some((u) => u.id === prev)) return prev;
          return pk[0]?.id ?? '';
        });
      })
      .catch(() => {
        setPackaging([]);
        setPackId('');
      });
  }, [departmentId]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    const cid = typeof companyId === 'number' ? companyId : companies[0]?.id;
    if (!cid) {
      setMsg('Créez d’abord une entreprise (Configuration → Entreprise).', { persist: true });
      return;
    }
    if (departmentId === '') {
      setMsg('Choisissez un département (les conditionnements sont définis par département).', {
        persist: true,
      });
      return;
    }
    const pid = typeof packId === 'number' ? packId : packaging[0]?.id;
    if (!pid) {
      setMsg('Créez d’abord un conditionnement de vente (Configuration → Conditionnement).', {
        persist: true,
      });
      return;
    }
    const sp = Number(price);
    if (!name.trim() || !Number.isFinite(sp) || sp < 0) return;
    const parsedTiers = volumeTiers
      .map((t) => ({
        minQuantity: Number(t.minQty.replace(',', '.')),
        unitPrice: Number(t.unitPrice.replace(',', '.')),
      }))
      .filter(
        (t) =>
          Number.isFinite(t.minQuantity) &&
          t.minQuantity > 0 &&
          Number.isFinite(t.unitPrice) &&
          t.unitPrice >= 0,
      );
    const seen = new Set<number>();
    for (const t of parsedTiers) {
      if (seen.has(t.minQuantity)) {
        setMsg('Les paliers ne peuvent pas avoir deux fois la même quantité minimale.', { persist: true });
        return;
      }
      seen.add(t.minQuantity);
    }
    try {
      await createProduct({
        name: name.trim(),
        cardColor,
        companyId: cid,
        departmentId,
        productFamilyId: productFamilyId === '' ? null : productFamilyId,
        trackStock: true,
        isService: false,
        saleUnits: [
          {
            packagingUnitId: pid,
            salePrice: sp,
            isDefault: true,
            volumePrices: parsedTiers.length ? parsedTiers : undefined,
          },
        ],
      });
      setName('');
      setPrice('');
      setVolumeTiers([]);
      setProductFamilyId('');
      // Entreprise, département et couleur restent pour enchaîner les créations.
      setMsg('Produit créé (stock initial à 0 — ajustez le stock après réception).');
      await load();
    } catch (err) {
      setMsg(formatApiError(err, 'Échec création produit.'), { persist: true });
    }
  }

  async function onDelete(p: Product) {
    if (!confirm(`Supprimer « ${p.name} » ?`)) return;
    setMsg('');
    try {
      await deleteProduct(p.id);
      setMsg('Produit supprimé.');
      await load();
    } catch {
      setMsg('Suppression impossible (produit déjà vendu ou erreur réseau).', { persist: true });
    }
  }

  async function onStockOperation(e: FormEvent) {
    e.preventDefault();
    setOpMsg('');
    if (opProductId === '') {
      setOpMsg('Choisissez un produit.', { persist: true });
      return;
    }
    const qty = Number(opQty.replace(',', '.'));
    if (!Number.isFinite(qty) || qty <= 0) {
      setOpMsg('Quantité invalide.', { persist: true });
      return;
    }
    const reason = opReason.trim() || undefined;
    try {
      if (opKind === 'in') {
        await stockIn({
          productId: Number(opProductId),
          quantity: qty,
          reason: reason ?? 'Réception / entrée stock',
        });
      } else {
        const prod = products.find((x) => x.id === opProductId);
        if (!prod) return;
        if (Number(prod.stock) < qty) {
          setOpMsg(
            `Stock insuffisant (disponible : ${formatQuantity(Number(prod.stock))} ${stockPackagingLabel(prod)}).`,
            { persist: true },
          );
          return;
        }
        await stockAdjust({
          productId: Number(opProductId),
          quantity: -qty,
          reason: reason ?? 'Sortie manuelle (casse, invendable, etc.)',
        });
      }
      setOpQty('');
      setOpReason('');
      setOpMsg(opKind === 'in' ? 'Entrée enregistrée.' : 'Sortie enregistrée.');
      await load();
    } catch (err) {
      setOpMsg(formatApiError(err, 'Opération impossible.'), { persist: true });
    }
  }

  return (
    <div className="page-inner">
      <header className="page-header">
        <h1>Stock & produits</h1>
      </header>

      <div className="config-tabs" role="tablist" aria-label="Sections stock">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'purchases'}
          className={`tab ${tab === 'purchases' ? 'active' : ''}`}
          onClick={() => setTab('purchases')}
        >
          Achats et réceptions
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'operations'}
          className={`tab ${tab === 'operations' ? 'active' : ''}`}
          disabled={!isAdmin}
          aria-disabled={!isAdmin}
          onClick={() => {
            if (!isAdmin) return;
            setTab('operations');
          }}
        >
          Harmonisation manuelle
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'catalog'}
          className={`tab ${tab === 'catalog' ? 'active' : ''}`}
          onClick={() => setTab('catalog')}
        >
          Produits
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'families'}
          className={`tab ${tab === 'families' ? 'active' : ''}`}
          onClick={() => setTab('families')}
        >
          Familles de produits
        </button>
      </div>

      {tab === 'families' ? (
        <ProductFamiliesSection
          companyId={companyId !== '' ? companyId : catalogFilterCompanyId}
          companies={companies}
          products={products}
          onCompanyChange={(id) => {
            if (id === '') {
              setCompanyId('');
              setCatalogFilterCompanyId('');
              return;
            }
            setCompanyId(id);
            setCatalogFilterCompanyId(id);
          }}
          onChanged={async () => {
            await load();
            const cid = companyId !== '' ? companyId : catalogFilterCompanyId;
            if (cid !== '') {
              try {
                setProductFamilies(await getProductFamilies(Number(cid)));
              } catch {
                setProductFamilies([]);
              }
            }
          }}
        />
      ) : null}

      {tab === 'catalog' ? (
        <>
      <section className="catalog-layout">
        <div className="catalog-add-head">
          <h2>Catalogue</h2>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            aria-expanded={addProductOpen}
            aria-controls="catalog-add-product-panel"
            onClick={() => setAddProductOpen((o) => !o)}
          >
            {addProductOpen ? 'Fermer' : '+ Ajouter un produit'}
          </button>
        </div>
        {addProductOpen ? (
          <div
            className="card catalog-add-card"
            id="catalog-add-product-panel"
            role="region"
            aria-label="Nouveau produit"
          >
            <form className="form-grid catalog-add-form" onSubmit={(e) => void onCreate(e)}>
              <label>
                Entreprise
                <select
                  value={companyId === '' ? '' : String(companyId)}
                  onChange={(e) => {
                    setCompanyId(e.target.value ? Number(e.target.value) : '');
                    setDepartmentId('');
                  }}
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Département
                <select
                  value={departmentId === '' ? '' : String(departmentId)}
                  onChange={(e) => setDepartmentId(e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">— Aucun</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Nom
                <input value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
              <ProductCardColorPicker value={cardColor} onChange={setCardColor} />
              <label>
                Conditionnement
                <select
                  value={packId === '' ? '' : String(packId)}
                  onChange={(e) => setPackId(e.target.value ? Number(e.target.value) : '')}
                >
                  {packaging.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.label} ({u.code})
                    </option>
                  ))}
                </select>
              </label>
              <MoneyField
                label="Prix unitaire"
                min={0}
                step={0.01}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                required
              />
              <label>
                Famille de produits
                <select
                  value={productFamilyId === '' ? '' : String(productFamilyId)}
                  onChange={(e) =>
                    setProductFamilyId(e.target.value ? Number(e.target.value) : '')
                  }
                >
                  <option value="">— Aucune —</option>
                  {productFamilies.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="volume-tiers-block catalog-volume-tiers">
                {volumeTiers.map((row, idx) => (
                  <div key={idx} className="volume-tier-row">
                    <label>
                      À partir de (qté)
                      <input
                        type="number"
                        min={0.0001}
                        step="any"
                        value={row.minQty}
                        onChange={(e) => {
                          const next = [...volumeTiers];
                          next[idx] = { ...next[idx], minQty: e.target.value };
                          setVolumeTiers(next);
                        }}
                      />
                    </label>
                    <MoneyField
                      label="Prix unitaire"
                      min={0}
                      step={0.01}
                      value={row.unitPrice}
                      onChange={(e) => {
                        const next = [...volumeTiers];
                        next[idx] = { ...next[idx], unitPrice: e.target.value };
                        setVolumeTiers(next);
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setVolumeTiers(volumeTiers.filter((_, i) => i !== idx))}
                    >
                      Retirer
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setVolumeTiers([...volumeTiers, { minQty: '', unitPrice: '' }])}
                >
                  + Palier
                </button>
              </div>
              <div className="catalog-add-submit">
                <button type="submit" className="btn btn-primary">
                  Créer
                </button>
              </div>
            </form>
            {msg ? <p className="info-text catalog-add-msg">{msg}</p> : null}
          </div>
        ) : null}

        <div className="card catalog-list-card">
          <h2>
            Produits ({catalogFilteredSorted.length}
            {catalogFilteredSorted.length !== products.length ? ` / ${products.length}` : ''})
          </h2>
          <div className="form-grid" style={{ marginBottom: '1rem', maxWidth: '42rem' }}>
            <label>
              Filtrer par entreprise
              <select
                value={catalogFilterCompanyId === '' ? '' : String(catalogFilterCompanyId)}
                onChange={(e) => {
                  const v = e.target.value;
                  setCatalogFilterCompanyId(v ? Number(v) : '');
                  setCatalogFilterDeptId('');
                }}
              >
                <option value="">Toutes les entreprises</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Filtrer par département
              <select
                value={catalogFilterDeptId === '' ? '' : String(catalogFilterDeptId)}
                onChange={(e) => setCatalogFilterDeptId(e.target.value ? Number(e.target.value) : '')}
                disabled={catalogFilterCompanyId === ''}
              >
                <option value="">Tous les départements</option>
                {catalogFilterDepartments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Stock au
              <input
                type="date"
                value={catalogAsOf}
                max={formatYmd(new Date())}
                onChange={(e) => setCatalogAsOf(e.target.value)}
              />
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={catalogAsOfLoading || !catalogAsOf.trim()}
                onClick={() => void applyCatalogAsOf()}
              >
                {catalogAsOfLoading ? '…' : 'Appliquer'}
              </button>
              {catalogAsOfApplied ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={clearCatalogAsOf}>
                  Stock actuel
                </button>
              ) : null}
            </div>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Entreprise</th>
                  <th>Département</th>
                  <th>Conditionnement</th>
                  <th>Produit</th>
                  <th>SKU</th>
                  <th>Prix défaut (HTG)</th>
                  <th>Stock</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {products.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      Aucun produit. Dépliez « Ajouter un produit » ci-dessus ou vérifiez la connexion au serveur.
                    </td>
                  </tr>
                ) : catalogFilteredSorted.length === 0 ? (
                  <tr>
                    <td colSpan={8}>Aucun produit ne correspond aux filtres choisis.</td>
                  </tr>
                ) : (
                  catalogFilteredSorted.map((p) => {
                    const dp = defaultUnitPrice(p);
                    const displayStock =
                      catalogStockById != null && p.trackStock && !p.isService
                        ? (catalogStockById.get(p.id) ?? Number(p.stock))
                        : Number(p.stock);
                    return (
                      <tr key={p.id}>
                        <td>{p.company?.name ?? (p.companyId != null ? `#${p.companyId}` : '—')}</td>
                        <td>{p.department?.name ?? '—'}</td>
                        <td>
                          <small>{stockPackagingLabel(p)}</small>
                        </td>
                        <td>
                          <strong>{p.name}</strong>
                          {p.isService ? <small> (service)</small> : null}
                          {p.productFamily?.name ? (
                            <small className="dept-hint" style={{ display: 'block' }}>
                              Famille : {p.productFamily.name}
                            </small>
                          ) : null}
                        </td>
                        <td>{p.sku ?? '—'}</td>
                        <td className="journal-amt">{dp != null ? formatMoney(dp) : '—'}</td>
                        <td>{formatQuantity(displayStock)}</td>
                        <td className="table-actions catalog-table-actions">
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => setEditProduct(p)}
                          >
                            Modifier
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => void onDelete(p)}
                          >
                            Supprimer
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
        </>
      ) : null}

      {tab === 'purchases' ? (
        <PurchasingSection
          visible={tab === 'purchases'}
          companyId={companyId}
          departments={departments}
          products={products}
          onStockChanged={() => void load()}
        />
      ) : null}

      {tab === 'operations' && isAdmin ? (
        <section className="card">
          <h2>Harmonisation manuelle</h2>
          {opMsg ? (
            <p className={/enregistrée/i.test(opMsg) ? 'info-text' : 'error-text'}>{opMsg}</p>
          ) : null}
          <form className="form-grid" style={{ maxWidth: '36rem' }} onSubmit={(e) => void onStockOperation(e)}>
            <label>
              Type d’opération
              <select value={opKind} onChange={(e) => setOpKind(e.target.value === 'out' ? 'out' : 'in')}>
                <option value="in">Entrée (augmenter le stock)</option>
                <option value="out">Sortie (diminuer le stock)</option>
              </select>
            </label>
            <label>
              Entreprise
              <select
                value={opFilterCompanyId === '' ? '' : String(opFilterCompanyId)}
                onChange={(e) => {
                  const v = e.target.value;
                  setOpFilterCompanyId(v ? Number(v) : '');
                  setOpFilterDeptId('');
                  setOpProductId('');
                }}
                required
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
              Département
              <select
                value={opFilterDeptId === '' ? '' : String(opFilterDeptId)}
                onChange={(e) => {
                  const v = e.target.value;
                  setOpFilterDeptId(v ? Number(v) : '');
                  setOpProductId('');
                }}
                disabled={opFilterCompanyId === ''}
                required
              >
                <option value="">
                  {opFilterCompanyId === '' ? '— Choisir une entreprise d’abord —' : '— Choisir —'}
                </option>
                {opFilterDepartments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Produit (stock suivi)
              <select
                value={opProductId === '' ? '' : String(opProductId)}
                onChange={(e) => setOpProductId(e.target.value ? Number(e.target.value) : '')}
                disabled={opFilterDeptId === ''}
                required
              >
                <option value="">
                  {opFilterDeptId === ''
                    ? '— Choisir un département d’abord —'
                    : opFilteredProducts.length === 0
                      ? '— Aucun produit dans ce département —'
                      : '— Choisir —'}
                </option>
                {opFilteredProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {stockPackagingLabel(p)} — stock {formatQuantity(Number(p.stock))}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Quantité
              {opSelectedProduct ? (
                <span className="dept-hint" style={{ display: 'block', fontWeight: 400, marginBottom: '0.25rem' }}>
                  Unité : {stockPackagingLabel(opSelectedProduct)}
                </span>
              ) : null}
              <input
                type="number"
                min={0.0001}
                step="any"
                value={opQty}
                onChange={(e) => setOpQty(e.target.value)}
                required
              />
            </label>
            <label>
              Motif (optionnel)
              <input
                value={opReason}
                onChange={(e) => setOpReason(e.target.value)}
                placeholder={
                  opKind === 'in' ? 'Ex. Réception facture F-1024' : 'Ex. Casse, invendable, inventaire'
                }
              />
            </label>
            <button type="submit" className="btn btn-primary">
              {opKind === 'in' ? 'Enregistrer l’entrée' : 'Enregistrer la sortie'}
            </button>
          </form>
          {stockableProducts.length === 0 ? (
            <p className="info-text" style={{ marginTop: '1rem' }}>
              Aucun produit avec stock suivi. Cochez « Suivre le stock » sur un produit ou créez un article physique.
            </p>
          ) : (
            <p className="dept-hint" style={{ marginTop: '1rem', marginBottom: 0 }}>
              Choisissez d’abord l’entreprise et le département pour afficher uniquement les produits concernés.
            </p>
          )}
        </section>
      ) : null}

      {editProduct ? (
        <EditProductModal
          key={editProduct.id}
          product={editProduct}
          products={products}
          companies={companies}
          onClose={() => setEditProduct(null)}
          onSaved={async () => {
            setEditProduct(null);
            await load();
            if (companyId !== '') {
              try {
                setProductFamilies(await getProductFamilies(Number(companyId)));
              } catch {
                /* ignore */
              }
            }
          }}
        />
      ) : null}
    </div>
  );
}

function EditProductModal({
  product,
  products,
  companies,
  onClose,
  onSaved,
}: {
  product: Product;
  products: Product[];
  companies: CompanyListItem[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { can } = useAuth();
  const isAdmin = can(['ADMIN']);
  const initialCompanyId = product.company?.id ?? product.companyId ?? companies[0]?.id ?? 0;
  const [companyId, setCompanyId] = useState<number>(initialCompanyId);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [name, setName] = useState(product.name);
  const [cardColor, setCardColor] = useState(product.cardColor ?? DEFAULT_PRODUCT_CARD_COLOR);
  const [sku, setSku] = useState(product.sku ?? '');
  const [barcode, setBarcode] = useState(product.barcode ?? '');
  const [description, setDescription] = useState(product.description ?? '');
  const [cost, setCost] = useState(String(product.cost ?? 0));
  const [stock, setStock] = useState(String(product.stock ?? 0));
  const [stockMin, setStockMin] = useState(String(product.stockMin ?? 0));
  const [deptId, setDeptId] = useState<string>(product.department ? String(product.department.id) : '');
  const [isService, setIsService] = useState(product.isService);
  const [trackStock, setTrackStock] = useState(product.trackStock);
  const su0 = defaultSaleUnit(product);
  const [salePrice, setSalePrice] = useState(String(su0 ? su0.salePrice : ''));
  const [priceTiers, setPriceTiers] = useState<TierDraft[]>(
    () =>
      su0?.volumePrices?.map((v) => ({
        minQty: String(v.minQuantity),
        unitPrice: String(v.unitPrice),
      })) ?? [],
  );
  const [err, setErr] = useAutoClearMessage();
  const [saving, setSaving] = useState(false);
  const [recipeLines, setRecipeLines] = useState<Array<{ componentProductId: number | ''; qty: string }>>([
    { componentProductId: '', qty: '' },
  ]);
  const [recipeMsg, setRecipeMsg] = useState('');
  const [packagingList, setPackagingList] = useState<PackagingUnit[]>([]);
  const [packagingUnitId, setPackagingUnitId] = useState<number | ''>(su0?.packagingUnitId ?? '');
  const [saleLabelOverride, setSaleLabelOverride] = useState(su0?.labelOverride ?? '');
  const [familyId, setFamilyId] = useState<number | ''>(
    product.productFamilyId ?? product.productFamily?.id ?? '',
  );
  const [families, setFamilies] = useState<ProductFamily[]>([]);

  const mpChoices = useMemo(
    () =>
      products.filter(
        (p) =>
          p.id !== product.id &&
          (p.companyId ?? companyId) === companyId &&
          p.trackStock &&
          !p.isService,
      ),
    [products, product.id, companyId],
  );

  useEffect(() => {
    if (!isService) return;
    setRecipeMsg('');
    void getRecipeByProduct(product.id)
      .then((r) => {
        if (r?.components?.length) {
          setRecipeLines(
            r.components.map((c) => ({
              componentProductId: c.componentProductId,
              qty: String(c.quantityPerParentBaseUnit),
            })),
          );
        } else {
          setRecipeLines([{ componentProductId: '', qty: '' }]);
        }
      })
      .catch(() => setRecipeLines([{ componentProductId: '', qty: '' }]));
  }, [product.id, isService]);

  useEffect(() => {
    if (!companyId) return;
    void getDepartments(companyId).then((d) => {
      setDepartments(d);
      setDeptId((prev) => {
        if (prev === '') return '';
        return d.some((x) => x.id === Number(prev)) ? prev : '';
      });
    });
    void getProductFamilies(companyId)
      .then((rows) => {
        setFamilies(rows);
        setFamilyId((prev) => (prev !== '' && rows.some((f) => f.id === prev) ? prev : ''));
      })
      .catch(() => setFamilies([]));
  }, [companyId]);

  useEffect(() => {
    if (deptId === '') {
      setPackagingList([]);
      return;
    }
    void getPackagingUnits(Number(deptId)).then((list) => {
      setPackagingList(list);
      setPackagingUnitId((prev) => {
        if (typeof prev === 'number' && list.some((x) => x.id === prev)) return prev;
        return list[0]?.id ?? '';
      });
    });
  }, [deptId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    if (!name.trim()) {
      setErr('Le nom est obligatoire.');
      return;
    }
    if (!companyId) {
      setErr('Choisissez une entreprise.');
      return;
    }
    const parsedTiers = priceTiers
      .map((t) => ({
        minQuantity: Number(t.minQty.replace(',', '.')),
        unitPrice: Number(t.unitPrice.replace(',', '.')),
      }))
      .filter(
        (t) =>
          Number.isFinite(t.minQuantity) &&
          t.minQuantity > 0 &&
          Number.isFinite(t.unitPrice) &&
          t.unitPrice >= 0,
      );
    const seen = new Set<number>();
    for (const t of parsedTiers) {
      if (seen.has(t.minQuantity)) {
        setErr('Paliers : quantité minimale en double.');
        return;
      }
      seen.add(t.minQuantity);
    }
    const sp = Number(salePrice);
    if (!Number.isFinite(sp) || sp < 0) {
      setErr('Prix unitaire de base invalide.');
      return;
    }
    if (deptId !== '') {
      if (typeof packagingUnitId !== 'number') {
        setErr('Choisissez un conditionnement pour ce département (Configuration → Conditionnement).');
        return;
      }
    }
    setSaving(true);
    try {
      await updateProduct(product.id, {
        name: name.trim(),
        cardColor,
        companyId,
        sku: sku.trim() || undefined,
        barcode: barcode.trim() || undefined,
        description: description.trim() || undefined,
        ...(isAdmin ? { cost: Number(cost) } : {}),
        stock: Number(stock),
        stockMin: Number(stockMin),
        departmentId: deptId === '' ? null : Number(deptId),
        productFamilyId: familyId === '' ? null : familyId,
        isService,
        trackStock,
        salePrice: sp,
        volumePrices: parsedTiers,
        ...(deptId !== ''
          ? {
              packagingUnitId: packagingUnitId as number,
              labelOverride: saleLabelOverride.trim() || null,
            }
          : {}),
      });
      await onSaved();
    } catch (err) {
      setErr(formatApiError(err, 'Enregistrement impossible.'), { persist: true });
    } finally {
      setSaving(false);
    }
  }

  async function saveRecipe() {
    setRecipeMsg('');
    const components = recipeLines
      .map((l) => ({
        componentProductId: typeof l.componentProductId === 'number' ? l.componentProductId : 0,
        quantityPerParentBaseUnit: Number(l.qty.replace(',', '.')),
      }))
      .filter(
        (l) =>
          l.componentProductId > 0 &&
          Number.isFinite(l.quantityPerParentBaseUnit) &&
          l.quantityPerParentBaseUnit > 0,
      );
    try {
      await upsertRecipe(product.id, { components });
      setRecipeMsg('Recette enregistrée.');
    } catch (err) {
      setRecipeMsg(formatApiError(err, 'Recette impossible.'));
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal card" role="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Modifier le produit</h2>
        <form className="form-grid" onSubmit={(e) => void submit(e)}>
          <label>
            Entreprise *
            <select
              value={companyId || ''}
              onChange={(e) => setCompanyId(Number(e.target.value))}
              required
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Nom *
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <ProductCardColorPicker value={cardColor} onChange={setCardColor} />
          <label>
            SKU
            <input value={sku} onChange={(e) => setSku(e.target.value)} />
          </label>
          <label>
            Code-barres
            <input value={barcode} onChange={(e) => setBarcode(e.target.value)} />
          </label>
          <label>
            Description
            <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label>
            Département
            <select value={deptId} onChange={(e) => setDeptId(e.target.value)}>
              <option value="">—</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Conditionnement (unité de stock) *
            <select
              value={packagingUnitId === '' ? '' : String(packagingUnitId)}
              onChange={(e) => setPackagingUnitId(e.target.value ? Number(e.target.value) : '')}
              required={deptId !== ''}
              disabled={deptId === '' || packagingList.length === 0}
            >
              <option value="">{deptId === '' ? '— Choisir un département —' : '— Choisir —'}</option>
              {packagingList.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label} ({u.code})
                </option>
              ))}
            </select>
          </label>
          <label>
            Libellé à la caisse (optionnel)
            <input
              value={saleLabelOverride}
              onChange={(e) => setSaleLabelOverride(e.target.value)}
              placeholder="Ex. Bouteille 1L"
              disabled={deptId === ''}
            />
          </label>
          {deptId !== '' && packagingList.length === 0 ? (
            <p className="error-text" style={{ gridColumn: '1 / -1', margin: 0 }}>
              Aucun conditionnement pour ce département. Créez-en dans Configuration → Conditionnement.
            </p>
          ) : null}
          {isAdmin ? (
            <MoneyField
              label="Coût"
              min={0}
              step={0.01}
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          ) : null}
          <MoneyField
            label="Prix unitaire"
            min={0}
            step={0.01}
            value={salePrice}
            onChange={(e) => setSalePrice(e.target.value)}
            required
          />
          <label>
            Famille de produits
            <select
              value={familyId === '' ? '' : String(familyId)}
              onChange={(e) => setFamilyId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">— Aucune —</option>
              {families.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <div className="volume-tiers-block">
            {priceTiers.map((row, idx) => (
              <div key={idx} className="volume-tier-row">
                <label>
                  À partir de (qté)
                  <input
                    type="number"
                    min={0.0001}
                    step="any"
                    value={row.minQty}
                    onChange={(e) => {
                      const next = [...priceTiers];
                      next[idx] = { ...next[idx], minQty: e.target.value };
                      setPriceTiers(next);
                    }}
                  />
                </label>
                <MoneyField
                  label="Prix unitaire rabais"
                  min={0}
                  step={0.01}
                  value={row.unitPrice}
                  onChange={(e) => {
                    const next = [...priceTiers];
                    next[idx] = { ...next[idx], unitPrice: e.target.value };
                    setPriceTiers(next);
                  }}
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setPriceTiers(priceTiers.filter((_, i) => i !== idx))}
                >
                  Retirer
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setPriceTiers([...priceTiers, { minQty: '', unitPrice: '' }])}
            >
              + Palier
            </button>
          </div>
          <label>
            Stock
            <input type="number" min={0} step={0.001} value={stock} onChange={(e) => setStock(e.target.value)} />
          </label>
          <label>
            Stock minimum
            <input
              type="number"
              min={0}
              step={0.001}
              value={stockMin}
              onChange={(e) => setStockMin(e.target.value)}
            />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={isService} onChange={(e) => setIsService(e.target.checked)} />
            Service (sans stock)
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={trackStock} onChange={(e) => setTrackStock(e.target.checked)} />
            Suivre le stock
          </label>
          {isService ? (
            <div className="volume-tiers-block" style={{ gridColumn: '1 / -1' }}>
              {recipeLines.map((row, idx) => (
                <div key={idx} className="volume-tier-row">
                  <label>
                    Matière / composant
                    <select
                      value={row.componentProductId === '' ? '' : String(row.componentProductId)}
                      onChange={(e) => {
                        const next = [...recipeLines];
                        next[idx] = {
                          ...next[idx],
                          componentProductId: e.target.value ? Number(e.target.value) : '',
                        };
                        setRecipeLines(next);
                      }}
                    >
                      <option value="">—</option>
                      {mpChoices.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Qté / unité parent
                    <input
                      type="number"
                      min={0.0001}
                      step="any"
                      value={row.qty}
                      onChange={(e) => {
                        const next = [...recipeLines];
                        next[idx] = { ...next[idx], qty: e.target.value };
                        setRecipeLines(next);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setRecipeLines(recipeLines.filter((_, i) => i !== idx))}
                  >
                    Retirer
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() =>
                  setRecipeLines([...recipeLines, { componentProductId: '', qty: '' }])
                }
              >
                + Composant
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void saveRecipe()}>
                Enregistrer la recette
              </button>
              {recipeMsg ? (
                <p className={recipeMsg.includes('enregistrée') ? 'info-text' : 'error-text'}>{recipeMsg}</p>
              ) : null}
            </div>
          ) : null}
          {err ? <p className="error-text">{err}</p> : null}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
