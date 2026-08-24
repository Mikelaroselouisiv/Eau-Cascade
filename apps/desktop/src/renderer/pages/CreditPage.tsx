import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import axios from 'axios';
import { MoneyField } from '../components/MoneyField';
import { saleTxnNumber } from '../utils/saleTxnNumber';
import { useAuth } from '../context/AuthContext';
import { useAutoClearMessage } from '../hooks/useAutoClearMessage';
import {
  createCreditCustomer,
  createCreditSale,
  getCompanies,
  getCompanyById,
  getCreditCustomer,
  getCreditSummary,
  getDepartments,
  getPrinterSettings,
  getProducts,
  listBanks,
  listCreditCustomers,
  recordCreditPayment,
  updateCreditCustomer,
} from '../services/api';
import type {
  BankRow,
  CompanyListItem,
  CreditCustomerDetail,
  CreditCustomerListItem,
  CreditCustomerStatus,
  CreditSummary,
  Department,
  Product,
} from '../types/api';
import { formatMoney } from '../utils/currency';
import { formatDateTime } from '../utils/datetime';
import { resolveFamilyUnitPrice, resolveVolumeUnitPrice } from '../utils/volumeUnitPrice';

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

const STATUS_LABEL: Record<CreditCustomerStatus, string> = {
  CLEAR: 'À jour',
  PARTIAL: 'En dette',
  OVERDUE: 'En retard',
  AT_LIMIT: 'Plafond atteint',
  BLOCKED: 'Bloqué',
};

type PanelMode = 'overview' | 'new-customer' | 'fiche';
type CartLine = {
  productSaleUnitId: number;
  productId: number;
  productName: string;
  unitLabel: string;
  quantity: number;
};

function creditFamilyQty(
  cart: CartLine[],
  productsById: Map<number, Product>,
): Map<number, number> {
  const qty = new Map<number, number>();
  for (const line of cart) {
    const p = productsById.get(line.productId);
    const fid = p?.productFamilyId ?? p?.productFamily?.id;
    if (fid == null) continue;
    qty.set(fid, (qty.get(fid) ?? 0) + Number(line.quantity));
  }
  return qty;
}

function creditLineUnitPrice(
  product: Product | undefined,
  line: CartLine,
  familyQty: Map<number, number>,
): number {
  if (!product) return 0;
  const su = product.saleUnits?.find((s) => s.id === line.productSaleUnitId);
  if (!su) return 0;
  const fid = product.productFamilyId ?? product.productFamily?.id;
  if (fid != null) {
    const familyTiers = (product.productFamily?.tiers ?? []).map((t) => ({
      minQuantity: Number(t.minQuantity),
      unitPrice: Number(t.unitPrice),
    }));
    const familyPrice = resolveFamilyUnitPrice(familyTiers, familyQty.get(fid) ?? 0);
    if (familyPrice != null) return familyPrice;
  }
  const tiers = (su.volumePrices ?? []).map((v) => ({
    minQuantity: Number(v.minQuantity),
    unitPrice: Number(v.unitPrice),
  }));
  return resolveVolumeUnitPrice(Number(su.salePrice), tiers, line.quantity);
}

