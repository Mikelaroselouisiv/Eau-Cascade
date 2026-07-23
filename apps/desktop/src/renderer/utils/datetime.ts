/**
 * Affichage / bornes de dates — fuseau unique Port-au-Prince.
 * À utiliser dans le renderer (indépendant du fuseau OS de la machine).
 */
export const APP_TIMEZONE = 'America/Port-au-Prince';

const pad2 = (n: number) => String(n).padStart(2, '0');

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function readZonedParts(date: Date, timeZone: string = APP_TIMEZONE): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) => {
    const v = parts.find((p) => p.type === type)?.value;
    return v ? Number.parseInt(v, 10) : NaN;
  };

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

export function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
  timeZone: string = APP_TIMEZONE,
): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms));
  const asZone = readZonedParts(utcGuess, timeZone);
  const asZoneAsUtc = Date.UTC(
    asZone.year,
    asZone.month - 1,
    asZone.day,
    asZone.hour,
    asZone.minute,
    asZone.second,
    ms,
  );
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  let corrected = new Date(utcGuess.getTime() + (desiredAsUtc - asZoneAsUtc));
  const again = readZonedParts(corrected, timeZone);
  const againAsUtc = Date.UTC(
    again.year,
    again.month - 1,
    again.day,
    again.hour,
    again.minute,
    again.second,
    ms,
  );
  corrected = new Date(corrected.getTime() + (desiredAsUtc - againAsUtc));
  return corrected;
}

export function formatYmd(value: Date | string | number = new Date()): string {
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  const p = readZonedParts(d);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

export function formatDateTime(value: Date | string | number | null | undefined): string {
  if (value == null || value === '') return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-HT', {
    timeZone: APP_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/** Affichage court livraison : 12 janv. 14:30 (Port-au-Prince). */
export function formatDateTimeShort(value: Date | string | number | null | undefined): string {
  if (value == null || value === '') return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-HT', {
    timeZone: APP_TIMEZONE,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

export function ymdStartIso(ymd: string): string | undefined {
  if (!ymd.trim()) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return undefined;
  return zonedWallTimeToUtc(
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    0,
    0,
    0,
    0,
  ).toISOString();
}

export function ymdEndIso(ymd: string): string | undefined {
  if (!ymd.trim()) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return undefined;
  return zonedWallTimeToUtc(
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    23,
    59,
    59,
    999,
  ).toISOString();
}

export function defaultMonthStartYmd(now: Date = new Date()): string {
  const p = readZonedParts(now);
  return `${p.year}-${pad2(p.month)}-01`;
}

export function addDaysYmd(ymd: string, days: number): string {
  const start = ymdStartIso(ymd);
  if (!start) return ymd;
  const noon = new Date(new Date(start).getTime() + days * 86400000 + 12 * 3600000);
  return formatYmd(noon);
}
