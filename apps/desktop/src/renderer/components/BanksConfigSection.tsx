import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import axios from 'axios';
import { MoneyField } from './MoneyField';
import { useAuth } from '../context/AuthContext';
import {
  createBank,
  createBankAccount,
  getCompanies,
  listBanks,
  updateBank,
  updateBankAccount,
} from '../services/api';
import type { BankRow, CompanyListItem } from '../types/api';
import { formatMoney } from '../utils/currency';

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
  onMessage: (msg: string, opts?: { persist?: boolean }) => void;
};

export function BanksConfigSection({ onMessage }: Props) {
  const { canPerm } = useAuth();
  const canManage = canPerm('banks.manage');

  const [companies, setCompanies] = useState<CompanyListItem[]>([]);
  const [companyId, setCompanyId] = useState<number | ''>('');
  const [banks, setBanks] = useState<BankRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(false);

  const [bankName, setBankName] = useState('');
  const [bankNote, setBankNote] = useState('');
  const [savingBank, setSavingBank] = useState(false);

  const [accountBankId, setAccountBankId] = useState<number | ''>('');
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [openingBalance, setOpeningBalance] = useState('0');
  const [savingAccount, setSavingAccount] = useState(false);

  async function refresh(cid = companyId) {
    if (typeof cid !== 'number') return;
    setLoading(true);
    try {
      setBanks(await listBanks({ companyId: cid, includeInactive }));
    } catch (e) {
      onMessage(formatApiError(e, 'Chargement banques impossible'), { persist: true });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const list = await getCompanies();
        setCompanies(list);
        setCompanyId(list[0]?.id ?? '');
      } catch (e) {
        onMessage(formatApiError(e, 'Impossible de charger les entreprises'), { persist: true });
      }
    })();
  }, [onMessage]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, includeInactive]);

  async function onCreateBank(e: FormEvent) {
    e.preventDefault();
    if (typeof companyId !== 'number' || !canManage) return;
    setSavingBank(true);
    try {
      await createBank({
        companyId,
        name: bankName.trim(),
        note: bankNote.trim() || undefined,
      });
      setBankName('');
      setBankNote('');
      onMessage('Banque créée');
      await refresh();
    } catch (err) {
      onMessage(formatApiError(err, 'Création banque impossible'), { persist: true });
    } finally {
      setSavingBank(false);
    }
  }

  async function onCreateAccount(e: FormEvent) {
    e.preventDefault();
    if (typeof accountBankId !== 'number' || !canManage) return;
    setSavingAccount(true);
    try {
      await createBankAccount({
        bankId: accountBankId,
        name: accountName.trim(),
        accountNumber: accountNumber.trim() || undefined,
        openingBalance: Number(openingBalance) || 0,
      });
      setAccountName('');
      setAccountNumber('');
      setOpeningBalance('0');
      onMessage('Compte bancaire créé');
      await refresh();
    } catch (err) {
      onMessage(formatApiError(err, 'Création compte impossible'), { persist: true });
    } finally {
      setSavingAccount(false);
    }
  }

  return (
    <div className="card form-grid">
      <h2>Banques & comptes</h2>
      <p className="dept-hint" style={{ marginTop: 0 }}>
        Configurez les établissements bancaires et les comptes. Les mouvements se saisissent dans
        Tableau de bord → Banque.
      </p>

      <label>
        Entreprise
        <select
          value={companyId === '' ? '' : String(companyId)}
          onChange={(e) => setCompanyId(e.target.value ? Number(e.target.value) : '')}
        >
          <option value="">— Choisir</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={includeInactive}
          onChange={(e) => setIncludeInactive(e.target.checked)}
        />
        Inclure inactifs
      </label>

      {canManage ? (
        <div className="grid two-col" style={{ gridColumn: '1 / -1' }}>
          <form className="form-grid" onSubmit={onCreateBank}>
            <h3>Nouvelle banque</h3>
            <label>
              Nom *
              <input required value={bankName} onChange={(e) => setBankName(e.target.value)} />
            </label>
            <label>
              Note
              <input value={bankNote} onChange={(e) => setBankNote(e.target.value)} />
            </label>
            <button type="submit" className="btn btn-primary" disabled={savingBank || companyId === ''}>
              {savingBank ? '…' : 'Ajouter la banque'}
            </button>
          </form>

          <form className="form-grid" onSubmit={onCreateAccount}>
            <h3>Nouveau compte</h3>
            <label>
              Banque *
              <select
                required
                value={accountBankId === '' ? '' : String(accountBankId)}
                onChange={(e) => setAccountBankId(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">— Choisir</option>
                {banks
                  .filter((b) => b.isActive)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Libellé du compte *
              <input required value={accountName} onChange={(e) => setAccountName(e.target.value)} />
            </label>
            <label>
              N° de compte
              <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
            </label>
            <MoneyField
              label="Solde d’ouverture"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
              step="0.01"
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={savingAccount || accountBankId === ''}
            >
              {savingAccount ? '…' : 'Ajouter le compte'}
            </button>
          </form>
        </div>
      ) : null}

      <div style={{ gridColumn: '1 / -1' }}>
        {loading ? <p className="muted">Chargement…</p> : null}
        {!loading && banks.length === 0 ? <p className="muted">Aucune banque configurée.</p> : null}
        {banks.map((b) => (
          <div key={b.id} className="bank-config-card">
            <div className="bank-config-head">
              <div>
                <strong>{b.name}</strong>
                {!b.isActive ? <span className="dept-hint"> (inactive)</span> : null}
                {b.note ? <div className="dept-hint">{b.note}</div> : null}
              </div>
              {canManage ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    void updateBank(b.id, { isActive: !b.isActive })
                      .then(() => refresh())
                      .catch((e) =>
                        onMessage(formatApiError(e, 'Mise à jour impossible'), { persist: true }),
                      )
                  }
                >
                  {b.isActive ? 'Désactiver' : 'Réactiver'}
                </button>
              ) : null}
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Compte</th>
                  <th>N°</th>
                  <th>Ouverture</th>
                  <th>Solde actuel</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {b.accounts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {a.name}
                      {!a.isActive ? ' (inactif)' : ''}
                    </td>
                    <td>{a.accountNumber || '—'}</td>
                    <td>{formatMoney(a.openingBalance)}</td>
                    <td>
                      <strong>{formatMoney(a.balance)}</strong>
                    </td>
                    <td>
                      {canManage ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() =>
                            void updateBankAccount(a.id, { isActive: !a.isActive })
                              .then(() => refresh())
                              .catch((e) =>
                                onMessage(formatApiError(e, 'Mise à jour impossible'), {
                                  persist: true,
                                }),
                              )
                          }
                        >
                          {a.isActive ? 'Désactiver' : 'Réactiver'}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {b.accounts.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      Aucun compte
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
