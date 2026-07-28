import type { Product } from '../types/api';
import { formatQuantity } from '../utils/formatQuantity';

type Props = {
  alerts: Product[];
  total: number;
  loading: boolean;
  canLoadMore: boolean;
  onLoadMore: () => void;
};

function stockPct(stock: number, min: number): number {
  if (min <= 0) return stock <= 0 ? 0 : 100;
  return Math.min(100, Math.round((stock / min) * 100));
}

export function StockLowAlertsPanel({ alerts, total, loading, canLoadMore, onLoadMore }: Props) {
  const hasAlerts = total > 0;

  return (
    <section
      className={hasAlerts ? 'stock-alert-panel stock-alert-panel--critical' : 'stock-alert-panel stock-alert-panel--ok'}
      aria-live="polite"
    >
      <div className="stock-alert-panel-head">
        <span className="stock-alert-icon" aria-hidden>
          {hasAlerts ? '!' : '✓'}
        </span>
        <div className="stock-alert-panel-copy">
          <h2 className="stock-alert-title">Alertes stock faible</h2>
          {hasAlerts ? (
            <p className="stock-alert-lead">
              {total} produit{total > 1 ? 's' : ''} encore en stock mais sous le minimum — réapprovisionnement recommandé.
            </p>
          ) : (
            <p className="stock-alert-lead">Aucun produit faible (hors ruptures à zéro) pour cette entreprise.</p>
          )}
        </div>
        {hasAlerts ? <span className="stock-alert-badge">{total}</span> : null}
      </div>

      {hasAlerts ? (
        <>
          <div className="stock-alert-grid">
            {alerts.map((p) => {
              const stock = Number(p.stock);
              const min = Number(p.stockMin);
              const pct = stockPct(stock, min);
              const dept = p.department?.name?.trim();
              return (
                <article key={p.id} className="stock-alert-item">
                  <div className="stock-alert-item-top">
                    <strong className="stock-alert-item-name">{p.name}</strong>
                    {dept ? <span className="stock-alert-item-dept">{dept}</span> : null}
                  </div>
                  <div className="stock-alert-meter" role="presentation">
                    <span className="stock-alert-meter-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="stock-alert-item-meta">
                    <span>
                      Stock <strong>{formatQuantity(stock)}</strong>
                    </span>
                    <span>
                      Min <strong>{formatQuantity(min)}</strong>
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
          {canLoadMore ? (
            <div className="stock-alert-actions">
              <button type="button" className="btn btn-secondary btn-sm" disabled={loading} onClick={onLoadMore}>
                {loading ? 'Chargement…' : 'Voir plus d’alertes'}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
