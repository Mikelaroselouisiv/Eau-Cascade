/** Fuseau métier unique — Port-au-Prince. */
export const APP_TIMEZONE = 'America/Port-au-Prince';

export function formatDateTime(value: Date | string | number | null | undefined): string {
  if (value == null || value === '') return '-';
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return '-';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

export const CURRENCY_CODE = 'HTG';

/** Montant numérique seul (sans devise). */
export function formatMoneyAmount(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(2);
}

/** Affiche un montant avec la devise (ex. « 1250.00 HTG »). */
export function formatMoney(value: number | string | null | undefined): string {
  const amount = formatMoneyAmount(value);
  if (amount === '—') return '—';
  return `${amount} ${CURRENCY_CODE}`;
}

export type PeriodKey = 'day' | 'week' | 'month';

export function businessTodayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Bornes YYYY-MM-DD pour les filtres API (jour civil Port-au-Prince). */
export function periodDateRange(period: PeriodKey): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const m = Number(parts.find((p) => p.type === 'month')?.value);
  const d = Number(parts.find((p) => p.type === 'day')?.value);
  const today = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  if (period === 'day') return { dateFrom: today, dateTo: today };

  const end = new Date(Date.UTC(y, m - 1, d));
  const start = new Date(end);
  if (period === 'week') start.setUTCDate(start.getUTCDate() - 6);
  else start.setUTCDate(1);

  const from = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}-${String(start.getUTCDate()).padStart(2, '0')}`;
  return { dateFrom: from, dateTo: today };
}

function businessDateTimeIso(ymd: string, endOfDay: boolean): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return ymd;
  const [, yearRaw, monthRaw, dayRaw] = match;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const hour = endOfDay ? 23 : 0;
  const minute = endOfDay ? 59 : 0;
  const second = endOfDay ? 59 : 0;
  const millisecond = endOfDay ? 999 : 0;
  const initial = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(initial);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const representedAsUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
    millisecond,
  );
  const offsetMs = representedAsUtc - initial.getTime();
  return new Date(initial.getTime() - offsetMs).toISOString();
}

/** Bornes ISO exactes d’un jour métier Port-au-Prince pour les API qui attendent un instant. */
export function businessDayStartIso(ymd: string): string {
  return businessDateTimeIso(ymd, false);
}

export function businessDayEndIso(ymd: string): string {
  return businessDateTimeIso(ymd, true);
}

/** Date métier AAAA-MM-JJ extraite d’un ISO (sans tiret orphelin). */
export function ymdFromIso(value: string | null | undefined): string {
  if (!value) return '';
  return value.slice(0, 10);
}

export function addDaysYmd(ymd: string, days: number): string {
  const start = businessDayStartIso(ymd);
  const noon = new Date(new Date(start).getTime() + days * 86400000 + 12 * 3600000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(noon);
}
