'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowRight, PackageOpen, Wrench } from 'lucide-react';
import { useAdminProducts, useAnalytics, useJobs } from '@/lib/data/hooks';
import { formatGBP, productIsLowStock, tenderLabel } from '@/lib/data/types';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { BusyHeatmap } from '@/components/admin/charts/busy-heatmap';
import { HBarList } from '@/components/admin/charts/hbar-list';
import { RevenueChart } from '@/components/admin/charts/revenue-chart';
import { PageHeader } from '@/components/admin/page-header';
import { RangePicker, useAnalyticsRange } from '@/components/admin/range-picker';
import { StatTile } from '@/components/admin/stat-tile';

/**
 * Overview — the Analytics module (item 7). One glance answers: how's the
 * money, what needs my hands today, when are we busiest, what sells.
 */
export function OverviewView() {
  const range = useAnalyticsRange();
  const analytics = useAnalytics(range.query);
  const { data: jobs } = useJobs();
  const { data: products } = useAdminProducts();

  const summary = analytics.data;
  const isLoading = analytics.isPending;

  const newJobs = jobs?.filter((j) => j.status === 'new').length ?? 0;
  const benchJobs = jobs?.filter((j) => j.status === 'in_progress').length ?? 0;
  const lowStock = products?.filter((p) => productIsLowStock(p)) ?? [];
  const outOfStock = products?.filter((p) => p.stockQty === 0).length ?? 0;

  const revenueDelta =
    summary && summary.prevRevenue > 0
      ? (summary.revenue - summary.prevRevenue) / summary.prevRevenue
      : null;
  const profitDelta =
    summary && summary.prevProfit > 0
      ? (summary.profit - summary.prevProfit) / summary.prevProfit
      : null;

  return (
    <div>
      <PageHeader eyebrow="Back of house" title="Overview" actions={<RangePicker {...range} />} />

      {analytics.isError ? (
        <div className="border-line bg-card mb-6 flex items-center justify-between gap-4 rounded-lg border p-4">
          <p className="text-ink flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="text-red-deep size-4" aria-hidden="true" />
            The analytics didn’t load.
          </p>
          <Button variant="outline" size="sm" onClick={() => analytics.refetch()}>
            Try again
          </Button>
        </div>
      ) : null}

      {/* Needs attention — the workday starts here */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <AttentionCard
          href="/admin/jobs"
          icon={<Wrench className="size-4" aria-hidden="true" />}
          title={`${newJobs} new job${newJobs === 1 ? '' : 's'} waiting`}
          sub={`${benchJobs} on the bench right now`}
          urgent={newJobs > 0}
        />
        <AttentionCard
          href="/admin/inventory?filter=low"
          icon={<PackageOpen className="size-4" aria-hidden="true" />}
          title={`${lowStock.length} low on stock`}
          sub={
            outOfStock > 0
              ? `${outOfStock} out of stock entirely`
              : 'Thresholds are set per product'
          }
          urgent={lowStock.length > 0}
        />
      </div>

      {/* Headlines */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Revenue"
          value={summary ? formatGBP(summary.revenue) : '—'}
          delta={revenueDelta}
          isLoading={isLoading}
        />
        <StatTile
          label="Profit"
          value={summary ? formatGBP(summary.profit) : '—'}
          delta={profitDelta}
          isLoading={isLoading}
        />
        <StatTile
          label="Margin"
          value={summary ? `${Math.round(summary.margin * 100)}%` : '—'}
          sub="of revenue"
          isLoading={isLoading}
        />
        <StatTile
          label="Sales"
          value={summary ? `${summary.sales}` : '—'}
          sub={summary ? `avg ${formatGBP(summary.avgSale)}` : undefined}
          isLoading={isLoading}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-3 xl:grid-cols-[1.7fr_1fr]">
        <ChartCard title="Revenue" sub="Repairs vs shop, over the selected range">
          {isLoading ? (
            <Skeleton className="h-[264px] w-full" />
          ) : summary && summary.sales > 0 ? (
            <RevenueChart points={summary.series} />
          ) : (
            <EmptyState
              title="No sales in this range"
              description="Pick a wider range to see the shape of the business."
            />
          )}
        </ChartCard>

        <ChartCard title="What sells" sub="Shop revenue by category">
          {isLoading ? (
            <Skeleton className="h-[264px] w-full" />
          ) : summary && summary.byCategory.length > 0 ? (
            <HBarList
              items={summary.byCategory.map((c) => ({
                key: c.category,
                label: c.label,
                sub: `${c.units} sold`,
                value: c.revenue,
              }))}
              formatValue={(v) => formatGBP(v)}
            />
          ) : (
            <EmptyState title="No shop sales yet" />
          )}
        </ChartCard>

        <ChartCard title="Busiest periods" sub="Sales by weekday and hour — staff the peaks">
          {isLoading ? (
            <Skeleton className="h-[200px] w-full" />
          ) : summary && summary.busiest.length > 0 ? (
            <BusyHeatmap cells={summary.busiest} />
          ) : (
            <EmptyState title="Not enough activity to map" />
          )}
        </ChartCard>

        <ChartCard title="Payment mix" sub="How money arrived in this range">
          {isLoading ? (
            <Skeleton className="h-[200px] w-full" />
          ) : summary ? (
            <HBarList
              items={summary.byTender
                .filter((t) => t.count > 0)
                .map((t) => ({
                  key: t.tender,
                  label: tenderLabel(t.tender),
                  sub: `${t.count} payments`,
                  value: t.total,
                }))}
              formatValue={(v) => formatGBP(v)}
            />
          ) : null}
        </ChartCard>
      </div>
    </div>
  );
}

function ChartCard({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-line bg-card rounded-lg border p-4">
      <header className="mb-4">
        <h2 className="font-display text-ink text-sm font-extrabold uppercase tracking-[0.06em]">
          {title}
        </h2>
        <p className="text-muted text-xs">{sub}</p>
      </header>
      {children}
    </section>
  );
}

function AttentionCard({
  href,
  icon,
  title,
  sub,
  urgent,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  sub: string;
  urgent: boolean;
}) {
  return (
    <Link
      href={href}
      className="border-line bg-card hover:border-line-strong group flex items-center justify-between gap-3 rounded-lg border p-3.5 transition-colors duration-150"
    >
      <div className="flex items-center gap-3">
        <span
          className={`flex size-9 items-center justify-center rounded-md ${urgent ? 'bg-red-tint text-red-deep' : 'bg-paper-2 text-muted'}`}
        >
          {icon}
        </span>
        <div>
          <p className="text-ink text-sm font-bold">{title}</p>
          <p className="text-muted text-xs">{sub}</p>
        </div>
      </div>
      <ArrowRight
        className="text-muted group-hover:text-red size-4 transition-colors duration-150"
        aria-hidden="true"
      />
    </Link>
  );
}
