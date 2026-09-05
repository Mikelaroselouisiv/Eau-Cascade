import { SALES_RECENT_TOTALS_DAYS, permissionsSatisfy } from '../permissions';
import { nowBusinessYmd, shiftBusinessYmd } from './business-timezone';

/** Aujourd’hui + veille (fuseau Port-au-Prince). */
export function recentTotalsWindow(now: Date = new Date()): { minFrom: string; today: string } {
  const today = nowBusinessYmd(now);
  return {
    today,
    minFrom: shiftBusinessYmd(today, -(SALES_RECENT_TOTALS_DAYS - 1)),
  };
}

/**
 * Sans `reports.view` (ni `*`), les totaux / sessions / audit restent dans
 * la fenêtre `sales.recent_totals`.
 */
export function mustClampRecentTotals(perms: string[] | null | undefined): boolean {
  return !permissionsSatisfy(perms ?? [], ['reports.view']);
}

export function clampToRecentTotalsRange(
  dateFrom?: string,
  dateTo?: string,
  now: Date = new Date(),
): { dateFrom: string; dateTo: string } {
  const { today, minFrom } = recentTotalsWindow(now);
  let from = dateFrom?.trim() || minFrom;
  let to = dateTo?.trim() || today;
  if (from < minFrom) from = minFrom;
  if (to > today) to = today;
  if (to < from) to = from;
  if (from > today) from = minFrom;
  return { dateFrom: from, dateTo: to };
}
