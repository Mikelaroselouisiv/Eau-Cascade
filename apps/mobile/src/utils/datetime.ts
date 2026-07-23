/** Fuseau métier unique — Port-au-Prince. */
export const APP_TIMEZONE = 'America/Port-au-Prince';

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
