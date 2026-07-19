'use client';

import { FileDown, Printer } from 'lucide-react';
import { useAnalytics } from '@/lib/data/hooks';
import { formatGBP, tenderLabel } from '@/lib/data/types';
import { downloadCsv } from '@/lib/export';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/admin/page-header';
import { RangePicker, useAnalyticsRange } from '@/components/admin/range-picker';

/**
 * Reports (item 7): the Business Performance Report — a printable document,
 * not a dashboard. Headline figures, revenue by period, category and payment
 * tables for the selected range. Print / Save-as-PDF via the print dialog;
 * CSV is a real client-side download.
 */
export function ReportsView() {
  const range = useAnalyticsRange();
  const { data: summary, isPending, isError, refetch } = useAnalytics(range.query);

  const exportCsv = () => {
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

      <div className="mb-4 flex gap-2">
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!summary}>
          <FileDown aria-hidden="true" />
          CSV for Excel
        </Button>
        <Button variant="outline" size="sm" onClick={() => window.print()} disabled={!summary}>
          <Printer aria-hidden="true" />
          Print / PDF
        </Button>
      </div>

      {isError ? (
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
          {/* Letterhead */}
          <header className="border-line mb-6 flex items-start justify-between border-b pb-5">
            <div>
              <p className="font-display text-ink text-xl font-extrabold uppercase tracking-tight">
                Fonology<span className="text-red">.</span>
              </p>
              <p className="text-muted text-xs">Business performance report</p>
            </div>
            <p className="text-muted tabular text-right text-xs">
              {range.query.from} → {range.query.to}
              <br />
              Prepared {new Date().toLocaleDateString('en-GB')}
            </p>
          </header>

          {/* Headlines */}
          <dl className="mb-7 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <ReportStat label="Revenue" value={formatGBP(summary.revenue)} />
            <ReportStat label="Cost of goods" value={formatGBP(summary.cost)} />
            <ReportStat label="Profit" value={formatGBP(summary.profit)} />
            <ReportStat label="Margin" value={`${Math.round(summary.margin * 100)}%`} />
          </dl>

          <ReportTable
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

          <ReportTable
            title="Shop revenue by category"
            headers={['Category', 'Units', 'Revenue']}
            rows={summary.byCategory.map((c) => [c.label, `${c.units}`, formatGBP(c.revenue)])}
          />

          <ReportTable
            title="Payment methods"
            headers={['Method', 'Payments', 'Total']}
            rows={summary.byTender
              .filter((t) => t.count > 0)
              .map((t) => [tenderLabel(t.tender), `${t.count}`, formatGBP(t.total)])}
          />

          <p className="text-muted mt-6 text-[11px]">
            {summary.sales} sales · average sale {formatGBP(summary.avgSale)}. Figures are settled
            payments only; trade-in payouts are excluded from revenue. Prices are prices — Fonology
            is not VAT registered.
          </p>
        </article>
      )}
    </div>
  );
}

function ReportStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted text-[11px] font-semibold uppercase tracking-[0.14em]">{label}</dt>
      <dd className="font-display tabular text-ink text-2xl font-extrabold tracking-tight">
        {value}
      </dd>
    </div>
  );
}

function ReportTable({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: string[];
  rows: string[][];
}) {
  return (
    <section className="mb-7">
      <h2 className="font-display text-ink mb-2 text-sm font-extrabold uppercase tracking-[0.06em]">
        {title}
      </h2>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-line border-b">
            {headers.map((h, i) => (
              <th
                key={h}
                className={`text-muted py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] ${i === 0 ? 'text-left' : 'text-right'}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-line/60 border-b last:border-0">
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className={`tabular py-1.5 ${ci === 0 ? 'text-ink text-left font-semibold' : 'text-ink-2 text-right'}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
