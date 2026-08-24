import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import axios from 'axios';
import { MoneyField } from './MoneyField';
import { useAuth } from '../context/AuthContext';
import { useAutoClearMessage } from '../hooks/useAutoClearMessage';
import {
  createBankTransaction,
  deleteBankTransaction,
  getBankSummary,
  listBankTransactions,
  listBanks,
} from '../services/api';
import type {
  BankAccountRow,
  BankSummary,
  BankTransactionRow,
  BankTransactionType,
} from '../types/api';
import { formatMoney } from '../utils/currency';
import { formatDateTime, formatYmd } from '../utils/datetime';

function formatApiError(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const d = err.response?.data;
    if (typeof d === 'string' && d.trim()) return d;
    if (d && typeof d === 'object') {
      const m = (d as { message?: unknown }).message;
      if (typeof m === 'string') return m;
      if (Array.isArray(m)) return m.join(', ');
    }
  }
  return fallback;
}

type Props = {
  companyId: number;
};

export function DashboardBanksTab({ companyId }: Props) {
  const { can, canPerm } = useAuth();
  const isAdmin = can(['ADMIN']);
  const canManage = canPerm('banks.manage');
  const [msg, setMsg] = useAutoClearMessage();

  const [summary, setSummary] = useState<BankSummary | null>(null);
  const [accounts, setAccounts] = useState<Array<BankAccountRow & { bankName: string }>>([]);
  const [txs, setTxs] = useState<BankTransactionRow[]>([]);
  const [txTotal, setTxTotal] = useState(0);
  const [txSkip, setTxSkip] = useState(0);
  const txTake = 15;
  const [filterAccountId, setFilterAccountId] = useState<number | ''>('');
  const [loading, setLoading] = useState(false);

  const [txAccountId, setTxAccountId] = useState<number | ''>('');
  const [txType, setTxType] = useState<BankTransactionType>('DEPOSIT');
  const [txAmount, setTxAmount] = useState('');
  const [txDesc, setTxDesc] = useState('');
  const [txRef, setTxRef] = useState('');
  const [txDate, setTxDate] = useState(() => formatYmd(new Date()));
  const [saving, setSaving] = useState(false);

  async function refresh(skip = txSkip) {
    setLoading(true);
    try {
      const [sum, banks, ledger] = await Promise.all([
        getBankSummary(companyId),
        listBanks({ companyId }),
        listBankTransactions({
          companyId,
          bankAccountId: typeof filterAccountId === 'number' ? filterAccountId : undefined,
          skip,
          take: txTake,
        }),
      ]);
      setSummary(sum);
      const flat = banks.flatMap((b) =>
        b.accounts.map((a) => ({ ...a, bankName: b.name })),
      );
      setAccounts(flat);
      setTxs(ledger.items);
      setTxTotal(ledger.total);
      setTxSkip(ledger.skip);
      if (txAccountId === '' && flat[0]) setTxAccountId(flat[0].id);
    } catch (e) {
      setMsg(formatApiError(e, 'Chargement banque impossible'), { persist: true });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setTxSkip(0);
    void refresh(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, filterAccountId]);

  const accountOptions = useMemo(
    () => accounts.filter((a) => a.isActive),
    [accounts],
  );

  async function onSubmitTx(e: FormEvent) {
    e.preventDefault();
    if (!canManage || typeof txAccountId !== 'number') return;
    setSaving(true);
    try {
      const result = await createBankTransaction({
        bankAccountId: txAccountId,
        type: txType,
        amount: Number(txAmount),
        description: txDesc.trim(),
        reference: txRef.trim() || undefined,
        occurredOn: txDate,
      });
      setMsg(
        `Transaction enregistrée — solde compte ${formatMoney(result.accountBalance)}`,
      );
      setTxAmount('');
      setTxDesc('');
      setTxRef('');
      await refresh(0);
    } catch (err) {
      setMsg(formatApiError(err, 'Enregistrement impossible'), { persist: true });
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteTx(id: number) {
    if (!isAdmin) return;
    if (!window.confirm('Supprimer cette transaction bancaire ?')) return;
    try {
      await deleteBankTransaction(id, companyId);
      setMsg('Transaction supprimée');
      await refresh(txSkip);
    } catch (e) {
      setMsg(formatApiError(e, 'Suppression impossible'), { persist: true });
    }
  }

  return (
    <div className="banks-dashboard">
      {msg ? <p className="info-text">{msg}</p> : null}

      <section className="credit-kpi-strip" style={{ marginTop: '0.5rem' }}>
        <div className="credit-kpi credit-kpi-clear">
          <span className="credit-kpi-label">Capital bancaire</span>
          <strong className="credit-kpi-value">{formatMoney(summary?.totalCapital ?? 0)}</strong>
        </div>
        <div className="credit-kpi">
          <span className="credit-kpi-label">Banques</span>
          <strong className="credit-kpi-value">{summary?.banksCount ?? 0}</strong>
        </div>
        <div className="credit-kpi">
          <span className="credit-kpi-label">Comptes actifs</span>
          <strong className="credit-kpi-value">{summary?.accountsCount ?? 0}</strong>
        </div>
        <div className="credit-kpi credit-kpi-receivable">
          <span className="credit-kpi-label">Plus gros solde</span>
          <strong className="credit-kpi-value">
            {formatMoney(summary?.accounts?.[0]?.balance ?? 0)}
          </strong>
        </div>
      </section>

      <div className="grid two-col" style={{ marginTop: '1rem' }}>
        {canManage ? (
          <div className="card">
            <h2>Nouvelle transaction</h2>
            <p className="dept-hint">Saisie manuelle — dépôts et retraits.</p>
            <form className="form-grid" onSubmit={(e) => void onSubmitTx(e)}>
              <label>
                Compte *
                <select
                  required
                  value={txAccountId === '' ? '' : String(txAccountId)}
                  onChange={(e) => setTxAccountId(e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">— Choisir</option>
                  {accountOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.bankName} — {a.name}
                      {a.accountNumber ? ` (${a.accountNumber})` : ''} — {formatMoney(a.balance)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Type *
                <select
                  value={txType}
                  onChange={(e) => setTxType(e.target.value as BankTransactionType)}
                >
                  <option value="DEPOSIT">Dépôt (+) </option>
                  <option value="WITHDRAWAL">Retrait (−)</option>
                </select>
              </label>
              <MoneyField
                label="Montant"
                min={0.01}
                step={0.01}
                value={txAmount}
                onChange={(e) => setTxAmount(e.target.value)}
                required
              />
              <label>
                Date
                <input
                  type="date"
                  value={txDate}
                  onChange={(e) => setTxDate(e.target.value)}
                  required
                />
              </label>
              <label>
                Libellé *
                <input required value={txDesc} onChange={(e) => setTxDesc(e.target.value)} />
              </label>
              <label>
                Référence
                <input value={txRef} onChange={(e) => setTxRef(e.target.value)} />
              </label>
              <button type="submit" className="btn btn-primary" disabled={saving || accountOptions.length === 0}>
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
              {accountOptions.length === 0 ? (
                <p className="dept-hint">
                  Aucun compte actif — configurez d’abord une banque dans Configuration → Banques.
                </p>
              ) : null}
            </form>
          </div>
        ) : (
          <div className="card">
            <p className="muted">Consultation seule.</p>
          </div>
        )}

        <div className="card">
          <h2>Soldes par compte</h2>
          {loading && !summary ? <p className="muted">Chargement…</p> : null}
          <div className="bank-balances-list">
            {(summary?.accounts ?? []).map((a) => (
              <div key={a.id} className="bank-balance-row">
                <div>
                  <strong>{a.bankName ?? 'Banque'}</strong>
                  <div className="dept-hint">
                    {a.name}
                    {a.accountNumber ? ` · ${a.accountNumber}` : ''}
                  </div>
                </div>
                <strong className={a.balance < 0 ? 'debt' : 'ok'}>{formatMoney(a.balance)}</strong>
              </div>
            ))}
            {(summary?.accounts ?? []).length === 0 ? (
              <p className="muted">Aucun compte.</p>
            ) : null}
          </div>
          {(summary?.byBank?.length ?? 0) > 0 ? (
            <>
              <h3 style={{ marginTop: '1rem' }}>Par banque</h3>
              <ul className="bank-by-bank">
                {summary!.byBank.map((b) => (
                  <li key={b.id}>
                    <span>
                      {b.name}{' '}
                      <span className="dept-hint">({b.accountsCount} cpt.)</span>
                    </span>
                    <strong>{formatMoney(b.balance)}</strong>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <div className="bank-tx-toolbar">
          <h2 style={{ margin: 0 }}>Historique des mouvements</h2>
          <label>
            Filtrer compte
            <select
              value={filterAccountId === '' ? '' : String(filterAccountId)}
              onChange={(e) => setFilterAccountId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">Tous</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.bankName} — {a.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="table-wrap" style={{ marginTop: '0.75rem' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Compte</th>
                <th>Type</th>
                <th>Libellé</th>
                <th>Montant</th>
                <th>Par</th>
                {isAdmin ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {txs.map((t) => (
                <tr key={t.id}>
                  <td>{formatDateTime(t.occurredAt)}</td>
                  <td>
                    {t.bankAccount.bank.name} — {t.bankAccount.name}
                  </td>
                  <td>
                    <span className={t.type === 'DEPOSIT' ? 'ok' : 'debt'}>
                      {t.type === 'DEPOSIT' ? 'Dépôt' : 'Retrait'}
                    </span>
                  </td>
                  <td>
                    {t.description}
                    {t.reference ? (
                      <div className="dept-hint">Réf. {t.reference}</div>
                    ) : null}
                  </td>
                  <td className={t.type === 'DEPOSIT' ? 'ok' : 'debt'}>
                    {t.type === 'DEPOSIT' ? '+' : '−'}
                    {formatMoney(t.amount)}
                  </td>
                  <td>{t.user?.fullName?.trim() || t.user?.phone || '—'}</td>
                  {isAdmin ? (
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => void onDeleteTx(t.id)}
                      >
                        Suppr.
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
              {txs.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 7 : 6} className="muted">
                    Aucun mouvement
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="journal-pager" style={{ marginTop: '0.75rem' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={txSkip <= 0}
            onClick={() => {
              const next = Math.max(0, txSkip - txTake);
              setTxSkip(next);
              void refresh(next);
            }}
          >
            Précédent
          </button>
          <span className="dept-hint">
            {txTotal === 0
              ? '0'
              : `${txSkip + 1}–${Math.min(txSkip + txTake, txTotal)} / ${txTotal}`}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={txSkip + txTake >= txTotal}
            onClick={() => {
              const next = txSkip + txTake;
              setTxSkip(next);
              void refresh(next);
            }}
          >
            Suivant
          </button>
        </div>
      </div>
    </div>
  );
}
