'use client';

import { useState } from 'react';
import { FileDown, Printer } from 'lucide-react';
import { useAnalytics, useSession, useShops } from '@/lib/data/hooks';
import { useStaffPermissions } from '@/components/shared/can';
import { formatGBP, tenderLabel } from '@/lib/data/types';
import { downloadCsv } from '@/lib/export';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/admin/page-header';
import { RangePicker, useAnalyticsRange } from '@/components/admin/range-picker';
import {
  PrintReportHeader,
  PrintReportFooter,
  PrintReportStat,
  PrintReportTable,
} from './print-report';
import { ShopComparisonReport } from './shop-comparison';
import { cn } from '@/lib/utils';

/**
 * Reports (item 7): the Business Performance Report — a printable document,
 * not a dashboard. Headline figures, revenue by period, category and payment
 * tables for the selected range. Print / Save-as-PDF via the print dialog;
 * CSV is a real client-side download.
 */
export function ReportsView() {
  const range = useAnalyticsRange();
  const { data: summary, isPending, isError, refetch } = useAnalytics(range.query);

  // Owners and managers can lay the shops side by side; everyone else only has their own.
  const { data: session } = useSession();
  const { data: shops } = useShops();
  const permissions = useStaffPermissions();
  const canCompare =
    session?.kind === 'staff' && session.staffRole !== 'employee' && (shops?.length ?? 0) > 1;
  const showCosts = permissions?.includes('costs.view') ?? false;
  const [view, setView] = useState<'shop' | 'compare'>('shop');
  const comparing = canCompare && view === 'compare';
  const [comparisonRows, setComparisonRows] = useState<string[][] | null>(null);

  const exportCsv = () => {
    if (comparing) {
      if (!comparisonRows) return;
      const [head, ...body] = comparisonRows;
      downloadCsv(`fonology-shops-${range.query.from}-to-${range.query.to}.csv`, head!, body);
      return;
    }
    if (!summary) return;
    downloadCsv(
      `fonology-performance-${range.query.from}-to-${range.query.to}.csv`,
      ['Period', 'Repairs (GBP)', 'Shop (GBP)', 'Total (GBP)'],
      summary.series.map((p) => [
        p.label,
        (p.repair / 100).toFixed(2),
        (p.shop / 100).toFixed(2),
        ((p.repair + p.shop) / 100).toFixed(2),
      ]),
    );
  };

  return (
    <div>
      <PageHeader
        eyebrow="Money"
        title="Reports"
        description="The business performance report, ready for print or the accountant."
        actions={<RangePicker {...range} />}
      />

      {canCompare ? (
        <div
          className="border-line bg-paper mb-3 inline-flex rounded-md border p-0.5 print:hidden"
          role="group"
          aria-label="Report view"
        >
          {(
            [
              ['shop', 'One shop / combined'],
              ['compare', 'Shops side by side'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setView(value)}
              aria-pressed={view === value}
              className={cn(
                'rounded px-3 py-1.5 text-xs font-bold',
                view === value ? 'bg-ink text-bone' : 'text-muted',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mb-4 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={exportCsv}
          disabled={comparing ? !comparisonRows : !summary}
        >
          <FileDown aria-hidden="true" />
          CSV for Excel
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.print()}
          disabled={comparing ? !comparisonRows : !summary}
        >
          <Printer aria-hidden="true" />
          Print / PDF
        </Button>
      </div>

      {comparing ? (
        <ShopComparisonReport
          range={range.query}
          showCosts={showCosts}
          onLoaded={setComparisonRows}
        />
      ) : isError ? (
        <div className="border-line bg-card rounded-lg border p-8 text-center">
          <p className="text-ink mb-3 text-sm font-semibold">The report didn’t load.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      ) : isPending || !summary ? (
        <Skeleton className="h-[480px] w-full" />
      ) : (
        <article className="print-area border-line bg-card rounded-lg border p-6 sm:p-8">
          <PrintReportHeader
            title="Business performance report"
            subtitle="Sales, margin and payment mix"
            from={range.query.from}
            to={range.query.to}
          />

          {/* Headlines */}
          <dl className="mb-7 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <PrintReportStat label="Revenue" value={formatGBP(summary.revenue)} />
            <PrintReportStat label="Cost of goods" value={formatGBP(summary.cost)} />
            <PrintReportStat label="Profit" value={formatGBP(summary.profit)} />
            <PrintReportStat label="Margin" value={`${Math.round(summary.margin * 100)}%`} />
          </dl>

          <PrintReportTable
            title={summary.bucket === 'day' ? 'Revenue by day' : 'Revenue by month'}
            headers={['Period', 'Repairs', 'Shop', 'Total']}
            rows={summary.series
              .filter((p) => p.repair + p.shop > 0)
              .map((p) => [
                p.label,
                formatGBP(p.repair),
                formatGBP(p.shop),
                formatGBP(p.repair + p.shop),
              ])}
          />

          <PrintReportTable
            title="Shop revenue by category"
            headers={['Category', 'Units', 'Revenue']}
            rows={summary.byCategory.map((c) => [c.label, `${c.units}`, formatGBP(c.revenue)])}
          />

          <PrintReportTable
            title="Payment methods"
            headers={['Method', 'Payments', 'Total']}
            rows={summary.byTender
              .filter((t) => t.count > 0)
              .map((t) => [tenderLabel(t.tender), `${t.count}`, formatGBP(t.total)])}
          />

          <PrintReportFooter
            note={`${summary.sales} sales · average sale ${formatGBP(summary.avgSale)}. Figures are settled payments only; trade-in payouts are excluded from revenue. Prices are prices — Fonology is not VAT registered.`}
          />
        </article>
      )}
    </div>
  );
}
