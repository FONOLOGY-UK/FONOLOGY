'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowRight, Ban, Columns3, Hand, Plus, Rows3 } from 'lucide-react';
import { useJobPage, useStaff } from '@/lib/data/hooks';
import type { Job, JobQuery, JobSource, JobStatus } from '@/lib/data/types';
import {
  JOB_BLOCKED_STATUS,
  JOB_PIPELINE,
  formatGBP,
  isMailIn,
  jobMoveLabel,
  jobStatusLabel,
  nextJobStatuses,
} from '@/lib/data/types';
import { formatDateTime } from '@/lib/dates';
import { useAdminStore } from '@/lib/stores/admin.store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { DataTable } from '@/components/admin/data-table';
import { PageHeader } from '@/components/admin/page-header';
import { cn } from '@/lib/utils';
import { AddJobDialog } from './add-job-dialog';
import { JobPaymentChip, JobSourceChip, JobStatusChip, jobAge } from './job-bits';
import { JobMoveDialog } from './job-move-dialog';
import { JobSheet } from './job-sheet';

/**
 * Jobs — the bench board (item 7).
 *
 * What makes this a board rather than a list of statuses:
 *
 *  • `waiting_approval` is drawn as a STOP, not as another column in the queue.
 *    A job there is not being worked on, and if it reads like one, a second
 *    technician picks the device up while the shop is waiting on the customer.
 *  • Every card carries its source marker at every stage, because a mail-in
 *    needs packing and a tracking number where a walk-in needs a phone call.
 *  • The only moves offered are the ones the API will accept —
 *    `nextJobStatuses(status, source)` narrows them, so a mail-in is never
 *    offered "Collected" and a walk-in never "Posted back".
 *  • `cancelled` has no column. It is not a stage of work, and giving it one
 *    implies jobs are meant to flow into it. Cancelled jobs sit in a separate
 *    strip that shows the reason and, for mail-ins, where the device is.
 */
export function JobsView({ initialQuery }: { initialQuery: JobQuery }) {
  const [query, setQuery] = useState<JobQuery>(initialQuery);
  const { data: page, isPending, isError, refetch } = useJobPage(query);
  const jobs = page?.items;

  const view = useAdminStore((s) => s.jobsView);
  const setView = useAdminStore((s) => s.setJobsView);

  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [move, setMove] = useState<{ job: Job; target: JobStatus } | null>(null);
  const selected = jobs?.find((j) => j.id === selectedId) ?? null;

  // N = new job, unless typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'n' && e.key !== 'N') return;
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      setAdding(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
      // These three used to name fields the Job type no longer has
      // (`device`, `problem`, `quote`), so the columns silently rendered blank.
      { accessorKey: 'deviceDescription', header: 'Device' },
      {
        accessorKey: 'problemDescription',
        header: 'Problem',
        cell: ({ getValue }) => (
          <span className="block max-w-[220px] truncate">{getValue<string>()}</span>
        ),
      },
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
          return (
            <span className="tabular">
              {quote != null ? formatGBP(quote) : 'On diagnosis'}
              {job.revisedQuote != null ? (
                <span className="text-muted ml-1 text-xs">revised</span>
              ) : null}
            </span>
          );
        },
      },
      {
        accessorKey: 'paymentStatus',
        header: 'Payment',
        cell: ({ row }) => <JobPaymentChip payment={row.original.paymentStatus} />,
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => <JobStatusChip status={row.original.status} />,
      },
      {
        accessorKey: 'createdAt',
        header: 'Age',
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
        title="Jobs"
        description="Every device on the bench, whichever door it came through."
        actions={
          <>
            <div
              className="border-line bg-card rounded-ui inline-flex border p-0.5"
              role="group"
              aria-label="View"
            >
              <ViewButton active={view === 'board'} onClick={() => setView('board')} label="Board">
                <Columns3 className="size-4" aria-hidden="true" />
              </ViewButton>
              <ViewButton active={view === 'table'} onClick={() => setView('table')} label="Table">
                <Rows3 className="size-4" aria-hidden="true" />
              </ViewButton>
            </div>
            <Button onClick={() => setAdding(true)} title="Add a walk-in job (N)">
              <Plus aria-hidden="true" />
              Add job
            </Button>
          </>
        }
      />

      <BoardFilters query={query} onChange={setQuery} />

      {view === 'board' ? (
        <Board
          jobs={jobs}
          isPending={isPending}
          isError={isError}
          onRetry={refetch}
          onOpen={(job) => setSelectedId(job.id)}
          onMove={(job, target) => setMove({ job, target })}
          onAdd={() => setAdding(true)}
        />
      ) : (
        <DataTable
          data={jobs}
          columns={columns}
          isLoading={isPending}
          isError={isError}
          errorMessage="The jobs list didn’t load."
          onRetry={() => refetch()}
          searchPlaceholder="Search name, device, ref…"
          empty={{
            title: 'Nothing on the bench',
            description: 'Walk-ins land here the moment you add them.',
            action: <Button onClick={() => setAdding(true)}>Add job</Button>,
          }}
          onRowClick={(job) => setSelectedId(job.id)}
        />
      )}

      <AddJobDialog open={adding} onOpenChange={setAdding} />
      <JobSheet job={selected} onClose={() => setSelectedId(null)} />
      <JobMoveDialog
        job={move?.job ?? null}
        target={move?.target ?? null}
        onClose={() => setMove(null)}
      />
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      title={label}
      className={cn(
        'rounded-[10px] p-2 transition-colors duration-150',
        active ? 'bg-ink text-bone' : 'text-muted hover:text-ink',
      )}
    >
      {children}
      <span className="sr-only">{label} view</span>
    </button>
  );
}

