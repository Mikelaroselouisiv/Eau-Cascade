import type { Product } from '../types/api';

type Props = {
  alerts: Product[];
  total: number;
  loading: boolean;
  canLoadMore: boolean;
  onLoadMore: () => void;
};

export function StockZeroAlertsPanel({ alerts, total, loading, canLoadMore, onLoadMore }: Props) {
  const hasAlerts = total > 0;

  return (
    <section
      className={
        hasAlerts
          ? 'stock-zero-panel stock-zero-panel--critical'
          : 'stock-zero-panel stock-zero-panel--ok'
      }
      aria-live="polite"
    >
      <div className="stock-zero-panel-head">
        <div className="stock-zero-panel-copy">
          <h2 className="stock-zero-title">Produits indisponibles (stock à 0)</h2>
          {hasAlerts ? (
            <p className="stock-zero-lead">
              {total} produit{total > 1 ? 's' : ''} sans stock — rupture totale.
            </p>
          ) : (
            <p className="stock-zero-lead">Aucun produit à stock zéro pour cette entreprise.</p>
          )}
        </div>
        {hasAlerts ? <span className="stock-zero-badge">{total}</span> : null}
      </div>

      {hasAlerts ? (
        <>
          <ul className="stock-zero-list">
            {alerts.map((p) => {
              const dept = p.department?.name?.trim();
              return (
                <li key={p.id} className="stock-zero-item">
                  <span className="stock-zero-item-name">{p.name}</span>
                  {dept ? <span className="stock-zero-item-dept">{dept}</span> : null}
                </li>
              );
            })}
          </ul>
          {canLoadMore ? (
            <div className="stock-zero-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={loading}
                onClick={onLoadMore}
              >
                {loading ? 'Chargement…' : 'Voir plus'}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
