'use client';

import { useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Printer, X } from 'lucide-react';
import { PrintButton } from '@/components/shared/print-button';
import {
  useAddJobPart,
  useAdminProducts,
  useJobParts,
  useRecordJobPayment,
} from '@/lib/data/hooks';
import type { Job } from '@/lib/data/types';
import { JOB_PIPELINE, formatGBP, jobStatusLabel, pounds } from '@/lib/data/types';
import { formatDateTime } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/admin/field';
import { cn } from '@/lib/utils';
import { JobLabel } from './job-label';
import { JobPaymentChip, JobSourceChip, JobStatusChip } from './job-bits';

/**
 * Job panel — slides in from the right. The device's whole story: where it is,
 * what's been fitted to it, what's been paid.
 *
 * The pipeline here is a READ-ONLY indicator. It used to be a row of buttons
 * that set `status` directly, which skipped every piece of evidence the server
 * requires — no revised quote, no tracking number, no cancellation reason — and
 * went through `updateJob`, which has no endpoint at all. Moves belong to the
 * board's dialog, which asks for what the move needs.
 */
export function JobSheet({ job, onClose }: { job: Job | null; onClose: () => void }) {
  return (
    <DialogPrimitive.Root
      open={job !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=open]:fade-in-0 fixed inset-0 z-[2600] bg-[rgba(21,8,7,.45)]" />
        <DialogPrimitive.Content
          className="bg-paper data-[state=open]:animate-in data-[state=open]:slide-in-from-right-6 shadow-drawer fixed inset-y-0 right-0 z-[2600] flex w-[min(460px,100vw)] flex-col overflow-y-auto duration-200"
          aria-describedby={undefined}
        >
          {job ? <SheetBody job={job} /> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function SheetBody({ job }: { job: Job }) {
  const price = job.revisedQuote ?? job.quotedPrice;

  return (
    <>
      <header className="border-line bg-card ticket-edge sticky top-0 z-10 border-b px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <DialogPrimitive.Title className="font-display tabular text-ink text-2xl font-extrabold uppercase leading-none tracking-tight">
              {job.reference}
            </DialogPrimitive.Title>
            <p className="text-muted mt-1 text-xs">
              In {formatDateTime(job.createdAt)} · updated{' '}
              {job.updatedAt ? formatDateTime(job.updatedAt) : '—'}
            </p>
          </div>
          <DialogPrimitive.Close className="text-muted hover:text-red rounded-full p-1.5 transition-colors">
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <JobStatusChip status={job.status} />
          <JobPaymentChip payment={job.paymentStatus} />
          <JobSourceChip job={job} />
        </div>
      </header>

      <div className="grid flex-1 content-start gap-5 px-5 py-5">
        {/* The blocked state, spelled out. */}
        {job.status === 'waiting_approval' ? (
          <section className="border-warning bg-warning/10 rounded-lg border p-4">
            <p className="text-warning text-[11px] font-bold uppercase tracking-[0.14em]">
              Stopped — waiting on the customer
            </p>
            <p className="text-ink tabular mt-1 text-lg font-extrabold">
              {job.revisedQuote != null ? formatGBP(job.revisedQuote) : 'No revised price recorded'}
            </p>
            <p className="text-muted text-xs">
              {job.revisedQuoteApprovedAt
                ? `Agreed ${formatDateTime(job.revisedQuoteApprovedAt)}`
                : 'Not yet agreed. Don’t start work on it.'}
            </p>
          </section>
        ) : null}

        {job.status === 'cancelled' ? (
          <section className="border-line bg-card rounded-lg border p-4">
            <p className="text-muted text-[11px] font-bold uppercase tracking-[0.14em]">
              Cancelled
            </p>
            <p className="text-ink-2 mt-1 text-sm">
              {job.cancellationReason ?? 'No reason recorded.'}
            </p>
            {job.deviceReturned !== null ? (
              <p
                className={cn(
                  'mt-1 text-sm font-bold',
                  job.deviceReturned ? 'text-success' : 'text-red',
                )}
              >
                {job.deviceReturned
                  ? 'Device returned to the customer.'
                  : 'Device is still with the shop.'}
              </p>
            ) : null}
          </section>
        ) : null}

        {job.status === 'sent_back' && job.returnTrackingNumber ? (
          <section className="border-line bg-card rounded-lg border p-4">
            <p className="text-muted text-[11px] font-bold uppercase tracking-[0.14em]">
              Posted back
            </p>
            <p className="text-ink tabular mt-1 text-sm font-bold">{job.returnTrackingNumber}</p>
          </section>
        ) : null}

        {/* Customer */}
        <section className="border-line bg-card rounded-lg border p-4">
          <p className="text-ink text-sm font-bold">{job.customerName}</p>
          <p className="text-muted tabular mt-0.5 text-sm">{job.phone}</p>
          {job.email ? <p className="text-muted text-sm">{job.email}</p> : null}
        </section>

        {/* Device */}
        <section className="grid gap-1.5">
          <p className="text-muted text-[11px] font-bold uppercase tracking-[0.14em]">Device</p>
          <p className="text-ink text-sm font-semibold">{job.deviceDescription}</p>
          <p className="text-ink-2 text-sm">{job.problemDescription}</p>
          {job.notes ? <p className="text-muted text-sm italic">“{job.notes}”</p> : null}
        </section>

        {/* Money */}
        <section className="grid gap-3">
          <div className="flex items-baseline justify-between">
            <p className="text-muted text-[11px] font-bold uppercase tracking-[0.14em]">
              {job.revisedQuote != null ? 'Revised price' : 'Quote'}
            </p>
            <p className="font-display tabular text-ink text-xl font-extrabold">
              {price != null ? formatGBP(price) : 'On diagnosis'}
            </p>
          </div>
          {job.revisedQuote != null && job.quotedPrice != null ? (
            <p className="text-muted -mt-2 text-right text-xs">
              originally {formatGBP(job.quotedPrice)}
            </p>
          ) : null}
        </section>

        <PartsPanel job={job} />
        <PaymentsPanel job={job} />

        {/*
          Pipeline — where it is, NOT a control (moves happen on the board).
          Sits last on purpose: it's reference information, while everything
          above it is either something staff act on (take a payment, fit a
          part) or something they need to read out to a customer on the
          phone. It used to open the sheet and pushed all of that below the
          fold.
        */}
        <section className="border-line border-t pt-4">
          <p className="text-muted mb-2 text-[11px] font-bold uppercase tracking-[0.14em]">
            Pipeline
          </p>
          <div className="grid grid-cols-3 gap-1">
            {JOB_PIPELINE.map((status, i) => {
              const activeIndex = JOB_PIPELINE.indexOf(job.status);
              const reached = activeIndex >= 0 && i <= activeIndex;
              return (
                <span
                  key={status}
                  className={cn(
                    'rounded-md px-1 py-2 text-center text-[10px] font-bold uppercase leading-tight tracking-[0.02em]',
                    reached
                      ? i === activeIndex
                        ? 'bg-red text-white'
                        : 'bg-red-tint text-red-deep'
                      : 'bg-paper-2 text-muted',
                  )}
                >
                  {jobStatusLabel(status)}
                </span>
              );
            })}
          </div>
          <p className="text-muted mt-1.5 text-[11px]">
            Move it from the board. A move has to carry its evidence.
          </p>
        </section>
      </div>

      <footer className="border-line bg-card sticky bottom-0 grid gap-2 border-t px-5 py-4">
        {/*
          Goes to the Brother label printer via the queue. `dedupeKey` is the
          job id, so re-opening the sheet and pressing again does not produce a
          second sticker for the same device — though a duplicate label is only
          wasted roll, unlike a duplicate receipt.
        */}
        <PrintButton
          kind="job_label"
          entityId={job.id}
          dedupeKey={`job-label-${job.id}`}
          label="Print device label"
          className="w-full"
        />
        {/*
          Browser fallback. Kept until the agent is proven on the shop's real
          hardware — see HANDOVER-PRINTING.md §9.6. Prints `JobLabel` below via
          the `.print-area` rules.
        */}
        <Button variant="ghost" size="sm" className="w-full" onClick={() => window.print()}>
          <Printer aria-hidden="true" />
          Print via browser (fallback)
        </Button>
      </footer>

      <JobLabel job={job} />
    </>
  );
}

/* ---- parts ----------------------------------------------------------------- */

/**
 * Parts come off the SAME stock the shop sells from. Adding one here is a stock
 * movement, not a note — the shelf count on the inventory screen drops the
 * moment it's fitted, so the counter can't sell a screen that's already in
 * someone's phone.
 *
 * The cost shown is the cost recorded AT THE MOMENT OF FITTING. Repricing the
 * product tomorrow leaves these figures exactly where they are, which is the
 * only way an old job's margin stays true.
 */
function PartsPanel({ job }: { job: Job }) {
  const { data: parts, isPending } = useJobParts(job.id);
  const { data: products } = useAdminProducts();
  const addPart = useAddJobPart(job.id);

  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');

  const total = (parts ?? []).reduce((sum, p) => sum + p.unitCost * p.quantity, 0);
  const nameFor = (id: string | null) =>
    (id ? products?.find((p) => p.id === id)?.name : null) ?? 'Part';

  const add = () => {
    const qty = Number(quantity);
    if (!productId || !Number.isInteger(qty) || qty < 1) return;
    addPart.mutate({ productId, quantity: qty }, { onSuccess: () => setProductId('') });
  };

  return (
    <section className="grid gap-2">
      <div className="flex items-baseline justify-between">
        <p className="text-muted text-[11px] font-bold uppercase tracking-[0.14em]">Parts fitted</p>
        <p className="tabular text-ink text-sm font-bold">{formatGBP(total)}</p>
      </div>

      {isPending ? (
        <p className="text-muted text-xs">Loading…</p>
      ) : (parts ?? []).length === 0 ? (
        <p className="text-muted text-xs">Nothing fitted yet.</p>
      ) : (
        <ul className="border-line bg-card divide-line divide-y rounded-lg border">
          {parts!.map((part) => (
            <li key={part.id} className="flex items-baseline justify-between gap-2 px-3 py-2">
              <span className="text-ink text-sm font-semibold">
                {nameFor(part.productId)}
                {part.quantity > 1 ? <span className="text-muted"> ×{part.quantity}</span> : null}
              </span>
              <span className="tabular text-ink-2 text-sm" title="Cost when it was fitted">
                {formatGBP(part.unitCost * part.quantity)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {job.status === 'collected' || job.status === 'sent_back' || job.status === 'cancelled' ? (
        <p className="text-muted text-[11px]">The job is closed — parts can’t be added.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-[1fr_72px_auto] sm:items-end">
          <Field label="Add a part" htmlFor="part-product">
            <Select
              id="part-product"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              <option value="">Choose…</option>
              {(products ?? []).map((p) => (
                <option key={p.id} value={p.id} disabled={p.stockQty < 1}>
                  {p.name} — {p.stockQty} in stock
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Qty" htmlFor="part-qty">
            <Input
              id="part-qty"
              type="number"
              min="1"
              step="1"
              className="tabular"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </Field>
          <Button
            variant="outline"
            onClick={add}
            disabled={!productId || addPart.isPending}
            className="sm:mb-0"
          >
            {addPart.isPending ? 'Fitting…' : 'Fit'}
          </Button>
        </div>
      )}
    </section>
  );
}

/* ---- payments -------------------------------------------------------------- */

/**
 * A deposit is an amount, and it is capped at the job's total.
 *
 * The cap is enforced by the server — only it knows what has already been taken
 * — but the outstanding figure is shown here so staff aren't guessing, and the
 * amount box refuses obvious overshoots before the request goes out.
 */
function PaymentsPanel({ job }: { job: Job }) {
  const record = useRecordJobPayment(job.id);
  const [amount, setAmount] = useState('');
  const [tender, setTender] = useState<'cash' | 'pos1' | 'pos2' | 'transfer'>('cash');
  const [error, setError] = useState<string | null>(null);

  const price = job.revisedQuote ?? job.quotedPrice;
  const taken = job.depositAmount ?? 0;
  const outstanding = price != null ? price - taken : null;

  const submit = () => {
    setError(null);
    const value = Number(amount);
    if (!amount.trim() || !Number.isFinite(value) || value <= 0) {
      setError('Enter an amount.');
      return;
    }
    const pence = pounds(value);
    if (outstanding != null && pence > outstanding) {
      setError(`That’s more than the ${formatGBP(outstanding)} outstanding.`);
      return;
    }
    record.mutate(
      // Anything that doesn't clear the balance is a deposit; the payment that
      // does is the balance. The server derives payment_status from the total
      // either way — this only labels the row.
      {
        kind: outstanding != null && pence >= outstanding ? 'balance' : 'deposit',
        amount: pence,
        tender,
      },
      { onSuccess: () => setAmount('') },
    );
  };

  return (
    <section className="grid gap-2">
      <div className="flex items-baseline justify-between">
        <p className="text-muted text-[11px] font-bold uppercase tracking-[0.14em]">Paid</p>
        <p className="tabular text-ink text-sm font-bold">{formatGBP(taken)}</p>
      </div>
      {outstanding != null ? (
        <div className="flex items-baseline justify-between">
          <p className="text-muted text-[11px] font-bold uppercase tracking-[0.14em]">
            Outstanding
          </p>
          <p className="tabular text-ink text-sm font-bold">{formatGBP(outstanding)}</p>
        </div>
      ) : (
        <p className="text-muted text-xs">
          No price is set yet, so nothing can be checked against a total.
        </p>
      )}

      {outstanding != null && outstanding <= 0 ? (
        <p className="text-success text-xs font-semibold">Paid in full.</p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="Take payment (£)" htmlFor="pay-amount">
              <Input
                id="pay-amount"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                className="tabular"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label="Taken as" htmlFor="pay-tender">
              <Select
                id="pay-tender"
                value={tender}
                onChange={(e) => setTender(e.target.value as typeof tender)}
              >
                <option value="cash">Cash</option>
                <option value="pos1">Card 1</option>
                <option value="pos2">Card 2</option>
                <option value="transfer">Transfer</option>
              </Select>
            </Field>
            <Button variant="outline" onClick={submit} disabled={record.isPending}>
              {record.isPending ? 'Saving…' : 'Record'}
            </Button>
          </div>
          {error ? <p className="text-red text-xs font-semibold">{error}</p> : null}
        </>
      )}

      <p className="text-muted text-[11px]">
        Payment status follows the payments recorded against this job — it isn’t set by hand.
      </p>
    </section>
  );
}
