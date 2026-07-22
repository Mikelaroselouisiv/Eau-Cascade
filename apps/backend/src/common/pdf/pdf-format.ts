/** Formatage partagé pour les exports PDF (français, lisible). */

import { BUSINESS_TIME_ZONE } from '../utils/business-timezone';

function partsInBusinessTz(d: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
  };
}

/** Date JJ/MM/AAAA (les chaînes AAAA-MM-JJ sont traitées en calendrier métier Haïti). */
export function formatDateFr(value: Date | string | number | null | undefined): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'string') {
    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (ymd) return `${ymd[3]}/${ymd[2]}/${ymd[1]}`;
  }
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return '—';
  const p = partsInBusinessTz(d);
  return `${p.day}/${p.month}/${p.year}`;
}

/** Date-heure JJ/MM/AAAA HH:mm (fuseau métier Haïti). */
export function formatDateTimeFr(value: Date | string | number | null | undefined): string {
  if (value == null || value === '') return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return '—';
  const p = partsInBusinessTz(d);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/**
 * Quantité : pas de zéros inutiles (évite 5.000 qui ressemble à « 5 mille »).
 * Décimale avec virgule française.
 */
export function formatQty(value: unknown, maxDecimals = 3): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const rounded = Number(n.toFixed(maxDecimals));
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded).replace('.', ',');
}

/** Montant HTG : 1 250,00 (espace milliers, virgule décimale, toujours 2 décimales). */
export function formatMoney(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const neg = n < 0;
  const abs = Math.abs(n);
  const [intPart, decPart] = abs.toFixed(2).split('.');
  const withSpaces = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${neg ? '-' : ''}${withSpaces},${decPart}`;
}

export function formatMoneyHtg(value: unknown): string {
  const m = formatMoney(value);
  return m === '—' ? m : `${m} HTG`;
}
