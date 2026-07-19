'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Printer, X } from 'lucide-react';
import { useUpdateJob } from '@/lib/data/hooks';
import type { Job, JobPayment, JobStatus } from '@/lib/data/types';
import { JOB_PIPELINE, formatGBP, jobStatusLabel } from '@/lib/data/types';
import { formatDateTime } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/admin/field';
import { cn } from '@/lib/utils';
import { JobLabel } from './job-label';
import { JobPaymentChip, JobSourceChip, JobStatusChip } from './job-bits';

/**
 * Job panel — slides in from the right. Move the job along the pipeline,
 * change payment, print the device label. Every change lands optimistically.
 */
export function JobSheet({ job, onClose }: { job: Job | null; onClose: () => void }) {
  const updateJob = useUpdateJob();

  const setStatus = (status: JobStatus) => {
    if (!job || job.status === status) return;
    updateJob.mutate({ id: job.id, patch: { status } });
  };
  const setPayment = (payment: JobPayment) => {
    if (!job) return;
    updateJob.mutate({ id: job.id, patch: { payment } });
  };

  return (
    <DialogPrimitive.Root
      open={job !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=open]:fade-in-0 fixed inset-0 z-[2600] bg-[rgba(21,8,7,.45)]" />
        <DialogPrimitive.Content
          className="bg-paper data-[state=open]:animate-in data-[state=open]:slide-in-from-right-6 shadow-drawer fixed inset-y-0 right-0 z-[2600] flex w-[min(420px,100vw)] flex-col overflow-y-auto duration-200"
          aria-describedby={undefined}
        >
          {job ? (
            <>
              <header className="border-line bg-card ticket-edge sticky top-0 border-b px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <DialogPrimitive.Title className="font-display tabular text-ink text-2xl font-extrabold uppercase leading-none tracking-tight">
                      {job.reference}
                    </DialogPrimitive.Title>
                    <p className="text-muted mt-1 text-xs">
                      In {formatDateTime(job.createdAt)} · updated {formatDateTime(job.updatedAt)}
                    </p>
                  </div>
                  <DialogPrimitive.Close className="text-muted hover:text-red rounded-full p-1.5 transition-colors">
                    <X className="size-4" />
                    <span className="sr-only">Close</span>
                  </DialogPrimitive.Close>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <JobStatusChip status={job.status} />
                  <JobPaymentChip payment={job.payment} />
                  <JobSourceChip job={job} />
                </div>
              </header>

              <div className="grid flex-1 content-start gap-5 px-5 py-5">
                {/* Pipeline */}
                <section>
                  <p className="text-muted mb-2 text-[11px] font-bold uppercase tracking-[0.14em]">
                    Pipeline
                  </p>
                  <div className="grid grid-cols-4 gap-1">
                    {JOB_PIPELINE.map((status, i) => {
                      const activeIndex = JOB_PIPELINE.indexOf(job.status);
                      const reached = i <= activeIndex;
                      return (
                        <button
                          key={status}
                          onClick={() => setStatus(status)}
                          title={`Move to ${jobStatusLabel(status)}`}
                          className={cn(
                            'rounded-md px-1 py-2 text-center text-[11px] font-bold uppercase tracking-[0.02em] transition-colors duration-150',
                            reached
                              ? i === activeIndex
                                ? 'bg-red text-white'
                                : 'bg-red-tint text-red-deep'
                              : 'bg-paper-2 text-muted hover:text-ink',
                          )}
                        >
                          {jobStatusLabel(status)}
                        </button>
                      );
                    })}
                  </div>
                </section>

                {/* Customer */}
                <section className="border-line bg-card rounded-lg border p-4">
                  <p className="text-ink text-sm font-bold">{job.customerName}</p>
                  <p className="text-muted tabular mt-0.5 text-sm">{job.phone}</p>
                  {job.email ? <p className="text-muted text-sm">{job.email}</p> : null}
                </section>

                {/* Device */}
                <section className="grid gap-1.5">
                  <p className="text-muted text-[11px] font-bold uppercase tracking-[0.14em]">
                    Device
                  </p>
                  <p className="text-ink text-sm font-semibold">{job.device}</p>
                  <p className="text-ink-2 text-sm">{job.problem}</p>
                  {job.notes ? <p className="text-muted text-sm italic">“{job.notes}”</p> : null}
                </section>

                {/* Money */}
                <section className="grid gap-3">
                  <div className="flex items-baseline justify-between">
                    <p className="text-muted text-[11px] font-bold uppercase tracking-[0.14em]">
                      Quote
                    </p>
                    <p className="font-display tabular text-ink text-xl font-extrabold">
                      {job.quote != null ? formatGBP(job.quote) : 'On diagnosis'}
                    </p>
                  </div>
                  <Field label="Payment status" htmlFor="sheet-payment">
                    <Select
                      id="sheet-payment"
                      value={job.payment}
                      onChange={(e) => setPayment(e.target.value as JobPayment)}
                    >
                      <option value="unpaid">Unpaid</option>
                      <option value="paid-advance">Paid in advance</option>
                      <option value="paid">Paid</option>
                    </Select>
                  </Field>
                </section>
              </div>

              <footer className="border-line bg-card sticky bottom-0 border-t px-5 py-4">
                <Button variant="outline" className="w-full" onClick={() => window.print()}>
                  <Printer aria-hidden="true" />
                  Print device label
                </Button>
              </footer>

              <JobLabel job={job} />
            </>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
