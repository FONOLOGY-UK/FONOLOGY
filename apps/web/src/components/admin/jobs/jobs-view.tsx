'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowRight, Columns3, Plus, Rows3 } from 'lucide-react';
import { useJobs, useUpdateJob } from '@/lib/data/hooks';
import type { Job } from '@/lib/data/types';
import { JOB_PIPELINE, formatGBP, jobStatusLabel, nextJobStatus } from '@/lib/data/types';
import { useAdminStore } from '@/lib/stores/admin.store';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { DataTable } from '@/components/admin/data-table';
import { PageHeader } from '@/components/admin/page-header';
import { cn } from '@/lib/utils';
import { AddJobDialog } from './add-job-dialog';
import { JobPaymentChip, JobSourceChip, JobStatusChip, jobAge } from './job-bits';
import { JobSheet } from './job-sheet';

/**
 * Jobs — the bench pipeline (item 7). Board view mirrors the physical bench:
 * four columns, tickets move left to right. Table view is the dense audit
 * view of the same list. Press N to add a walk-in.
 */
export function JobsView() {
  const { data: jobs, isPending, isError, refetch } = useJobs();
  const updateJob = useUpdateJob();
  const view = useAdminStore((s) => s.jobsView);
  const setView = useAdminStore((s) => s.setJobsView);

  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  const advance = (job: Job) => {
    const next = nextJobStatus(job.status);
    if (next) updateJob.mutate({ id: job.id, patch: { status: next } });
  };

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
      { accessorKey: 'device', header: 'Device' },
      {
        accessorKey: 'problem',
        header: 'Problem',
        cell: ({ getValue }) => (
          <span className="block max-w-[220px] truncate">{getValue<string>()}</span>
        ),
      },
      {
        accessorKey: 'quote',
        header: 'Quote',
        cell: ({ getValue }) => {
          const quote = getValue<number | null>();
          return (
            <span className="tabular">{quote != null ? formatGBP(quote) : 'On diagnosis'}</span>
          );
        },
      },
      {
        accessorKey: 'payment',
        header: 'Payment',
        cell: ({ row }) => <JobPaymentChip payment={row.original.payment} />,
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

      {view === 'board' ? (
        <Board
          jobs={jobs}
          isPending={isPending}
          isError={isError}
          onRetry={refetch}
          onOpen={(job) => setSelectedId(job.id)}
          onAdvance={advance}
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

/* ---- board ----------------------------------------------------------------- */

function Board({
  jobs,
  isPending,
  isError,
  onRetry,
  onOpen,
  onAdvance,
  onAdd,
}: {
  jobs: Job[] | undefined;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  onOpen: (job: Job) => void;
  onAdvance: (job: Job) => void;
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

  return (
    <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-4">
      {JOB_PIPELINE.map((status) => {
        const columnJobs = jobs?.filter((j) => j.status === status) ?? [];
        return (
          <section key={status} className="bg-paper-2/50 rounded-lg p-2">
            <header className="flex items-center justify-between px-2 py-1.5">
              <h2 className="text-ink text-[11px] font-bold uppercase tracking-[0.12em]">
                {jobStatusLabel(status)}
              </h2>
              <span className="bg-paper-2 text-muted tabular rounded-md px-1.5 py-0.5 text-[11px] font-bold">
                {isPending ? '…' : columnJobs.length}
              </span>
            </header>
            <div className="grid gap-2">
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
                  <JobTicket key={job.id} job={job} onOpen={onOpen} onAdvance={onAdvance} />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function JobTicket({
  job,
  onOpen,
  onAdvance,
}: {
  job: Job;
  onOpen: (job: Job) => void;
  onAdvance: (job: Job) => void;
}) {
  const next = nextJobStatus(job.status);
  return (
    <article className="ticket-edge border-line bg-card hover:border-line-strong rounded-lg border transition-colors duration-150">
      <button className="w-full px-3 pb-2 pt-3 text-left" onClick={() => onOpen(job)}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="tabular text-ink text-[13px] font-extrabold">{job.reference}</span>
          <span className="text-muted tabular text-[11px]" title="Time on the bench">
            {jobAge(job.createdAt)}
          </span>
        </div>
        <p className="text-ink mt-1 truncate text-[13px] font-semibold">{job.device}</p>
        <p className="text-muted truncate text-xs">{job.problem}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <JobPaymentChip payment={job.payment} />
          <JobSourceChip job={job} />
          <span className="tabular text-ink ml-auto text-xs font-bold">
            {job.quote != null ? formatGBP(job.quote) : '—'}
          </span>
        </div>
      </button>
      {next ? (
        <button
          onClick={() => onAdvance(job)}
          className="border-line text-muted hover:text-red flex w-full items-center justify-center gap-1 border-t px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] transition-colors duration-150"
        >
          {jobStatusLabel(next)}
          <ArrowRight className="size-3" aria-hidden="true" />
        </button>
      ) : null}
    </article>
  );
}
