/**
 * Fuseau métier du POS (Haïti). Tous les filtres « jour calendaire » (YYYY-MM-DD)
 * et les bornes « aujourd’hui / semaine / mois » doivent être interprétés ici,
 * pas dans le TZ du process Node (UTC en Docker / GCP).
 */
export const BUSINESS_TIME_ZONE = 'America/Port-au-Prince';

export type YmdParts = { y: number; m: number; d: number };

export function parseYmd(ymd: string): YmdParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!match) {
    throw new Error(`Date attendue au format YYYY-MM-DD, reçu: ${ymd}`);
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    throw new Error(`Date invalide: ${ymd}`);
  }
  return { y, m, d };
}

function formatPartsInZone(instantMs: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instantMs));
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/**
 * Convertit une date/heure murale dans le fuseau métier en instant UTC (Date).
 */
export function zonedLocalToUtc(
  y: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
  timeZone: string = BUSINESS_TIME_ZONE,
): Date {
  const desiredAsUtc = Date.UTC(y, month - 1, day, hour, minute, second, ms);
  let guess = desiredAsUtc;
  for (let i = 0; i < 4; i++) {
    const p = formatPartsInZone(guess, timeZone);
    const actualAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, ms);
    const diff = actualAsUtc - desiredAsUtc;
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess);
}

/** Début inclusif du jour calendaire métier (00:00:00.000). */
export function ymdToBusinessDayStart(ymd: string): Date {
  const { y, m, d } = parseYmd(ymd);
  return zonedLocalToUtc(y, m, d, 0, 0, 0, 0);
}

/** Fin inclusive du jour calendaire métier (23:59:59.999). */
export function ymdToBusinessDayEnd(ymd: string): Date {
  const { y, m, d } = parseYmd(ymd);
  return zonedLocalToUtc(y, m, d, 23, 59, 59, 999);
}

/** Midi métier — utile pour ancrer une date sans heure (saisie manuelle). */
export function ymdToBusinessNoon(ymd: string): Date {
  const { y, m, d } = parseYmd(ymd);
  return zonedLocalToUtc(y, m, d, 12, 0, 0, 0);
}

/** YYYY-MM-DD du calendrier métier pour un instant donné. */
export function nowBusinessYmd(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function businessDayStartFromInstant(now: Date = new Date()): Date {
  return ymdToBusinessDayStart(nowBusinessYmd(now));
}

/**
 * Bornes tableau de bord : jour / 7 derniers jours / mois calendaire en cours (Haïti).
 */
export function businessPeriodBounds(
  period: 'day' | 'week' | 'month',
  now: Date = new Date(),
): { from: Date; to: Date } {
  const ymd = nowBusinessYmd(now);
  const { y, m } = parseYmd(ymd);
  const dayStart = ymdToBusinessDayStart(ymd);

  switch (period) {
    case 'day':
      return { from: dayStart, to: now };
    case 'week': {
      const weekStart = new Date(dayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
      return { from: weekStart, to: now };
    }
    case 'month': {
      const monthStart = ymdToBusinessDayStart(`${y}-${String(m).padStart(2, '0')}-01`);
      return { from: monthStart, to: now };
    }
  }
}

/** Décale un YYYY-MM-DD métier de `deltaDays` jours calendaires. */
export function shiftBusinessYmd(ymd: string, deltaDays: number): string {
  const start = ymdToBusinessDayStart(ymd);
  const shifted = new Date(start.getTime() + deltaDays * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000);
  return nowBusinessYmd(shifted);
}
