'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useChangeJobStatus, useJobOutstanding } from '@/lib/data/hooks';
import type { Job, JobStatus, JobStatusChange } from '@/lib/data/types';
import { formatGBP, jobStatusLabel, pounds } from '@/lib/data/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/admin/field';

/**
 * The dialog that collects what a status move REQUIRES.
 *
 * The database's validate_job_status_transition trigger refuses a move that
 * arrives without its evidence — a revised quote to block on approval, a
 * tracking number to post a device back, a reason to cancel and, for a mail-in,
 * an answer to "where is the phone". That refusal is correct and stays the
 * authority. This screen exists so staff are ASKED for it rather than shown a
 * 409 after the fact, which is how evidence ends up invented to get past a
 * validation error.
 */
export function JobMoveDialog({
  job,
  target,
  onClose,
}: {
  job: Job | null;
  target: JobStatus | null;
  onClose: () => void;
}) {
  const changeStatus = useChangeJobStatus();
  const [revisedPounds, setRevisedPounds] = useState('');
  const [tracking, setTracking] = useState('');
  const [courier, setCourier] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const open = job !== null && target !== null;

  /**
   * Change request item 14. `collected` and `sent_back` are the two moves that
   * put the device back in the customer's hands, and until now this dialog
   * asked for no money information at all before either of them — a job with
   * £100 still owed went out of the door on a single click.
   *
   * The server refuses it now (409), and 0081 refuses it below that, but a 409
   * the person never saw coming is a bad way to find out. So the figure is
   * fetched and shown here, and Confirm is disabled while anything is owed.
   *
   * Not asked for when the job is already `cancelled`: posting a called-off
   * repair's device back owes nothing, and any deposit returns through a
   * refund. Same exemption the server and the trigger make, deliberately.
   */
  const handingOver = target === 'collected' || target === 'sent_back';
  const checkBalance = open && handingOver && job?.status !== 'cancelled';
  const outstandingQuery = useJobOutstanding(checkBalance ? (job?.id ?? null) : null);
  const owed = outstandingQuery.data?.outstanding ?? null;
  const unpaid = checkBalance && owed !== null && owed > 0;
  // Never let Confirm through on a guess: if the balance hasn't loaded yet we
  // don't know whether anything is owed, so we wait rather than assume £0.
  const balanceUnknown = checkBalance && outstandingQuery.isPending;

  // Fresh evidence for every move. Carrying the last cancellation's reason into
  // the next job's dialog is how the wrong reason gets recorded against a device.
  useEffect(() => {
    if (!open) return;
    setRevisedPounds('');
    setTracking('');
    setCourier('');
    setReason('');
    setError(null);
  }, [open, job?.id, target]);

  if (!job || !target) return null;

  const approving = target === 'in_progress' && job.status === 'waiting_approval';

  const submit = () => {
    setError(null);

    // Item 14 — the same refusal the server makes, said here first.
    if (unpaid) {
      setError(
        `${job.reference} still owes ${formatGBP(owed!)}. Take the remaining payment before handing the device over.`,
      );
      return;
    }
    if (balanceUnknown) {
      setError('Still checking what this job owes — give it a second.');
      return;
    }

    const change: JobStatusChange = { status: target };

    if (target === 'waiting_approval') {
      const value = Number(revisedPounds);
      if (!revisedPounds.trim() || !Number.isFinite(value) || value < 0) {
        setError('Enter the revised price the customer has to agree to.');
        return;
      }
      change.revisedQuote = pounds(value);
    }

    // Leaving waiting_approval back onto the bench IS the approval — the server
    // stamps who and when from the signed-in staff member, so "the customer
    // said yes" always has an owner.
    if (approving) change.approved = true;

    if (target === 'sent_back') {
      if (!tracking.trim()) {
        setError('A return tracking number is required before a device is posted back.');
        return;
      }
      if (!courier.trim()) {
        setError('A courier name is required before a device is posted back.');
        return;
      }
      change.returnTrackingNumber = tracking.trim();
      change.courier = courier.trim();
    }

    if (target === 'cancelled') {
      if (reason.trim().length < 3) {
        setError('Say why the job is being cancelled.');
        return;
      }
      change.cancellationReason = reason.trim();
      // BUG-15-followup #12, extended by Round 3 #2.3: neither channel asks
      // "where is the device?" any more — a cancelled job (mail-in or
      // walk-in) defaults to "still with us" without a question, because
      // that's true almost every time either way. The DB's own CHECK
      // constraint (jobs_cancelled_mail_in_resolves_device) still requires
      // this to be non-null for a cancelled mail-in job, so it's still sent
      // — just decided here instead of asked. CancelledStrip's "Mark
      // collected" (walk-in) / "Post back" (mail-in) actions are where the
      // real answer gets recorded once it's actually true.
      change.deviceReturned = false;
    }

    changeStatus.mutate({ id: job.id, change }, { onSuccess: onClose });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {target === 'cancelled'
              ? `Cancel ${job.reference}`
              : `${job.reference} → ${jobStatusLabel(target)}`}
          </DialogTitle>
          <DialogDescription>
            {job.deviceDescription} · {job.customerName}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {target === 'waiting_approval' ? (
            <>
              <p className="text-ink-2 text-sm">
                This <strong>stops the job</strong>. Nobody should pick the device up again until
                the customer has agreed the new price.
              </p>
              <Field
                label="Revised price (£)"
                htmlFor="move-revised"
                hint={
                  job.quotedPrice != null
                    ? `Originally quoted ${formatGBP(job.quotedPrice)}.`
                    : 'No price was quoted up front.'
                }
              >
                <Input
                  id="move-revised"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  autoFocus
                  className="tabular"
                  placeholder="0.00"
                  value={revisedPounds}
                  onChange={(e) => setRevisedPounds(e.target.value)}
                />
              </Field>
            </>
          ) : null}

          {approving ? (
            <div className="border-line bg-card rounded-ui border p-3">
              <p className="text-ink-2 text-sm">
                Confirming that the customer agreed
                {job.revisedQuote != null ? (
                  <>
                    {' '}
                    to <strong className="tabular">{formatGBP(job.revisedQuote)}</strong>
                  </>
                ) : null}
                . Your name and the time are recorded against it.
              </p>
            </div>
          ) : null}

          {target === 'sent_back' ? (
            <>
              {job.status === 'cancelled' ? (
                <p className="text-ink-2 text-sm">
                  This job was cancelled — posting it back just records that the device left the
                  shop. It stays cancelled; this doesn’t undo that.
                </p>
              ) : null}
              <Field
                label="Courier name"
                htmlFor="move-courier"
                hint="Required — who's carrying it."
              >
                <Input
                  id="move-courier"
                  autoFocus
                  placeholder="e.g. Royal Mail, DPD"
                  value={courier}
                  onChange={(e) => setCourier(e.target.value)}
                />
              </Field>
              <Field
                label="Return tracking number"
                htmlFor="move-tracking"
                hint="Required — this is how the customer finds their device if it goes missing in the post."
              >
                <Input
                  id="move-tracking"
                  className="tabular"
                  placeholder="e.g. AB123456789GB"
                  value={tracking}
                  onChange={(e) => setTracking(e.target.value)}
                />
              </Field>
            </>
          ) : null}

          {target === 'cancelled' ? (
            <Field label="Why is it being cancelled?" htmlFor="move-reason">
              <Textarea
                id="move-reason"
                autoFocus
                placeholder="Customer declined the revised price, parts unavailable, beyond economical repair…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          ) : null}

          {target === 'collected' || target === 'done' || target === 'new' ? (
            <p className="text-ink-2 text-sm">
              Move {job.reference} to {jobStatusLabel(target).toLowerCase()}?
            </p>
          ) : null}

          {/* Item 14: what's owed, before the device leaves — not after a 409. */}
          {checkBalance ? (
            <div
              className={`rounded-ui border p-3 ${unpaid ? 'border-red bg-red/5' : 'border-line bg-card'}`}
            >
              {outstandingQuery.isPending ? (
                <p className="text-ink-2 text-sm">Checking what this job owes…</p>
              ) : unpaid ? (
                <>
                  <p className="text-red flex items-start gap-1.5 text-sm font-semibold">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    Still owes <span className="tabular">{formatGBP(owed!)}</span>
                  </p>
                  <p className="text-ink-2 mt-1 text-sm">
                    {formatGBP(outstandingQuery.data!.target ?? 0)} quoted,{' '}
                    {formatGBP(outstandingQuery.data!.paidTotal)} taken. Record the rest on the
                    payments panel first — the device doesn’t go out unpaid.
                  </p>
                </>
              ) : owed === null ? (
                <p className="text-ink-2 text-sm">
                  No price was ever quoted on this job, so there’s nothing outstanding to collect.
                </p>
              ) : (
                <p className="text-ink-2 text-sm">
                  Paid in full —{' '}
                  <span className="tabular">
                    {outstandingQuery.data!.paidTotal > 0
                      ? formatGBP(outstandingQuery.data!.paidTotal)
                      : formatGBP(0)}
                  </span>{' '}
                  taken. Nothing outstanding.
                </p>
              )}
            </div>
          ) : null}

          {error ? (
            <p className="text-red flex items-start gap-1.5 text-sm font-semibold">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={changeStatus.isPending}>
              Back
            </Button>
            <Button onClick={submit} disabled={changeStatus.isPending || unpaid || balanceUnknown}>
              {changeStatus.isPending ? 'Saving…' : 'Confirm'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
