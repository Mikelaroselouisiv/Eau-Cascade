import { listSales } from '@/services/api';
import type { RegisterSessionDetail, Sale, SalePaymentRow } from '@/types/api';

export type SessionTakings = {
  salesCount: number;
  total: number;
  cash: number;
  bank: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function saleTimeMs(sale: Sale): number {
  return Date.parse(sale.createdAt);
}

export function saleBelongsToRegisterSession(
  sale: Sale,
  session: RegisterSessionDetail,
): boolean {
  if (sale.status !== 'COMPLETED' || sale.deletedAt) return false;
  if (sale.creditCustomerId != null) return false;
  const t = saleTimeMs(sale);
  if (!Number.isFinite(t)) return false;
  const opened = Date.parse(session.openedAt);
  if (Number.isFinite(opened) && t < opened) return false;
  if (session.closedAt) {
    const closed = Date.parse(session.closedAt);
    if (Number.isFinite(closed) && t > closed) return false;
  }
  if (sale.registerId != null) return sale.registerId === session.registerId;
  const uid = sale.userId ?? sale.user?.id;
  return uid != null && uid === session.openedBy?.id;
}

function paymentAmount(row: SalePaymentRow): number {
  if (row.deletedAt) return 0;
  return Number(row.amount) || 0;
}

export function sumSessionTakings(sales: Sale[]): SessionTakings {
  let cash = 0;
  let bank = 0;
  let total = 0;
  for (const sale of sales) {
    total += Number(sale.total) || 0;
    const payments = (sale.payments ?? []).filter((p) => !p.deletedAt && p.method !== 'CREDIT');
    if (payments.length === 0) {
      cash += Number(sale.total) || 0;
      continue;
    }
    for (const payment of payments) {
      const amount = paymentAmount(payment);
      if (payment.method === 'BANK') bank += amount;
      else cash += amount;
    }
  }
  return {
    salesCount: sales.length,
    total: round2(total),
    cash: round2(cash),
    bank: round2(bank),
  };
}

export function takingsBySession(
  sessions: RegisterSessionDetail[],
  sales: Sale[],
): Map<number, SessionTakings> {
  const map = new Map<number, SessionTakings>();
  for (const session of sessions) {
    map.set(
      session.id,
      sumSessionTakings(sales.filter((sale) => saleBelongsToRegisterSession(sale, session))),
    );
  }
  return map;
}

export async function listSalesInWindow(params: {
  companyId: number;
  departmentIds?: number[];
  createdFrom: string;
  createdTo: string;
}): Promise<Sale[]> {
  const items: Sale[] = [];
  let skip = 0;
  for (let i = 0; i < 30; i++) {
    const page = await listSales({
      companyId: params.companyId,
      departmentIds: params.departmentIds,
      createdFrom: params.createdFrom,
      createdTo: params.createdTo,
      skip,
      take: 100,
    });
    items.push(...page.items);
    if (page.items.length < 100 || items.length >= page.total) break;
    skip += page.items.length;
  }
  return items;
}
