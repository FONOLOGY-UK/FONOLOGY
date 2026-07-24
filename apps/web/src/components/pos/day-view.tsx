'use client';

import { useTodayReport } from '@/lib/data/hooks';
import { formatGBP, tenderLabel } from '@/lib/data/types';
import { formatDateTime } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { HBarList } from '@/components/admin/charts/hbar-list';
import { cn } from '@/lib/utils';

/**
 * "My day" — the employee's own shift view (permission `sales.today`).
 *
 * It answers the questions someone on the counter actually asks: how much
 * have we taken, how many sales was that, what's in the drawer versus on the
 * cards, and what did I just ring through. Everything is scoped to TODAY by
 * construction — there is no range picker, because there is no range: the
 * adapter only ever returns the current trading day.
 *
 * Deliberately absent: cost, margin, profit, yesterday, this month. Those are
 * the owner's numbers and live behind `analytics.view` in the admin panel.
 */
export function DayView() {
  const report = useTodayReport();
  const data = report.data;

  const dayLabel = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  if (report.isError) {
    return (
      <div className="border-line bg-card rounded-lg border p-8 text-center">
        <p className="text-ink mb-3 text-sm font-semibold">Today’s figures didn’t load.</p>
        <Button variant="outline" size="sm" onClick={() => report.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div>
      <header className="mb-5">
        <p className="text-red text-[11px] font-bold uppercase tracking-[0.18em]">Counter</p>
        <h1 className="font-display text-ink text-2xl font-extrabold uppercase tracking-tight">
          My day
        </h1>
        <p className="text-muted text-sm">{dayLabel} · today only</p>
      </header>

      {/* The four numbers that matter on a shift. */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <DayTile
          label="Taken today"
          value={data ? formatGBP(data.total) : '—'}
          loading={report.isPending}
          hero
        />
        <DayTile
          label="Sales"
          value={data ? `${data.salesCount}` : '—'}
          sub={data && data.salesCount > 0 ? `avg ${formatGBP(data.averageSale)}` : undefined}
          loading={report.isPending}
        />
        <DayTile
          label="Last sale"
          value={
            data?.lastSaleAt
              ? new Date(data.lastSaleAt).toLocaleTimeString('en-GB', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '—'
          }
          sub={data && !data.lastSaleAt ? 'nothing yet today' : undefined}
          loading={report.isPending}
        />
        <DayTile
          label="Busiest tender"
          value={
            data && data.byTender.length > 0
              ? tenderLabel([...data.byTender].sort((a, b) => b.total - a.total)[0]!.tender)
              : '—'
          }
          sub={data && data.byTender.length > 0 ? 'most money through it' : undefined}
          loading={report.isPending}
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-[1fr_1.3fr]">
        {/* How the money arrived — the count-up at close of play. */}
        <section className="border-line bg-card rounded-lg border p-4">
          <header className="mb-4">
            <h2 className="font-display text-ink text-sm font-extrabold uppercase tracking-[0.06em]">
              How it was paid
            </h2>
            <p className="text-muted text-xs">Cash here should match the drawer at close</p>
          </header>
          {report.isPending ? (
            <Skeleton className="h-[180px] w-full" />
          ) : data && data.byTender.length > 0 ? (
            <HBarList
              items={data.byTender.map((t) => ({
                key: t.tender,
                label: tenderLabel(t.tender),
                sub: `${t.count} payment${t.count === 1 ? '' : 's'}`,
                value: t.total,
              }))}
              formatValue={(v) => formatGBP(v)}
            />
          ) : (
            <EmptyState title="Nothing taken yet" description="The first sale will show up here." />
          )}
        </section>

        {/* The day's sales, newest first. */}
        <section className="border-line bg-card rounded-lg border p-4">
          <header className="mb-3">
            <h2 className="font-display text-ink text-sm font-extrabold uppercase tracking-[0.06em]">
              Today’s sales
            </h2>
            <p className="text-muted text-xs">Newest first — split payments shown as one sale</p>
          </header>
          {report.isPending ? (
            <div className="grid gap-2">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : data && data.sales.length > 0 ? (
            <ul className="grid max-h-[420px] gap-1.5 overflow-y-auto">
              {data.sales.map((sale) => (
                <li
                  key={sale.reference}
                  className="bg-paper-2/50 flex items-center gap-3 rounded-md px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-ink tabular text-[13px] font-bold">{sale.reference}</p>
                    <p className="text-muted truncate text-xs">
                      {formatDateTime(sale.at)} ·{' '}
                      {sale.tenders.map((t) => tenderLabel(t)).join(' + ')}
                    </p>
                  </div>
                  <span className="tabular text-ink shrink-0 text-sm font-extrabold">
                    {formatGBP(sale.total)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No sales yet today"
              description="Ring one through on Checkout and it appears here."
            />
          )}
        </section>
      </div>
    </div>
  );
}

function DayTile({
  label,
  value,
  sub,
  loading,
  hero,
}: {
  label: string;
  value: string;
  sub?: string;
  loading?: boolean;
  hero?: boolean;
}) {
  return (
    <div
      className={cn(
        'border-line bg-card rounded-lg border p-4',
        hero && 'border-red/30 bg-red-tint/25',
      )}
    >
      <p className="text-muted text-[11px] font-semibold uppercase tracking-[0.08em]">{label}</p>
      {loading ? (
        <Skeleton className="mt-1.5 h-8 w-24" />
      ) : (
        <p
          className={cn(
            'font-display text-ink tabular mt-1 font-extrabold',
            hero ? 'text-3xl' : 'text-2xl',
          )}
        >
          {value}
        </p>
      )}
      {sub ? <p className="text-muted text-xs">{sub}</p> : null}
    </div>
  );
}