export function CreditPage() {
  const { canPerm, user } = useAuth();
  const canManage = canPerm('credit.manage');
  const [message, setMessage] = useAutoClearMessage();

  const [companies, setCompanies] = useState<CompanyListItem[]>([]);
  const [companyId, setCompanyId] = useState<number | ''>('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [summary, setSummary] = useState<CreditSummary | null>(null);
  const [customers, setCustomers] = useState<CreditCustomerListItem[]>([]);
  const [query, setQuery] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<CreditCustomerDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [mode, setMode] = useState<PanelMode>('overview');
  const [statusFilter, setStatusFilter] = useState<'all' | CreditCustomerStatus>('all');

  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newNote, setNewNote] = useState('');
  const [newLimit, setNewLimit] = useState('0');
  const [newDeptId, setNewDeptId] = useState<number | ''>('');
  const [savingCustomer, setSavingCustomer] = useState(false);

  const [showSaleModal, setShowSaleModal] = useState(false);
  const [showPayModal, setShowPayModal] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [productQ, setProductQ] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [downPayment, setDownPayment] = useState('');
  const [saleNote, setSaleNote] = useState('');
  const [saleBusy, setSaleBusy] = useState(false);
  const [printTicket, setPrintTicket] = useState(false);

  const [payAmount, setPayAmount] = useState('');
  const [paySaleId, setPaySaleId] = useState<number | ''>('');
  type PayMethod = 'CASH' | 'CARD' | 'MOBILE_MONEY' | 'BANK';
  const [payMethod, setPayMethod] = useState<PayMethod>('CASH');
  const [payBankId, setPayBankId] = useState<number | ''>('');
  const [payBankAccountId, setPayBankAccountId] = useState<number | ''>('');
  const [banks, setBanks] = useState<BankRow[]>([]);
  const [payNote, setPayNote] = useState('');
  const [payBusy, setPayBusy] = useState(false);

  const [editLimit, setEditLimit] = useState('');
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
      .then(setDepartments)
      .catch(() => setDepartments([]));
  }, [companyId]);

  useEffect(() => {
    if (typeof companyId !== 'number') {
      setBanks([]);
      return;
    }
    void listBanks({ companyId })
      .then((rows) => setBanks(rows.filter((b) => b.isActive)))
      .catch(() => setBanks([]));
  }, [companyId]);

  const payBankAccounts = useMemo(() => {
    if (payBankId === '') return [];
    const bank = banks.find((b) => b.id === payBankId);
    return (bank?.accounts ?? []).filter((a) => a.isActive);
  }, [banks, payBankId]);

  async function refreshList(cid = companyId) {
    if (typeof cid !== 'number') return;
    setLoadingList(true);
    try {
      const [sum, rows] = await Promise.all([
        getCreditSummary(cid),
        listCreditCustomers({ companyId: cid, q: query, includeInactive }),
      ]);
      setSummary(sum);
      setCustomers(rows);
    } catch (e) {
      setMessage(formatApiError(e, 'Erreur chargement crédit'), { persist: true });
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
      const d = await getCreditCustomer(id);
      setDetail(d);
      setEditLimit(String(d.creditLimit));
      setEditNote(d.note ?? '');
    } catch (e) {
      setMessage(formatApiError(e, 'Impossible d’ouvrir la fiche'), { persist: true });
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }

  const filteredCustomers = useMemo(() => {
    if (statusFilter === 'all') return customers;
    return customers.filter((c) => c.status === statusFilter);
  }, [customers, statusFilter]);

  const productsById = useMemo(() => {
    const m = new Map<number, Product>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  const familyQtyMap = useMemo(
    () => creditFamilyQty(cart, productsById),
    [cart, productsById],
  );

  const cartTotal = useMemo(
    () =>
      Math.round(
        cart.reduce((a, l) => {
          const p = productsById.get(l.productId);
          return a + creditLineUnitPrice(p, l, familyQtyMap) * l.quantity;
        }, 0) * 100,
      ) / 100,
    [cart, productsById, familyQtyMap],
  );

  const filteredProducts = useMemo(() => {
    const q = productQ.trim().toLowerCase();
    const forCompany =
      typeof companyId === 'number'
        ? products.filter((p) => p.companyId == null || p.companyId === companyId)
        : products;
    if (!q) return forCompany.slice(0, 40);
    return forCompany
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.sku ?? '').toLowerCase().includes(q) ||
          (p.barcode ?? '').toLowerCase().includes(q),
      )
      .slice(0, 40);
  }, [products, productQ, companyId]);

  async function onCreateCustomer(e: FormEvent) {
    e.preventDefault();
    if (typeof companyId !== 'number' || !canManage) return;
    setSavingCustomer(true);
    try {
      const row = await createCreditCustomer({
        companyId,
        name: newName.trim(),
        phone: newPhone.trim() || undefined,
        address: newAddress.trim() || undefined,
        note: newNote.trim() || undefined,
        creditLimit: Number(newLimit) || 0,
        departmentId: typeof newDeptId === 'number' ? newDeptId : undefined,
      });
      setMessage(`Client « ${newName.trim()} » créé`);
      setNewName('');
      setNewPhone('');
      setNewAddress('');
      setNewNote('');
      setNewLimit('0');
      await refreshList();
      await openFiche(row.id as number);
    } catch (err) {
      setMessage(formatApiError(err, 'Création impossible'), { persist: true });
    } finally {
      setSavingCustomer(false);
    }
  }

  async function onSaveFiche() {
    if (!detail || !canManage) return;
    try {
      await updateCreditCustomer(detail.id, {
        creditLimit: Number(editLimit) || 0,
        note: editNote.trim() || null,
      });
      setMessage('Fiche mise à jour');
      await openFiche(detail.id);
      await refreshList();
    } catch (e) {
      setMessage(formatApiError(e, 'Mise à jour impossible'), { persist: true });
    }
  }

  async function toggleActive() {
    if (!detail || !canManage) return;
    try {
      await updateCreditCustomer(detail.id, { isActive: !detail.isActive });
      setMessage(detail.isActive ? 'Client désactivé' : 'Client réactivé');
      await openFiche(detail.id);
      await refreshList();
    } catch (e) {
      setMessage(formatApiError(e, 'Action impossible'), { persist: true });
    }
  }

  async function openSaleModal() {
    if (!detail) return;
    setShowSaleModal(true);
    setCart([]);
    setDownPayment('');
    setSaleNote('');
    setProductQ('');
    setPrintTicket(false);
    try {
      const list = await getProducts(detail.departmentId ?? undefined);
      setProducts(list);
    } catch {
      setProducts([]);
    }
  }

  function addProductToCart(p: Product) {
    const unit = p.saleUnits.find((u) => u.isDefault) ?? p.saleUnits[0];
    if (!unit) return;
    setCart((prev) => {
      const existing = prev.find((l) => l.productSaleUnitId === unit.id);
      if (existing) {
        return prev.map((l) =>
          l.productSaleUnitId === unit.id ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [
        ...prev,
        {
          productSaleUnitId: unit.id,
          productId: p.id,
          productName: p.name,
          unitLabel: unit.labelOverride || unit.packagingUnit.label,
          quantity: 1,
        },
      ];
    });
  }

  async function submitCreditSale(e: FormEvent) {
    e.preventDefault();
    if (!detail || !canManage || cart.length === 0) return;
    setSaleBusy(true);
    try {
      const result = await createCreditSale({
        creditCustomerId: detail.id,
        items: cart.map((l) => ({ productSaleUnitId: l.productSaleUnitId, quantity: l.quantity })),
        downPayment: Number(downPayment) > 0 ? Number(downPayment) : undefined,
        downPaymentMethod: 'CASH',
        note: saleNote.trim() || undefined,
      });
      setMessage(
        `Vente #${result.txnNumber ?? result.saleId} — total ${formatMoney(result.total)}, reste ${formatMoney(result.balanceDue)} (fiche livraison créée)`,
      );

      if (printTicket && window.desktopApp?.printReceipt) {
        try {
          const company = await getCompanyById(detail.companyId).catch(() => null);
          const deptId = detail.departmentId ?? undefined;
          const printer =
            typeof deptId === 'number' ? await getPrinterSettings(deptId).catch(() => null) : null;
          const cashierLabel =
            user?.fullName?.trim() || user?.phone || 'Caissier';
          await window.desktopApp.printReceipt({
            saleId: result.txnNumber ?? result.saleId,
            companyName: company?.name ?? 'Entreprise',
            companyPhone: company?.phone ?? null,
            address: [company?.address, company?.city].filter(Boolean).join(', ') || '',
            cashier: cashierLabel,
            dateTime: formatDateTime(new Date().toISOString()),
            receiptClientName: detail.name,
            items: cart.map((l) => {
              const pr = productsById.get(l.productId);
              return {
                name: `${l.productName} (${l.unitLabel})`,
                qty: l.quantity,
                price: creditLineUnitPrice(pr, l, familyQtyMap),
              };
            }),
            total: result.total,
            paymentMode: 'À crédit',
            paperWidth: printer?.paperWidth === 80 ? 80 : 58,
            printerName: printer?.deviceName ?? '',
            receiptHeaderText: printer?.receiptHeaderText ?? null,
            receiptFooterText: printer?.receiptFooterText ?? null,
            receiptLogoUrl: printer?.receiptLogoUrl ?? null,
            showLogoOnReceipt: printer?.showLogoOnReceipt ?? true,
            autoCut: printer?.autoCut ?? true,
          });
        } catch {
          setMessage(
            `Vente #${result.txnNumber ?? result.saleId} enregistrée, mais l’impression a échoué`,
            { persist: true },
          );
        }
      }

      setShowSaleModal(false);
      await openFiche(detail.id);
      await refreshList();
    } catch (err) {
      setMessage(formatApiError(err, 'Vente à crédit impossible'), { persist: true });
    } finally {
      setSaleBusy(false);
    }
  }

  async function submitPayment(e: FormEvent) {
    e.preventDefault();
    if (!detail || !canManage) return;
    const amount = Number(payAmount);
    if (!(amount > 0)) {
      setMessage('Montant invalide');
      return;
    }
    if (payMethod === 'BANK') {
      if (payBankId === '' || payBankAccountId === '') {
        setMessage('Choisissez la banque et le compte', { persist: true });
        return;
      }
    }
    setPayBusy(true);
    try {
      const result = await recordCreditPayment({
        creditCustomerId: detail.id,
        amount,
        saleId: typeof paySaleId === 'number' ? paySaleId : undefined,
        method: payMethod,
        ...(payMethod === 'BANK' && typeof payBankAccountId === 'number'
          ? { bankAccountId: payBankAccountId }
          : {}),
        note: payNote.trim() || undefined,
      });
      setMessage(
        `Encaissement ${formatMoney(result.applied)} enregistré${
          payMethod === 'BANK' ? ' (banque + finance entreprise)' : ' (finance entreprise)'
        }${
          result.unused > 0.009 ? ` — surplus non affecté ${formatMoney(result.unused)}` : ''
        }`,
      );
      setShowPayModal(false);
      setPayAmount('');
      setPaySaleId('');
      setPayMethod('CASH');
      setPayBankId('');
      setPayBankAccountId('');
      setPayNote('');
      await openFiche(detail.id);
      await refreshList();
    } catch (err) {
      setMessage(formatApiError(err, 'Paiement impossible'), { persist: true });
    } finally {
      setPayBusy(false);
    }
  }

  return (
    <div className="page page-inner credit-page">
      <header className="page-header credit-header">
        <div>
          <h1>Crédit clients</h1>
          <p className="credit-subtitle">
            Créances autonomes — ventes à crédit (stock), remboursements (journal finance)
          </p>
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
                setMode('new-customer');
                setSelectedId(null);
                setDetail(null);
              }}
            >
              + Nouveau client
            </button>
          ) : null}
        </div>
      </header>

      {message ? <div className="credit-toast">{message}</div> : null}

      <section className="credit-kpi-strip">
        <div className="credit-kpi credit-kpi-receivable">
          <span className="credit-kpi-label">Créances ouvertes</span>
          <strong className="credit-kpi-value">{formatMoney(summary?.totalReceivable ?? 0)}</strong>
        </div>
        <div className="credit-kpi credit-kpi-debt">
          <span className="credit-kpi-label">Clients en dette</span>
          <strong className="credit-kpi-value">{summary?.withDebt ?? 0}</strong>
        </div>
        <div className="credit-kpi credit-kpi-clear">
          <span className="credit-kpi-label">À jour</span>
          <strong className="credit-kpi-value">{summary?.clear ?? 0}</strong>
        </div>
        <div className="credit-kpi credit-kpi-overdue">
          <span className="credit-kpi-label">Retard / plafond</span>
          <strong className="credit-kpi-value">{summary?.overdue ?? 0}</strong>
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
          <div className="credit-filter-chips">
            {(
              [
                ['all', 'Tous'],
                ['PARTIAL', 'En dette'],
                ['OVERDUE', 'Retard'],
                ['AT_LIMIT', 'Plafond'],
                ['CLEAR', 'À jour'],
                ['BLOCKED', 'Bloqués'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`credit-chip${statusFilter === id ? ' active' : ''}`}
                onClick={() => setStatusFilter(id)}
              >
                {label}
              </button>
            ))}
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
            {!loadingList && filteredCustomers.length === 0 ? (
              <p className="muted">Aucun client crédit.</p>
            ) : null}
            {filteredCustomers.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`credit-customer-row status-${c.status.toLowerCase()}${
                  selectedId === c.id ? ' selected' : ''
                }`}
                onClick={() => void openFiche(c.id)}
              >
                <span className="credit-row-main">
                  <strong>{c.name}</strong>
                </span>
                <span className="credit-row-meta">
                  <span className={`credit-status-pill status-${c.status.toLowerCase()}`}>
                    {STATUS_LABEL[c.status]}
                  </span>
                  <span className={`credit-row-balance${c.balance > 0.009 ? ' debt' : ' clear'}`}>
                    {formatMoney(c.balance)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <main className="credit-detail-panel">
          {mode === 'overview' && !detail ? (
            <div className="credit-empty-state">
              <h2>Portefeuille crédit</h2>
              <p>
                Sélectionnez un client pour ouvrir sa fiche, ou créez un nouveau compte crédit. Les
                achats sortent le stock immédiatement ; les remboursements alimentent le journal
                financier de l’entreprise.
              </p>
              {summary?.topDebtors?.length ? (
                <div className="credit-top-debtors">
                  <h3>Plus grosses créances</h3>
                  <ul>
                    {summary.topDebtors.map((d) => (
                      <li key={d.id}>
                        <button type="button" className="btn-link" onClick={() => void openFiche(d.id)}>
                          {d.name}
                        </button>
                        <span>{formatMoney(d.balance)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {mode === 'new-customer' ? (
            <form className="credit-form-card" onSubmit={onCreateCustomer}>
              <h2>Nouveau client crédit</h2>
              <label>
                Nom complet *
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
                Département (optionnel)
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
              <MoneyField
                label="Plafond de crédit"
                value={newLimit}
                onChange={(e) => setNewLimit(e.target.value)}
                min={0}
                step="0.01"
              />
              <label>
                Note interne
                <textarea value={newNote} onChange={(e) => setNewNote(e.target.value)} rows={3} />
              </label>
              <div className="credit-form-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setMode('overview')}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-primary" disabled={savingCustomer || !canManage}>
                  {savingCustomer ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </form>
          ) : null}

          {mode === 'fiche' ? (
            loadingDetail ? (
              <p className="muted">Chargement de la fiche…</p>
            ) : detail ? (
              <div className="credit-fiche">
                <div className={`credit-fiche-hero status-${detail.status.toLowerCase()}`}>
                  <div>
                    <p className={`credit-status-pill status-${detail.status.toLowerCase()}`}>
                      {STATUS_LABEL[detail.status]}
                    </p>
                    <h2>{detail.name}</h2>
                    <p className="credit-fiche-contact">
                      {detail.phone || 'Pas de téléphone'}
                      {detail.address ? ` · ${detail.address}` : ''}
                    </p>
                  </div>
                  <div className="credit-fiche-balances">
                    <div>
                      <span>Solde dû</span>
                      <strong>{formatMoney(detail.balance)}</strong>
                    </div>
                    <div>
                      <span>Plafond</span>
                      <strong>{formatMoney(detail.creditLimit)}</strong>
                    </div>
                    <div>
                      <span>Disponible</span>
                      <strong>{formatMoney(detail.availableCredit)}</strong>
                    </div>
                  </div>
                </div>

                {canManage ? (
                  <div className="credit-fiche-actions">
                    <button type="button" className="btn btn-primary" onClick={() => void openSaleModal()}>
                      Achat à crédit
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={detail.balance <= 0.009}
                      onClick={() => {
                        setPayAmount(detail.balance > 0 ? String(detail.balance) : '');
                        setPaySaleId('');
                        setPayMethod('CASH');
                        setPayBankId('');
                        setPayBankAccountId('');
                        setPayNote('');
                        setShowPayModal(true);
                      }}
                    >
                      Encaisser un remboursement
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => void toggleActive()}>
                      {detail.isActive ? 'Désactiver' : 'Réactiver'}
                    </button>
                  </div>
                ) : null}

                <div className="credit-fiche-grid">
                  <section className="credit-section">
                    <h3>Paramètres</h3>
                    <MoneyField
                      label="Plafond"
                      value={editLimit}
                      onChange={(e) => setEditLimit(e.target.value)}
                      min={0}
                      step="0.01"
                      disabled={!canManage}
                    />
                    <label>
                      Note
                      <textarea
                        value={editNote}
                        onChange={(e) => setEditNote(e.target.value)}
                        rows={2}
                        disabled={!canManage}
                      />
                    </label>
                    {canManage ? (
                      <button type="button" className="btn btn-sm btn-secondary" onClick={() => void onSaveFiche()}>
                        Enregistrer les paramètres
                      </button>
                    ) : null}
                  </section>

                  <section className="credit-section">
                    <h3>Créances ouvertes</h3>
                    <div className="credit-table-wrap">
                      <table className="credit-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Date</th>
                            <th>Total</th>
                            <th>Payé</th>
                            <th>Reste</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.sales.filter((s) => s.balanceDue > 0.009).map((s) => (
                            <tr key={s.id}>
                              <td>{s.id}</td>
                              <td>{formatDateTime(s.createdAt)}</td>
                              <td>{formatMoney(s.total)}</td>
                              <td>{formatMoney(s.amountPaid)}</td>
                              <td className="debt">{formatMoney(s.balanceDue)}</td>
                            </tr>
                          ))}
                          {detail.sales.every((s) => s.balanceDue <= 0.009) ? (
                            <tr>
                              <td colSpan={5} className="muted">
                                Aucune créance ouverte
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>

                <section className="credit-section">
                  <h3>Historique</h3>
                  <ol className="credit-timeline">
                    {detail.timeline.map((ev, idx) => (
                      <li key={`${ev.kind}-${ev.at}-${idx}`} className={`credit-tl-${ev.kind.toLowerCase()}`}>
                        <span className="credit-tl-dot" />
                        <div>
                          <strong>{ev.label}</strong>
                          <span className="credit-tl-meta">
                            {formatDateTime(ev.at)} ·{' '}
                            <em className={ev.kind === 'PAYMENT' ? 'ok' : 'debt'}>
                              {ev.kind === 'PAYMENT' ? '−' : '+'}
                              {formatMoney(ev.amount)}
                            </em>
                          </span>
                        </div>
                      </li>
                    ))}
                    {detail.timeline.length === 0 ? <li className="muted">Pas encore d’historique</li> : null}
                  </ol>
                </section>

                <section className="credit-section">
                  <h3>Détail des achats</h3>
                  {detail.sales.map((s) => (
                    <details key={s.id} className="credit-sale-details">
                      <summary>
                        Vente #{saleTxnNumber(s)} — {formatDateTime(s.createdAt)} — {formatMoney(s.total)}
                        {s.balanceDue > 0.009 ? (
                          <span className="debt"> (reste {formatMoney(s.balanceDue)})</span>
                        ) : (
                          <span className="ok"> (soldée)</span>
                        )}
                      </summary>
                      <ul>
                        {s.items.map((it) => (
                          <li key={it.id}>
                            {it.lineLabel || it.product?.name} × {it.quantity} — {formatMoney(it.subtotal)}
                          </li>
                        ))}
                      </ul>
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

      {showSaleModal && detail ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal card credit-modal">
            <header className="modal-heading">
              <h2>Achat à crédit — {detail.name}</h2>
              <button type="button" className="btn btn-ghost" onClick={() => setShowSaleModal(false)}>
                Fermer
              </button>
            </header>
            <form onSubmit={submitCreditSale} className="credit-sale-form">
              <input
                type="search"
                placeholder="Chercher un produit…"
                value={productQ}
                onChange={(e) => setProductQ(e.target.value)}
              />
              <div className="credit-product-picker">
                {filteredProducts.map((p) => (
                  <button key={p.id} type="button" className="credit-product-chip" onClick={() => addProductToCart(p)}>
                    <strong>{p.name}</strong>
                    <span>
                      {formatMoney(p.saleUnits.find((u) => u.isDefault)?.salePrice ?? p.saleUnits[0]?.salePrice)} · stock{' '}
                      {p.stock}
                    </span>
                  </button>
                ))}
              </div>
              <div className="credit-cart">
                {cart.map((l) => {
                  const pr = productsById.get(l.productId);
                  const unitP = creditLineUnitPrice(pr, l, familyQtyMap);
                  return (
                  <div key={l.productSaleUnitId} className="credit-cart-line">
                    <span>
                      {l.productName} ({l.unitLabel})
                      <small className="muted" style={{ display: 'block' }}>
                        {formatMoney(unitP)} / u
                      </small>
                    </span>
                    <input
                      type="number"
                      min={0.0001}
                      step="any"
                      value={l.quantity}
                      onChange={(e) => {
                        const q = Number(e.target.value);
                        setCart((prev) =>
                          prev.map((x) =>
                            x.productSaleUnitId === l.productSaleUnitId ? { ...x, quantity: q } : x,
                          ),
                        );
                      }}
                    />
                    <span>{formatMoney(unitP * l.quantity)}</span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        setCart((prev) => prev.filter((x) => x.productSaleUnitId !== l.productSaleUnitId))
                      }
                    >
                      ×
                    </button>
                  </div>
                  );
                })}
                {cart.length === 0 ? <p className="muted">Panier vide — ajoutez des produits</p> : null}
              </div>
              <p className="credit-cart-total">
                Total : <strong>{formatMoney(cartTotal)}</strong>
              </p>
              <MoneyField
                label="Acompte (optionnel — board Crédit, hors caisse POS)"
                value={downPayment}
                onChange={(e) => setDownPayment(e.target.value)}
                min={0}
                step="0.01"
              />
              <p className="credit-hint">
                La vente crée une fiche livraison et compte dans les synthèses / journal d’entreprise.
                Elle n’est pas encaissée sur la caisse classique — les remboursements se font ici.
              </p>
              <label>
                Note
                <input value={saleNote} onChange={(e) => setSaleNote(e.target.value)} />
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={printTicket}
                  onChange={(e) => setPrintTicket(e.target.checked)}
                />
                Imprimer le ticket
              </label>
              <div className="credit-form-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setShowSaleModal(false)}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-primary" disabled={saleBusy || cart.length === 0}>
                  {saleBusy ? 'Validation…' : 'Valider la vente à crédit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showPayModal && detail ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal card credit-modal">
            <header className="modal-heading">
              <h2>Remboursement — {detail.name}</h2>
              <button type="button" className="btn btn-ghost" onClick={() => setShowPayModal(false)}>
                Fermer
              </button>
            </header>
            <form onSubmit={submitPayment} className="form-grid">
              <MoneyField
                label="Montant encaissé"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                min={0.01}
                step="0.01"
                required
              />
              <label>
                Affecter à une vente (optionnel — sinon FIFO)
                <select
                  value={paySaleId}
                  onChange={(e) => setPaySaleId(e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">Répartition automatique (plus anciennes d’abord)</option>
                  {detail.sales
                    .filter((s) => s.balanceDue > 0.009)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        #{s.id} — reste {formatMoney(s.balanceDue)}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Mode
                <select
                  value={payMethod}
                  onChange={(e) => {
                    const m = e.target.value as PayMethod;
                    setPayMethod(m);
                    if (m !== 'BANK') {
                      setPayBankId('');
                      setPayBankAccountId('');
                    }
                  }}
                >
                  <option value="CASH">Espèces</option>
                  <option value="CARD">Carte</option>
                  <option value="MOBILE_MONEY">Mobile money</option>
                  <option value="BANK">Banque</option>
                </select>
              </label>
              {payMethod === 'BANK' ? (
                <>
                  <label>
                    Banque
                    <select
                      value={payBankId === '' ? '' : String(payBankId)}
                      onChange={(e) => {
                        const bankId = e.target.value === '' ? '' : Number(e.target.value);
                        setPayBankId(bankId);
                        setPayBankAccountId('');
                      }}
                      required
                    >
                      <option value="">Choisir…</option>
                      {banks.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Compte
                    <select
                      value={payBankAccountId === '' ? '' : String(payBankAccountId)}
                      disabled={payBankId === ''}
                      onChange={(e) => {
                        setPayBankAccountId(
                          e.target.value === '' ? '' : Number(e.target.value),
                        );
                      }}
                      required
                    >
                      <option value="">Choisir…</option>
                      {payBankAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                          {a.accountNumber ? ` (${a.accountNumber})` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : null}
              <label>
                Note
                <input value={payNote} onChange={(e) => setPayNote(e.target.value)} />
              </label>
              <p className="credit-hint">
                {payMethod === 'BANK'
                  ? 'Cet encaissement crédite le compte banque choisi et crée une entrée INCOME « Encaissements crédit ».'
                  : 'Cet encaissement crée une entrée INCOME « Encaissements crédit » dans les transactions financières globales.'}
              </p>
              <div className="credit-form-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setShowPayModal(false)}>
                  Annuler
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={
                    payBusy ||
                    (payMethod === 'BANK' &&
                      (payBankId === '' || payBankAccountId === ''))
                  }
                >
                  {payBusy ? 'Enregistrement…' : 'Encaisser'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
