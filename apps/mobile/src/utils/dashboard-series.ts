import { getDashboardSummaryRange } from '@/services/api';
import {
  dashboardSeriesBucketLabel,
  dashboardSeriesBuckets,
  type DashboardSeriesGrain,
} from '@/utils/datetime';

export type SalesSeriesPoint = {
  key: string;
  label: string;
  dateFrom: string;
  dateTo: string;
  sales: number;
};

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: items.length ? n : 0 }, () => worker()));
  return results;
}

export async function loadDashboardSalesSeries(params: {
  companyId: number;
  dateFrom: string;
  dateTo: string;
  grain: DashboardSeriesGrain;
}): Promise<SalesSeriesPoint[]> {
  const buckets = dashboardSeriesBuckets(params.dateFrom, params.dateTo, params.grain);
  return mapPool(buckets, 6, async (bucket) => {
    const label = dashboardSeriesBucketLabel(bucket, params.grain);
    try {
      const snap = await getDashboardSummaryRange({
        companyId: params.companyId,
        dateFrom: bucket.dateFrom,
        dateTo: bucket.dateTo,
      });
      return {
        key: bucket.key,
        label,
        dateFrom: bucket.dateFrom,
        dateTo: bucket.dateTo,
        sales: Number(snap.sales) || 0,
      };
    } catch {
      return {
        key: bucket.key,
        label,
        dateFrom: bucket.dateFrom,
        dateTo: bucket.dateTo,
        sales: 0,
      };
    }
  });
}
