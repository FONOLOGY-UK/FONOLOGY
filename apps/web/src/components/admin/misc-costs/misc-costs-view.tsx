'use client';

import { useState } from 'react';
import { usePendingCostLines, useSetSaleLineCost } from '@/lib/data/hooks';
import { formatGBP, pounds } from '@/lib/data/types';
import { formatDateTime } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/admin/page-header';

/**
 * Change request item 10 — misc sales waiting for a cost price.
 *
 * "These sales must be flagged/listed in a separate view so staff/admin can
 * input the missing cost price later, ensuring accurate P&L reporting."
 *
 * Oldest first, deliberately: this is a to-do list, and the oldest gap is
 * both the one distorting reporting for longest and the one nobody will
 * remember the answer to.
 *
 * Saving does not just write the line — set_sale_line_cost() moves
 * sales.cost and re-derives below_cost in the same transaction, because
 * sales.cost is a stored total and correcting the line alone would leave
 * every profit figure for that day wrong forever.
 */
export function MiscCostsView() {
  const pending = usePendingCostLines();

  return (
    <div>
      <PageHeader
        eyebrow="Money"
        title="Missing cost prices"
        description="Miscellaneous items sold at the till before anyone knew what they cost us. Until these are filled in, profit for those days is overstated."
      />

      {pending.isPending ? (
        <div className="grid gap-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : pending.isError ? (
        <div className="border-line bg-card rounded-lg border p-8 text-center">
          <p className="text-ink mb-3 text-sm font-semibold">That list didn’t load.</p>
          <Button variant="outline" size="sm" onClick={() => pending.refetch()}>
            Try again
          </Button>
        </div>
      ) : (pending.data?.length ?? 0) === 0 ? (
        <EmptyState
          title="Nothing waiting"
          description="Every miscellaneous item sold at the till has a cost price against it. Profit figures are complete."
        />
      ) : (
        <ul className="grid gap-2">
          {pending.data!.map((line) => (
            <PendingRow key={line.id} line={line} />
          ))}
        </ul>
      )}
    </div>
  );
}

function PendingRow({
  line,
}: {
  line: {
    id: string;
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    soldAt: string;
    saleReference: string | null;
  };
}) {
  const save = useSetSaleLineCost();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    const n = Number(value);
    // Blank is NOT zero here, unlike at the till. At the till blank means
    // "nobody knows yet", which is how the line got onto this list; on this
    // screen the whole point is to say what it was, so an empty box is an
    // unanswered question rather than an answer of £0.
    if (!value.trim() || !Number.isFinite(n) || n < 0) {
      setError('Enter what it cost us. £0 is a valid answer if it cost nothing.');
      return;
    }
    save.mutate({ id: line.id, costPrice: pounds(n) });
  };

  return (
    <li className="border-line bg-card rounded-lg border p-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-ink text-sm font-bold">{line.name}</p>
          <p className="text-muted text-xs">
            {line.saleReference ? `${line.saleReference} · ` : ''}
            {formatDateTime(line.soldAt)} · {line.quantity} ×{' '}
            <span className="tabular">{formatGBP(line.unitPrice)}</span> ={' '}
            <span className="tabular">{formatGBP(line.lineTotal)}</span>
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label
              htmlFor={`cost-${line.id}`}
              className="text-ink mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em]"
            >
              Cost each (£)
            </label>
            <Input
              id={`cost-${line.id}`}
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              className="tabular h-9 w-28"
              placeholder="0.00"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
            />
          </div>
          <Button size="sm" onClick={submit} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
      {error ? (
        <p className="text-red-deep mt-2 text-xs font-semibold" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}
