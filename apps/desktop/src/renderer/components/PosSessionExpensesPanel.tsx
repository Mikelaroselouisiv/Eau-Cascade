import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { MoneyField } from './MoneyField';
import { useAutoClearMessage } from '../hooks/useAutoClearMessage';
import {
  createFinanceEntry,
  listRegisterSessionExpenses,
  type RegisterSessionExpenseRow,
} from '../services/api';
import { formatMoney } from '../utils/currency';
import { formatDateTime } from '../utils/datetime';
import { EXPENSE_LABEL_OPTIONS, EXPENSE_LABEL_OTHER } from '../utils/expenseLabels';

export function PosSessionExpensesPanel({
  sessionId,
  companyId,
  enabled,
}: {
  sessionId: number | null;
  companyId: number | null;
  enabled: boolean;
}) {
  const [labelChoice, setLabelChoice] = useState('');
  const [descOther, setDescOther] = useState('');
  const [detail, setDetail] = useState('');
  const [amount, setAmount] = useState('');
  const [rows, setRows] = useState<RegisterSessionExpenseRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useAutoClearMessage();

  useEffect(() => {
    if (!enabled || sessionId == null) {
      setRows([]);
      return;
    }
    void listRegisterSessionExpenses(sessionId)
      .then(setRows)
      .catch(() => setRows([]));
  }, [enabled, sessionId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!enabled || sessionId == null || companyId == null) return;
    const description =
      labelChoice === EXPENSE_LABEL_OTHER ? descOther.trim() : labelChoice.trim();
    const value = Number(String(amount).replace(',', '.'));
    if (!description || !Number.isFinite(value) || value <= 0) {
      setMsg('Libellé et montant requis.', { persist: true });
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      await createFinanceEntry({
        type: 'EXPENSE',
        amount: value,
        description,
        detail: detail.trim() || undefined,
        companyId,
      });
      setLabelChoice('');
      setDescOther('');
      setDetail('');
      setAmount('');
      setRows(await listRegisterSessionExpenses(sessionId));
      setMsg('Dépense enregistrée.');
    } catch {
      setMsg('Enregistrement impossible.', { persist: true });
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) {
    return <p className="info-text">Caisse fermée</p>;
  }

  return (
    <section className="card" style={{ maxWidth: '36rem' }}>
      <h2 style={{ marginTop: 0 }}>Dépenses</h2>
      {msg ? (
        <p className={/enregistrée/i.test(msg) ? 'info-text' : 'error-text'}>{msg}</p>
      ) : null}
      <form className="form-grid" onSubmit={(e) => void onSubmit(e)}>
        <label>
          Libellé
          <select
            value={labelChoice}
            onChange={(e) => {
              setLabelChoice(e.target.value);
              if (e.target.value !== EXPENSE_LABEL_OTHER) setDescOther('');
            }}
            required
          >
            <option value="">— Choisir —</option>
            {EXPENSE_LABEL_OPTIONS.map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {labelChoice === EXPENSE_LABEL_OTHER ? (
          <label>
            Préciser
            <input value={descOther} onChange={(e) => setDescOther(e.target.value)} required />
          </label>
        ) : null}
        <label>
          Détail
          <input value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={1000} />
        </label>
        <MoneyField
          label="Montant"
          min={0.01}
          step={0.01}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Enregistrer
        </button>
      </form>
      {rows.length === 0 ? (
        <p className="info-text" style={{ marginTop: '1rem' }}>
          Aucune dépense
        </p>
      ) : (
        <ul className="pos-session-expense-list" style={{ marginTop: '1rem', paddingLeft: 0, listStyle: 'none' }}>
          {rows.map((row) => (
            <li
              key={row.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '0.75rem',
                padding: '0.4rem 0',
                borderBottom: '1px solid var(--border, #e2e8f0)',
              }}
            >
              <span>
                {row.description}
                {row.detail ? ` — ${row.detail}` : ''}
                <small style={{ display: 'block', opacity: 0.75 }}>{formatDateTime(row.createdAt)}</small>
              </span>
              <strong>{formatMoney(row.amount)}</strong>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
