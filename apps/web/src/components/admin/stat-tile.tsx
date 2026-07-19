'use client';

import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * KPI tile — Archivo numeral with an honest delta against the previous
 * window. `goodWhenUp` flips the colour logic for metrics where up is bad.
 */
export function StatTile({
  label,
  value,
  sub,
  delta,
  goodWhenUp = true,
  isLoading,
}: {
  label: string;
  value: string;
  sub?: string;
  /** Fractional change vs the previous window, e.g. 0.12 = +12%. */
  delta?: number | null;
  goodWhenUp?: boolean;
  isLoading?: boolean;
}) {
  return (
    <div className="bg-card border-line rounded-lg border p-4">
      <p className="text-muted text-[11px] font-semibold uppercase tracking-[0.14em]">{label}</p>
      {isLoading ? (
        <Skeleton className="mt-2 h-9 w-28" />
      ) : (
        <p className="font-display text-ink tabular mt-1 text-[32px] font-extrabold leading-none tracking-tight">
          {value}
        </p>
      )}
      <div className="mt-2 flex items-center gap-2">
        {!isLoading && delta !== undefined && delta !== null ? (
          <DeltaChip delta={delta} goodWhenUp={goodWhenUp} />
        ) : null}
        {sub ? <span className="text-muted text-xs">{sub}</span> : null}
      </div>
    </div>
  );
}

export function DeltaChip({ delta, goodWhenUp = true }: { delta: number; goodWhenUp?: boolean }) {
  const pct = Math.round(Math.abs(delta) * 100);
  const flat = pct === 0;
  const up = delta > 0;
  const good = flat ? null : up === goodWhenUp;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        'tabular inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-bold',
        flat && 'bg-paper-2 text-muted',
        good === true && 'bg-success/10 text-success',
        good === false && 'bg-red-tint text-red-deep',
      )}
      title="vs the previous period"
    >
      <Icon className="size-3" aria-hidden="true" />
      {flat ? 'level' : `${pct}%`}
    </span>
  );
}
