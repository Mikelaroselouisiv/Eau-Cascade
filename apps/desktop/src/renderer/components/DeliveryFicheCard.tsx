import type { Delivery } from '../types/api';
import { formatMoney } from '../utils/currency';
import { formatDateTimeShort } from '../utils/datetime';
import {
  DELIVERY_STATUS_LABEL,
  deliverySaleRef,
  deliveryStatusClass,
  isHomeDelivery,
} from './deliveryFiche';

type Props = {
  delivery: Delivery;
  canPrint?: boolean;
  printing?: boolean;
  printBusy?: boolean;
  onOpen: (d: Delivery) => void;
  onPrint?: (d: Delivery) => void;
};

export function DeliveryFicheCard({
  delivery: d,
  canPrint,
  printing,
  printBusy,
  onOpen,
  onPrint,
}: Props) {
  return (
    <article className={`delivery-card ${deliveryStatusClass(d.status)}`}>
      <button type="button" className="delivery-card-body" onClick={() => onOpen(d)}>
        <div className="delivery-card-top">
          <span className="delivery-card-ref">Vente #{deliverySaleRef(d)}</span>
          <span className="delivery-card-badge">{DELIVERY_STATUS_LABEL[d.status]}</span>
        </div>
        <div className="delivery-card-client">
          {d.sale?.clientName?.trim() || 'Client'}
          {isHomeDelivery(d) ? <span className="delivery-card-home"> · À domicile</span> : null}
        </div>
        {isHomeDelivery(d) && d.sale?.clientPhone?.trim() ? (
          <div className="delivery-card-meta">{d.sale.clientPhone.trim()}</div>
        ) : null}
        <div className="delivery-card-meta">
          {d.company?.name}
          {isHomeDelivery(d)
            ? d.department?.name
              ? ` · Livré depuis ${d.department.name}`
              : ''
            : d.department?.name
              ? ` · ${d.department.name}`
              : ''}
        </div>
        <div className="delivery-card-foot">
          <span>{formatDateTimeShort(d.sale?.createdAt ?? d.createdAt)}</span>
          <span className="delivery-card-total">{formatMoney(d.sale?.total)}</span>
        </div>
        {isHomeDelivery(d) && d.executorName?.trim() ? (
          <div className="delivery-card-executor">Par {d.executorName.trim()}</div>
        ) : null}
      </button>
      {canPrint && onPrint ? (
        <button
          type="button"
          className="btn btn-secondary delivery-card-print"
          disabled={printing || printBusy}
          onClick={(e) => {
            e.stopPropagation();
            onPrint(d);
          }}
        >
          {printing ? 'Impression…' : 'Imprimer'}
        </button>
      ) : null}
    </article>
  );
}