/* ---- filters --------------------------------------------------------------- */

const SOURCE_FILTERS: { id: JobSource | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'walk_in', label: 'Walk-in' },
  { id: 'mail_in', label: 'Mail-in' },
  { id: 'online', label: 'Online' },
];

/**
 * Filtering happens SERVER-side (`GET /jobs` takes `status`, `source`,
 * `search`). A shop two years in has thousands of finished jobs; shipping them
 * all to the browser to draw six columns would work on day one and crawl by
 * the time it mattered.
 */
function BoardFilters({
  query,
  onChange,
}: {
  query: JobQuery;
  onChange: (query: JobQuery) => void;
}) {
  const [search, setSearch] = useState(query.search ?? '');

  // Debounced so a five-character reference isn't five round trips.
  useEffect(() => {
    const id = setTimeout(() => {
      const next = search.trim();
      if ((query.search ?? '') === next) return;
      onChange({ ...query, search: next || undefined, offset: 0 });
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search name, device, ref…"
        className="max-w-[260px]"
        aria-label="Search jobs"
      />
      <div className="border-line bg-card rounded-ui inline-flex border p-0.5" role="group">
        {SOURCE_FILTERS.map((f) => {
          const active = (query.source ?? 'all') === f.id;
          return (
            <button
              key={f.id}
              onClick={() =>
                onChange({
                  ...query,
                  source: f.id === 'all' ? undefined : f.id,
                  offset: 0,
                })
              }
              aria-pressed={active}
              className={cn(
                'rounded-[10px] px-2.5 py-1.5 text-xs font-bold transition-colors duration-150',
                active ? 'bg-ink text-bone' : 'text-muted hover:text-ink',
              )}
            >
              {f.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---- board ----------------------------------------------------------------- */

function Board({
  jobs,
  isPending,
  isError,
  onRetry,
  onOpen,
  onMove,
  onAdd,
}: {
  jobs: Job[] | undefined;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  onOpen: (job: Job) => void;
  onMove: (job: Job, target: JobStatus) => void;
  onAdd: () => void;
}) {
  if (isError) {
    return (
      <div className="border-line bg-card rounded-lg border p-8 text-center">
        <p className="text-ink mb-3 text-sm font-semibold">The board didn’t load.</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  const cancelled = jobs?.filter((j) => j.status === 'cancelled') ?? [];

  return (
    <>
      <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {JOB_PIPELINE.map((status) => {
          const columnJobs = jobs?.filter((j) => j.status === status) ?? [];
          const blocked = status === JOB_BLOCKED_STATUS;
          return (
            <section
              key={status}
              className={cn(
                // Each column is capped and scrolls its OWN cards.
                //
                // Before this, the board was as tall as its busiest column —
                // with ~40 jobs in New, reaching Done / Posted back /
                // Collected meant scrolling past every one of them, and on
                // narrower screens those columns wrap onto rows below, so
                // they were effectively 18 screens down. Counter staff need
                // to see the shape of the whole bench at a glance.
                //
                // 70vh rather than a pixel calc against the header heights:
                // it stays correct if the toolbar above ever changes, and
                // leaves enough of the page visible that the board is
                // obviously not the only thing on it.
                'flex max-h-[70vh] flex-col rounded-lg p-2',
                // The blocked column is drawn differently on purpose: the whole
                // point is that it does NOT read as another queue of work.
                blocked ? 'bg-warning/10 ring-warning/30 ring-1' : 'bg-paper-2/50',
              )}
            >
              <header className="flex shrink-0 items-center justify-between gap-2 px-2 py-1.5">
                <h2
                  className={cn(
                    'flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.12em]',
                    blocked ? 'text-warning' : 'text-ink',
                  )}
                >
                  {blocked ? <Hand className="size-3" aria-hidden="true" /> : null}
                  {blocked ? 'Stopped' : jobStatusLabel(status)}
                </h2>
                <span
                  className={cn(
                    'tabular rounded-md px-1.5 py-0.5 text-[11px] font-bold',
                    blocked ? 'bg-warning text-white' : 'bg-paper-2 text-muted',
                  )}
                >
                  {isPending ? '…' : columnJobs.length}
                </span>
              </header>
              {blocked ? (
                <p className="text-warning shrink-0 px-2 pb-2 text-[11px] font-semibold leading-snug">
                  Waiting on the customer. Don’t pick these up.
                </p>
              ) : null}
              {/*
                Three classes here are load-bearing, not decoration:
                  min-h-0    — without it a flex child refuses to shrink below
                               its content height, so the column grows past
                               the cap instead of scrolling.
                  overflow-y-auto — the actual scroller.
                  relative   — stops the clipped content still counting toward
                               the DOCUMENT's scroll height. Measured: without
                               it the page scrolled 4,900px into blank space
                               below the board (35 cards' worth) even though
                               every column was correctly capped at 504px and
                               scrolling internally. With it the page is
                               1,262px — the height of the content you can
                               actually see.
              */}
              <div className="relative grid min-h-0 flex-1 content-start gap-2 overflow-y-auto pr-0.5">
                {isPending ? (
                  <>
                    <Skeleton className="h-[104px] w-full" />
                    <Skeleton className="h-[104px] w-full" />
                  </>
                ) : columnJobs.length === 0 ? (
                  status === 'new' ? (
                    <EmptyState
                      title="Clear"
                      description="No new jobs waiting."
                      className="py-8"
                      action={
                        <Button variant="outline" size="sm" onClick={onAdd}>
                          Add job
                        </Button>
                      }
                    />
                  ) : (
                    <p className="text-muted px-2 py-6 text-center text-xs">Empty</p>
                  )
                ) : (
                  columnJobs.map((job) => (
                    <JobTicket key={job.id} job={job} onOpen={onOpen} onMove={onMove} />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>

      {cancelled.length > 0 ? <CancelledStrip jobs={cancelled} onOpen={onOpen} /> : null}
    </>
  );
}

function JobTicket({
  job,
  onOpen,
  onMove,
}: {
  job: Job;
  onOpen: (job: Job) => void;
  onMove: (job: Job, target: JobStatus) => void;
}) {
  const { data: staff } = useStaff();
  const moves = nextJobStatuses(job.status, job.source);
  const forward = moves.filter((s) => s !== 'cancelled');
  const canCancel = moves.includes('cancelled');
  const blocked = job.status === JOB_BLOCKED_STATUS;

  const approver =
    job.revisedQuoteApprovedBy != null
      ? (staff?.find((s) => s.id === job.revisedQuoteApprovedBy)?.name ?? 'a staff member')
      : null;

  return (
    <article
      className={cn(
        'ticket-edge rounded-lg border transition-colors duration-150',
        blocked ? 'border-warning bg-warning/10' : 'border-line bg-card hover:border-line-strong',
      )}
    >
      <button className="w-full px-3 pb-2 pt-3 text-left" onClick={() => onOpen(job)}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="tabular text-ink text-[13px] font-extrabold">{job.reference}</span>
          <span className="text-muted tabular text-[11px]" title="Time on the bench">
            {jobAge(job.createdAt)}
          </span>
        </div>
        <p className="text-ink mt-1 truncate text-[13px] font-semibold">{job.deviceDescription}</p>
        <p className="text-muted truncate text-xs">{job.problemDescription}</p>

        {/*
          A stopped job has to say WHAT it is waiting on and WHO owns the answer,
          or it becomes a card nobody dares touch and the device ages on a shelf.
        */}
        {blocked ? (
          <div className="border-warning/50 mt-2 rounded-md border border-dashed px-2 py-1.5">
            <p className="text-warning text-[11px] font-bold uppercase tracking-[0.08em]">
              Awaiting the customer’s yes
            </p>
            <p className="text-ink tabular mt-0.5 text-sm font-extrabold">
              {job.revisedQuote != null
                ? formatGBP(job.revisedQuote)
                : 'Revised price not recorded'}
              {job.quotedPrice != null ? (
                <span className="text-muted ml-1 text-[11px] font-semibold">
                  was {formatGBP(job.quotedPrice)}
                </span>
              ) : null}
            </p>
            <p className="text-muted mt-0.5 text-[11px]">
              {job.revisedQuoteApprovedAt
                ? `Agreed by ${approver} · ${formatDateTime(job.revisedQuoteApprovedAt)}`
                : 'Not yet agreed.'}
            </p>
          </div>
        ) : null}

        {job.status === 'sent_back' && job.returnTrackingNumber ? (
          <p className="text-muted tabular mt-2 text-[11px]">Tracking {job.returnTrackingNumber}</p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <JobPaymentChip payment={job.paymentStatus} />
          {/* At EVERY stage — how the device leaves changes what staff do with it. */}
          <JobSourceChip job={job} />
          <span className="tabular text-ink ml-auto text-xs font-bold">
            {(job.revisedQuote ?? job.quotedPrice) != null
              ? formatGBP(job.revisedQuote ?? job.quotedPrice!)
              : '—'}
          </span>
        </div>
      </button>

      {forward.length > 0 || canCancel ? (
        <div className="border-line flex items-stretch border-t">
          {forward.map((target) => (
            <button
              key={target}
              onClick={() => onMove(job, target)}
              // whitespace-nowrap keeps every card the same height: a wrapped
              // label made one card taller than its neighbours and the board
              // stopped lining up. Compact labels (jobMoveLabel) keep it
              // fitting without shrinking the text.
              className="text-muted hover:text-red border-line flex flex-1 items-center justify-center gap-1 whitespace-nowrap border-r px-2 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] transition-colors duration-150 last:border-r-0"
              title={`Move ${job.reference} to ${jobStatusLabel(target)}`}
            >
              {job.status === JOB_BLOCKED_STATUS && target === 'in_progress'
                ? 'Approved'
                : jobMoveLabel(target)}
              <ArrowRight className="size-3 shrink-0" aria-hidden="true" />
            </button>
          ))}
          {canCancel ? (
            <button
              onClick={() => onMove(job, 'cancelled')}
              title="Cancel this job"
              className="text-muted hover:text-red px-2.5 py-1.5 transition-colors duration-150"
            >
              <Ban className="size-3.5" aria-hidden="true" />
              <span className="sr-only">Cancel {job.reference}</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/**
 * Cancelled jobs, off the board but not out of sight.
 *
 * The thing that must never happen is a customer's device leaving the system
 * unaccounted for, so a cancelled mail-in shows where the phone is in plain
 * words — and says so loudly while the shop still has it.
 */
function CancelledStrip({ jobs, onOpen }: { jobs: Job[]; onOpen: (job: Job) => void }) {
  const holding = jobs.filter((j) => isMailIn(j.source) && j.deviceReturned === false);

  return (
    <section className="border-line mt-6 border-t pt-4">
      <h2 className="text-muted mb-2 text-[11px] font-bold uppercase tracking-[0.12em]">
        Cancelled ({jobs.length})
      </h2>
      {holding.length > 0 ? (
        <p className="text-red mb-2 text-sm font-semibold">
          {holding.length === 1
            ? 'One cancelled mail-in device is still with the shop.'
            : `${holding.length} cancelled mail-in devices are still with the shop.`}{' '}
          They need posting back or collecting.
        </p>
      ) : null}
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {jobs.map((job) => (
          <button
            key={job.id}
            onClick={() => onOpen(job)}
            className="border-line bg-card hover:border-line-strong rounded-lg border px-3 py-2.5 text-left transition-colors duration-150"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="tabular text-ink text-[13px] font-extrabold">{job.reference}</span>
              <span className="text-muted text-[11px]">{job.customerName}</span>
            </div>
            <p className="text-muted truncate text-xs">{job.deviceDescription}</p>
            <p className="text-ink-2 mt-1 text-xs">
              {job.cancellationReason ?? 'No reason recorded.'}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <JobSourceChip job={job} />
              {isMailIn(job.source) ? (
                <span
                  className={cn(
                    'rounded-md px-1.5 py-0.5 text-[11px] font-bold',
                    job.deviceReturned === true
                      ? 'bg-success/10 text-success'
                      : 'bg-red-tint text-red-deep',
                  )}
                >
                  {job.deviceReturned === true ? 'Device returned' : 'Device still with us'}
                </span>
              ) : null}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
