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
export type DashboardDatePreset = 'today' | 'yesterday' | 'dayBefore' | 'week' | 'month';
export type DateRangeYmd = { dateFrom: string; dateTo: string };

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function businessTodayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function parseYmd(ymd: string): { year: number; month: number; day: number } | null {
  const match = YMD_RE.exec(ymd.trim());
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function formatYmdParts(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Affichage JJ/MM/AAAA (jour civil, sans conversion de fuseau). */
export function formatYmdDisplay(ymd: string): string {
  const parts = parseYmd(ymd);
  if (!parts) return ymd;
  return `${String(parts.day).padStart(2, '0')}/${String(parts.month).padStart(2, '0')}/${parts.year}`;
}

export function monthStartYmd(ymd: string = businessTodayYmd()): string {
  const parts = parseYmd(ymd);
  if (!parts) return ymd;
  return formatYmdParts(parts.year, parts.month, 1);
}

export function clampYmd(ymd: string, minYmd?: string | null, maxYmd?: string | null): string {
  let next = ymd;
  if (minYmd && next < minYmd) next = minYmd;
  if (maxYmd && next > maxYmd) next = maxYmd;
  return next;
}

export function normalizeDateRange(
  dateFrom: string,
  dateTo: string,
  minYmd?: string | null,
  maxYmd?: string | null,
): DateRangeYmd {
  const from = clampYmd(dateFrom, minYmd, maxYmd);
  const to = clampYmd(dateTo, minYmd, maxYmd);
  if (from && to && from > to) return { dateFrom: to, dateTo: from };
  return { dateFrom: from, dateTo: to };
}

export function dashboardPresetRange(preset: DashboardDatePreset): DateRangeYmd {
  const today = businessTodayYmd();
  if (preset === 'today') return { dateFrom: today, dateTo: today };
  if (preset === 'yesterday') {
    const day = addDaysYmd(today, -1);
    return { dateFrom: day, dateTo: day };
  }
  if (preset === 'dayBefore') {
    const day = addDaysYmd(today, -2);
    return { dateFrom: day, dateTo: day };
  }
  if (preset === 'week') return { dateFrom: addDaysYmd(today, -6), dateTo: today };
  return { dateFrom: monthStartYmd(today), dateTo: today };
}

export function matchDashboardPreset(dateFrom: string, dateTo: string): DashboardDatePreset | null {
  const presets: DashboardDatePreset[] = ['today', 'yesterday', 'dayBefore', 'week', 'month'];
  for (const preset of presets) {
    const range = dashboardPresetRange(preset);
    if (range.dateFrom === dateFrom && range.dateTo === dateTo) return preset;
  }
  return null;
}

/** Bornes YYYY-MM-DD pour les filtres API (jour civil Port-au-Prince). */
export function periodDateRange(period: PeriodKey): DateRangeYmd {
  if (period === 'day') return dashboardPresetRange('today');
  return dashboardPresetRange(period);
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

export function monthEndYmd(ymd: string): string {
  const parts = parseYmd(ymd);
  if (!parts) return ymd;
  const last = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
  return formatYmdParts(parts.year, parts.month, last);
}

export type DashboardSeriesGrain = 'day' | 'month';

export type DashboardSeriesBucket = {
  key: string;
  dateFrom: string;
  dateTo: string;
};

export function iterateYmd(dateFrom: string, dateTo: string, maxDays = 366): string[] {
  const days: string[] = [];
  if (!parseYmd(dateFrom) || !parseYmd(dateTo) || dateFrom > dateTo) return days;
  let cursor = dateFrom;
  while (cursor <= dateTo && days.length < maxDays) {
    days.push(cursor);
    cursor = addDaysYmd(cursor, 1);
  }
  return days;
}

export function dashboardSeriesBuckets(
  dateFrom: string,
  dateTo: string,
  grain: DashboardSeriesGrain,
): DashboardSeriesBucket[] {
  const range = normalizeDateRange(dateFrom, dateTo);
  if (grain === 'day') {
    return iterateYmd(range.dateFrom, range.dateTo).map((day) => ({
      key: day,
      dateFrom: day,
      dateTo: day,
    }));
  }
  const buckets: DashboardSeriesBucket[] = [];
  let cursor = range.dateFrom;
  while (cursor <= range.dateTo && buckets.length < 48) {
    const monthStart = monthStartYmd(cursor);
    const start = cursor > monthStart ? cursor : monthStart;
    const endCandidate = monthEndYmd(start);
    const end = endCandidate > range.dateTo ? range.dateTo : endCandidate;
    buckets.push({
      key: start.slice(0, 7),
      dateFrom: start,
      dateTo: end,
    });
    cursor = addDaysYmd(end, 1);
  }
  return buckets;
}

export function dashboardSeriesBucketLabel(
  bucket: DashboardSeriesBucket,
  grain: DashboardSeriesGrain,
): string {
  if (grain === 'day') return formatYmdDisplay(bucket.dateFrom);
  const parts = parseYmd(bucket.dateFrom);
  if (!parts) return bucket.key;
  return new Intl.DateTimeFormat('fr-HT', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(parts.year, parts.month - 1, 1)));
}
