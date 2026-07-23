/**
 * Fuseau métier unique : Port-au-Prince (Haïti).
 * Stockage DB = UTC (Prisma) ; affichage + bornes de journée = America/Port-au-Prince.
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

/**
 * Interprète une heure murale Port-au-Prince comme instant UTC.
 * Corrige le décalage (y compris DST) via une passe d’ajustement Intl.
 */
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

  // Seconde passe (transitions DST rares)
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

export function ymdToDateStart(ymd: string, timeZone: string = APP_TIMEZONE): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) throw new Error(`Date invalide (attendu YYYY-MM-DD): ${ymd}`);
  return zonedWallTimeToUtc(
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    0,
    0,
    0,
    0,
    timeZone,
  );
}

export function ymdToDateEnd(ymd: string, timeZone: string = APP_TIMEZONE): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) throw new Error(`Date invalide (attendu YYYY-MM-DD): ${ymd}`);
  return zonedWallTimeToUtc(
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    23,
    59,
    59,
    999,
    timeZone,
  );
}

/** Midi Port-au-Prince (écritures comptables « jour »). */
export function ymdToNoon(ymd: string, timeZone: string = APP_TIMEZONE): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) throw new Error(`Date invalide (attendu YYYY-MM-DD): ${ymd}`);
  return zonedWallTimeToUtc(
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    12,
    0,
    0,
    0,
    timeZone,
  );
}

export function formatYmdInAppTz(
  value: Date | string | number = new Date(),
  timeZone: string = APP_TIMEZONE,
): string {
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  const p = readZonedParts(d, timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

export function startOfTodayInAppTz(now: Date = new Date(), timeZone: string = APP_TIMEZONE): Date {
  return ymdToDateStart(formatYmdInAppTz(now, timeZone), timeZone);
}

export function startOfMonthInAppTz(now: Date = new Date(), timeZone: string = APP_TIMEZONE): Date {
  const p = readZonedParts(now, timeZone);
  return zonedWallTimeToUtc(p.year, p.month, 1, 0, 0, 0, 0, timeZone);
}

export function startOfPreviousMonthInAppTz(
  now: Date = new Date(),
  timeZone: string = APP_TIMEZONE,
): Date {
  const p = readZonedParts(now, timeZone);
  let y = p.year;
  let m = p.month - 1;
  if (m < 1) {
    m = 12;
    y -= 1;
  }
  return zonedWallTimeToUtc(y, m, 1, 0, 0, 0, 0, timeZone);
}

export function addCalendarDaysYmd(ymd: string, days: number): string {
  const start = ymdToDateStart(ymd);
  // Ancre midi pour éviter les ambiguïtés DST
  const noon = new Date(start.getTime() + days * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000);
  return formatYmdInAppTz(noon);
}

export function daysAgoStartInAppTz(days: number, now: Date = new Date()): Date {
  const today = formatYmdInAppTz(now);
  return ymdToDateStart(addCalendarDaysYmd(today, -days));
}

export function ensureAppTimezone(): void {
  if (!process.env.TZ) {
    process.env.TZ = APP_TIMEZONE;
  }
}
