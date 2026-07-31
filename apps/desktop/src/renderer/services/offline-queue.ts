import type { CreateSalePayload } from '../types/api';
import { createCreditSale, createSale, recordCreditPayment } from './api';
import * as localDb from './local-db-bridge';

const LEGACY_QUEUE_KEY = 'offline_sales_queue';

export type CreditSaleOutboxPayload = {
  __kind: 'creditSale';
  creditCustomerId: number;
  items: Array<{ productSaleUnitId: number; quantity: number }>;
  downPayment?: number;
  downPaymentMethod?: 'CASH' | 'CARD' | 'MOBILE_MONEY';
  note?: string;
};

export type CreditPaymentOutboxPayload = {
  __kind: 'creditPayment';
  creditCustomerId: number;
  amount: number;
  saleId?: number;
  method?: 'CASH' | 'CARD' | 'MOBILE_MONEY';
  reference?: string;
  note?: string;
};

type OutboxPayload = CreateSalePayload | CreditSaleOutboxPayload | CreditPaymentOutboxPayload;

function isCreditSalePayload(p: unknown): p is CreditSaleOutboxPayload {
  return Boolean(p && typeof p === 'object' && (p as { __kind?: string }).__kind === 'creditSale');
}

function isCreditPaymentPayload(p: unknown): p is CreditPaymentOutboxPayload {
  return Boolean(p && typeof p === 'object' && (p as { __kind?: string }).__kind === 'creditPayment');
}

function ensureClientUuid(payload: CreateSalePayload): CreateSalePayload {
  if (payload.clientUuid) return payload;
  const clientUuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `sale-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return { ...payload, clientUuid };
}

/** Migration one-shot : ancienne file localStorage → SQLite. */
function migrateLegacyQueue() {
  if (typeof localStorage === 'undefined' || !localDb.hasLocalDb()) return;
  const raw = localStorage.getItem(LEGACY_QUEUE_KEY);
  if (!raw) return;
  try {
    const items = JSON.parse(raw) as CreateSalePayload[];
    for (const item of items) {
      void localDb.outboxEnqueue(ensureClientUuid(item));
    }
    localStorage.removeItem(LEGACY_QUEUE_KEY);
  } catch {
    /* ignore */
  }
}

async function enqueueOutbox(payload: OutboxPayload) {
  migrateLegacyQueue();
  if (localDb.hasLocalDb()) {
    await localDb.outboxEnqueue(payload);
    return;
  }
  const queue = readLegacyQueue();
  queue.push(payload);
  localStorage.setItem(LEGACY_QUEUE_KEY, JSON.stringify(queue));
}

export async function enqueueSale(payload: CreateSalePayload) {
  await enqueueOutbox(ensureClientUuid(payload));
}

export async function enqueueCreditSale(
  payload: Omit<CreditSaleOutboxPayload, '__kind'>,
) {
  await enqueueOutbox({ __kind: 'creditSale', ...payload });
}

export async function enqueueCreditPayment(
  payload: Omit<CreditPaymentOutboxPayload, '__kind'>,
) {
  await enqueueOutbox({ __kind: 'creditPayment', ...payload });
}

async function flushPayload(payload: unknown): Promise<void> {
  if (isCreditSalePayload(payload)) {
    const { __kind: _k, ...body } = payload;
    await createCreditSale(body);
    return;
  }
  if (isCreditPaymentPayload(payload)) {
    const { __kind: _k, ...body } = payload;
    await recordCreditPayment(body);
    return;
  }
  await createSale(ensureClientUuid(payload as CreateSalePayload));
}

export async function syncSalesQueue() {
  migrateLegacyQueue();
  if (localDb.hasLocalDb()) {
    const rows = await localDb.outboxList();
    if (rows.length === 0) return { synced: 0, pending: 0 };
    let synced = 0;
    for (const row of rows) {
      try {
        await flushPayload(row.payload);
        await localDb.outboxRemove(row.id);
        synced += 1;
      } catch {
        break;
      }
    }
    const pending = (await localDb.outboxList()).length;
    return { synced, pending };
  }

  const queue = readLegacyQueue();
  if (queue.length === 0) return { synced: 0, pending: 0 };
  let synced = 0;
  const remaining: OutboxPayload[] = [];
  for (const item of queue) {
    try {
      await flushPayload(item);
      synced += 1;
    } catch {
      remaining.push(item);
    }
  }
  localStorage.setItem(LEGACY_QUEUE_KEY, JSON.stringify(remaining));
  return { synced, pending: remaining.length };
}

export async function pendingSalesCount(): Promise<number> {
  migrateLegacyQueue();
  if (localDb.hasLocalDb()) {
    return (await localDb.outboxList()).length;
  }
  return readLegacyQueue().length;
}

function readLegacyQueue(): OutboxPayload[] {
  try {
    const raw = localStorage.getItem(LEGACY_QUEUE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as OutboxPayload[];
  } catch {
    return [];
  }
}
