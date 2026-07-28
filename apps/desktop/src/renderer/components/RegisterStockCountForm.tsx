import { useEffect, useMemo, useState } from 'react';
import type { InventoryCountSheetRow } from '../types/api';
import { formatQuantity, formatQuantityInput } from '../utils/formatQuantity';

type CountMap = Record<number, string>;

type Props = {
  products: InventoryCountSheetRow[];
  cashFields?: React.ReactNode;
  submitLabel: string;
  busy: boolean;
  error?: string;
  onSubmit: (lines: Array<{ productId: number; countedQty: number }>) => void;
};

function parseQty(raw: string): number | null {
  const trimmed = raw.trim().replace(/\s/g, '').replace(',', '.');
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function initialCounts(products: InventoryCountSheetRow[]): CountMap {
  return Object.fromEntries(products.map((p) => [p.id, formatQuantityInput(p.stock)]));
}

export function RegisterStockCountForm({
  products,
  cashFields,
  submitLabel,
  busy,
  error,
  onSubmit,
}: Props) {
  const [counts, setCounts] = useState<CountMap>(() => initialCounts(products));
  const [touched, setTouched] = useState<Record<number, boolean>>({});

  useEffect(() => {
    setCounts(initialCounts(products));
    setTouched({});
  }, [products]);

  const linesReady = useMemo(() => {
    return products.every((p) => parseQty(counts[p.id] ?? '') !== null);
  }, [products, counts]);

  function handleBlur(productId: number, raw: string) {
    setTouched((prev) => ({ ...prev, [productId]: true }));
    const parsed = parseQty(raw);
    if (parsed !== null) {
      setCounts((prev) => ({ ...prev, [productId]: formatQuantityInput(parsed) }));
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const lines = products.map((p) => {
      const qty = parseQty(counts[p.id] ?? '');
      if (qty === null) throw new Error('invalid');
      return { productId: p.id, countedQty: qty };
    });
    onSubmit(lines);
  }

  return (
    <form onSubmit={handleSubmit}>
      {cashFields}
      {products.length === 0 ? (
        <p className="dept-hint" style={{ marginTop: '0.75rem' }}>
          Aucun produit avec stock suivi dans ce département.
        </p>
      ) : (
        <div className="register-count-grid">
          {products.map((p) => {
            const parsed = parseQty(counts[p.id] ?? '');
            const showVariance = touched[p.id] && parsed !== null;
            const variance = showVariance ? parsed! - p.stock : null;
            return (
              <article key={p.id} className="register-count-card">
                <div className="register-count-product">{p.name}</div>
                <input
                  type="text"
                  inputMode="decimal"
                  className="register-count-input"
                  value={counts[p.id] ?? ''}
                  disabled={busy}
                  placeholder={formatQuantityInput(p.stock)}
                  aria-label={`Quantité comptée — ${p.name}`}
                  onChange={(e) => {
                    setTouched((prev) => ({ ...prev, [p.id]: true }));
                    setCounts((prev) => ({ ...prev, [p.id]: e.target.value }));
                  }}
                  onBlur={(e) => handleBlur(p.id, e.target.value)}
                />
                <div className="register-count-unit">{p.unitLabel}</div>
                <div className="register-count-ref">Système : {formatQuantity(p.stock)}</div>
                {showVariance ? (
                  <div
                    className="register-count-variance"
                    style={
                      variance != null && variance !== 0
                        ? { color: variance < 0 ? '#b91c1c' : '#15803d' }
                        : undefined
                    }
                  >
                    Écart : {variance != null && variance > 0 ? '+' : ''}
                    {formatQuantity(variance!)}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
      {error ? <p className="error-text">{error}</p> : null}
      <div className="table-actions" style={{ marginTop: '0.75rem' }}>
        <button type="submit" className="btn btn-primary" disabled={busy || !linesReady}>
          {busy ? '…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
