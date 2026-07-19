import type {
  AnalyticsQuery,
  AnalyticsSummary,
  BusyCell,
  CategoryRevenue,
  ProductCategoryId,
  RevenuePoint,
  TenderTotal,
  Transaction,
} from '../types';
import { TENDERS } from '../types';
import { MOCK_CATEGORIES } from './products';

/**
 * Mock-side aggregation of settled transactions into the AnalyticsSummary the
 * dashboard renders. In production Raja computes this server-side (see
 * INTEGRATION.md → getAnalytics); the UI never aggregates raw rows itself.
 *
 * Definitions used by this mock (backend owns the real ones):
 *   revenue = Σ positive amounts (sales) · cost = Σ their recorded cost
 *   profit  = revenue − cost              · margin = profit / revenue
 * Trade-in payouts (negative amounts) are stock purchases, shown in the
 * transactions list but excluded from the revenue KPIs.
 */

/** Parse "YYYY-MM-DD" as a LOCAL date (start of day). */
export function parseIsoDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function toIsoDay(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function inRange(at: string, from: Date, toExclusive: Date): boolean {
  const t = new Date(at).getTime();
  return t >= from.getTime() && t < toExclusive.getTime();
}

/** Monday-first weekday index (0 = Mon … 6 = Sun). */
function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

export function summariseTransactions(
  rows: Transaction[],
  query: AnalyticsQuery,
): AnalyticsSummary {
  const from = parseIsoDay(query.from);
  const toExclusive = parseIsoDay(query.to);
  toExclusive.setDate(toExclusive.getDate() + 1);

  const days = Math.max(1, Math.round((toExclusive.getTime() - from.getTime()) / 86400000));
  const bucket: 'day' | 'month' = days > 62 ? 'month' : 'day';

  const inWindow = rows.filter((t) => inRange(t.at, from, toExclusive));
  const sales = inWindow.filter((t) => t.amount > 0);

  const revenue = sales.reduce((s, t) => s + t.amount, 0);
  const cost = sales.reduce((s, t) => s + t.cost, 0);
  const profit = revenue - cost;

  // Previous window of the same length, for headline deltas.
  const prevFrom = new Date(from);
  prevFrom.setDate(prevFrom.getDate() - days);
  const prevSales = rows.filter((t) => inRange(t.at, prevFrom, from) && t.amount > 0);
  const prevRevenue = prevSales.reduce((s, t) => s + t.amount, 0);
  const prevProfit = prevRevenue - prevSales.reduce((s, t) => s + t.cost, 0);

  // ---- revenue series (empty buckets kept — the time axis stays honest) ----
  const series: RevenuePoint[] = [];
  const pointIndex = new Map<string, RevenuePoint>();
  const cursor = new Date(from);
  if (bucket === 'month') cursor.setDate(1);
  while (cursor < toExclusive) {
    const key =
      bucket === 'day' ? toIsoDay(cursor) : `${cursor.getFullYear()}-${cursor.getMonth()}`;
    const label =
      bucket === 'day'
        ? cursor.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        : cursor.toLocaleDateString('en-GB', { month: 'short' });
    const point: RevenuePoint = { date: toIsoDay(cursor), label, shop: 0, repair: 0 };
    series.push(point);
    pointIndex.set(key, point);
    if (bucket === 'day') cursor.setDate(cursor.getDate() + 1);
    else cursor.setMonth(cursor.getMonth() + 1);
  }
  for (const t of sales) {
    const at = new Date(t.at);
    const key = bucket === 'day' ? toIsoDay(at) : `${at.getFullYear()}-${at.getMonth()}`;
    const point = pointIndex.get(key);
    if (!point) continue;
    if (t.stream === 'repair') point.repair += t.amount;
    else point.shop += t.amount;
  }

  // ---- category breakdown (shop sales only) --------------------------------
  const catTotals = new Map<ProductCategoryId, { revenue: number; units: number }>();
  for (const t of sales) {
    if (!t.category) continue;
    const entry = catTotals.get(t.category) ?? { revenue: 0, units: 0 };
    entry.revenue += t.amount;
    entry.units += 1;
    catTotals.set(t.category, entry);
  }
  const byCategory: CategoryRevenue[] = [...catTotals.entries()]
    .map(([category, totals]) => ({
      category,
      label: MOCK_CATEGORIES.find((c) => c.id === category)?.label ?? category,
      revenue: totals.revenue,
      units: totals.units,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  // ---- busiest periods (footfall by weekday × hour) ------------------------
  const busyMap = new Map<string, BusyCell>();
  for (const t of sales) {
    const at = new Date(t.at);
    const day = mondayIndex(at);
    const hour = at.getHours();
    const key = `${day}-${hour}`;
    const cell = busyMap.get(key);
    if (cell) cell.count += 1;
    else busyMap.set(key, { day, hour, count: 1 });
  }
  const busiest = [...busyMap.values()];

  // ---- tender split ---------------------------------------------------------
  const byTender: TenderTotal[] = TENDERS.map((tender) => {
    const matching = sales.filter((t) => t.tender === tender);
    return {
      tender,
      total: matching.reduce((s, t) => s + t.amount, 0),
      count: matching.length,
    };
  });

  return {
    range: query,
    bucket,
    revenue,
    cost,
    profit,
    margin: revenue > 0 ? profit / revenue : 0,
    sales: sales.length,
    avgSale: sales.length > 0 ? Math.round(revenue / sales.length) : 0,
    prevRevenue,
    prevProfit,
    series,
    byCategory,
    busiest,
    byTender,
  };
}
