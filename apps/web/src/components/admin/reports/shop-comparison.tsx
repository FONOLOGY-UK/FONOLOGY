'use client';

import { useEffect } from 'react';
import { useShopComparison } from '@/lib/data/hooks';
import type { AnalyticsQuery, ShopComparison } from '@/lib/data/types';
import { formatGBP } from '@/lib/data/types';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  PrintReportFooter,
  PrintReportHeader,
  PrintReportTable,
} from '@/components/admin/reports/print-report';

/**
 * Every open shop side by side for the range, with the combined total underneath — the third
 * way to read the same numbers (a single shop and the combined view are the shop switcher).
 * Revenue is takings net of refunds, attributed to the shop whose till took (or paid out) the
 * money; online orders count for the shop that fulfils them.
 */
export function ShopComparisonReport({
  range,
  showCosts,
  onLoaded,
}: {
  range: AnalyticsQuery;
  /** Cost and profit columns only for people holding costs.view. */
  showCosts: boolean;
  /** Hands the loaded figures up so the page can export them. */
  onLoaded?: (rows: string[][]) => void;
}) {
  const { data, isPending, isError, refetch } = useShopComparison(range, true);

  // Hand the figures up for the page's CSV export (an effect: it sets the parent's state).
  useEffect(() => {
    if (data) onLoaded?.(buildRows(data, showCosts));
  }, [data, showCosts, onLoaded]);

  if (isError) {
    return (
      <div className="border-line bg-card rounded-lg border p-8 text-center">
        <p className="text-ink mb-3 text-sm font-semibold">The comparison didn’t load.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  if (isPending || !data) return <Skeleton className="h-[320px] w-full" />;

  const [headers = [], ...rows] = buildRows(data, showCosts);

  const top = data.shops.reduce((a, b) => (b.revenue > a.revenue ? b : a), data.shops[0]!);

  return (
    <article className="print-area border-line bg-card rounded-lg border p-6 sm:p-8">
      <PrintReportHeader
        title="Shops side by side"
        subtitle="Takings net of refunds, per shop"
        from={data.range.from}
        to={data.range.to}
      />
      <PrintReportTable title="Performance by shop" headers={headers} rows={rows} />
      {data.shops.length > 1 && data.combined.revenue > 0 ? (
        <p className="text-muted mt-3 text-sm print:hidden">
          {top.name} took {Math.round((top.revenue / data.combined.revenue) * 100)}% of the combined
          revenue in this range.
        </p>
      ) : null}
      <PrintReportFooter note="Refunds count against the shop that paid them out. Trade-in payouts are excluded from revenue. Prices are prices — Fonology is not VAT registered." />
    </article>
  );
}

/** Header row first, then one row per shop, then the combined total — the on-screen table and the CSV. */
function buildRows(data: ShopComparison, showCosts: boolean): string[][] {
  const headers = showCosts
    ? ['Shop', 'Revenue', 'Cost of goods', 'Profit', 'Margin', 'Sales', 'Average sale']
    : ['Shop', 'Revenue', 'Sales', 'Average sale'];
  const line = (name: string, f: ShopComparison['combined']) =>
    showCosts
      ? [
          name,
          formatGBP(f.revenue),
          formatGBP(f.cost),
          formatGBP(f.profit),
          `${Math.round(f.margin * 100)}%`,
          `${f.sales}`,
          formatGBP(f.avgSale),
        ]
      : [name, formatGBP(f.revenue), `${f.sales}`, formatGBP(f.avgSale)];
  return [
    headers,
    ...data.shops.map((shop) =>
      line(
        `${shop.name} (${shop.code})${shop.isHub ? ' — online' : ''}${shop.isActive ? '' : ' — closed'}`,
        shop,
      ),
    ),
    line('All shops', data.combined),
  ];
}
