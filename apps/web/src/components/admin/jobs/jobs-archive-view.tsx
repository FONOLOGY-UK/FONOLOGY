'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useJobPage } from '@/lib/data/hooks';
import type { Job, JobQuery } from '@/lib/data/types';
import { formatGBP } from '@/lib/data/types';
import { formatDateTime } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/admin/data-table';
import { PageHeader } from '@/components/admin/page-header';
import { StatusChip } from '@/components/admin/status-chip';
import { JobPaymentChip, JobSourceChip, JobStatusChip, jobAge } from './job-bits';
import { JobSheet } from './job-sheet';

/**
 * The jobs archive (item 7 follow-up, BUG-15-followup #13/#14) — every
 * finished job: collected, posted back, or cancelled. `initialQuery` already
 * has `status` pinned to exactly those three by the page (server component,
 * same "read params here, not with useSearchParams()" reasoning as the live
 * board — see jobs-view.tsx and this route's own page.tsx).
 *
 * Read-mostly on purpose: a finished job's parts/payments/notes are still
 * worth opening (JobSheet), but there's nothing left to DO to it here —
 * `nextJobStatuses()` is empty for all three of these statuses, so the sheet
 * naturally shows no move buttons. The one exception (a cancelled job whose
 * device is still physically at the shop) is handled on the live page's
 * CancelledStrip, not here — that's ongoing shop business, not history.
 */
export function JobsArchiveView({ initialQuery }: { initialQuery: JobQuery }) {
  const [query, setQuery] = useState<JobQuery>(initialQuery);
  const { data: page, isPending, isError, refetch } = useJobPage(query);
  const jobs = page?.items;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = jobs?.find((j) => j.id === selectedId) ?? null;

  const columns = useMemo<ColumnDef<Job>[]>(
    () => [
      {
        accessorKey: 'reference',
        header: 'Ref',
        cell: ({ row }) => (
          <span className="tabular text-ink font-bold">{row.original.reference}</span>
        ),
      },
      {
        accessorKey: 'customerName',
        header: 'Customer',
        cell: ({ row }) => (
          <div>
            <p className="text-ink font-semibold">{row.original.customerName}</p>
            <p className="text-muted tabular text-xs">{row.original.phone}</p>
          </div>
        ),
      },
      { accessorKey: 'deviceDescription', header: 'Device' },
      {
        accessorKey: 'source',
        header: 'In / out',
        cell: ({ row }) => <JobSourceChip job={row.original} />,
      },
      {
        accessorKey: 'quotedPrice',
        header: 'Quote',
        cell: ({ row }) => {
          const job = row.original;
          const quote = job.revisedQuote ?? job.quotedPrice;
          return <span className="tabular">{quote != null ? formatGBP(quote) : '—'}</span>;
        },
      },
      {
        accessorKey: 'paymentStatus',
        header: 'Payment',
        cell: ({ row }) => <JobPaymentChip payment={row.original.paymentStatus} />,
      },
      {
        accessorKey: 'status',
        header: 'Outcome',
        // Round 3 #2.4/#2.5: a job that was cancelled and THEN posted back
        // (or, for a walk-in, marked collected) now carries a real terminal
        // status again — but it never actually finished as a repair, and
        // showing "Posted back"/"Collected" here would read exactly like
        // one that did. cancellationReason survives that move (0051 never
        // clears it), so it's the one reliable signal: if it's set, this
        // was cancelled, whatever the status column now says.
        cell: ({ row }) =>
          row.original.cancellationReason ? (
            <StatusChip tone="danger">Cancelled</StatusChip>
          ) : (
            <JobStatusChip status={row.original.status} />
          ),
      },
      {
        accessorKey: 'updatedAt',
        header: 'Finished',
        cell: ({ getValue }) => (
          <span className="text-muted tabular">{formatDateTime(getValue<string>())}</span>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: 'On the bench',
        cell: ({ getValue }) => (
          <span className="text-muted tabular">{jobAge(getValue<string>())}</span>
        ),
      },
    ],
    [],
  );

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Jobs archive"
        description="Every finished job — collected, posted back, or cancelled. The live board only shows work still in progress."
        actions={
          <Button asChild variant="outline">
            <Link href="/admin/jobs">
              <ArrowLeft aria-hidden="true" />
              Back to Jobs
            </Link>
          </Button>
        }
      />

      <DataTable
        data={jobs}
        columns={columns}
        isLoading={isPending}
        isError={isError}
        errorMessage="The archive didn’t load."
        onRetry={() => refetch()}
        search={query.search ?? ''}
        onSearchChange={(value) =>
          setQuery((q) => ({ ...q, search: value || undefined, offset: 0 }))
        }
        searchPlaceholder="Search name, device, ref…"
        empty={{
          title: 'Nothing archived yet',
          description: 'Finished jobs — collected, posted back or cancelled — land here.',
        }}
        onRowClick={(job) => setSelectedId(job.id)}
      />

      <JobSheet job={selected} onClose={() => setSelectedId(null)} onMove={() => undefined} />
    </div>
  );
}
