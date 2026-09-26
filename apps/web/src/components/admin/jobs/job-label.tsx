'use client';

import type { Job, JobSource } from '@/lib/data/types';
import { formatGBP } from '@/lib/data/types';
import { encodeCode39 } from '@/lib/barcode';

/**
 * Change request item 1, kept identical to the print agent's own
 * `jobSourceLine()` (apps/print-agent/src/render/label.ts). Two renderers of
 * the same ticket that word it differently is how a bench ends up believing
 * the browser copy and the roll copy are different documents.
 *
 * `online` is not a guess: isMailIn() already returns false for it, so an
 * online job can only ever reach `collected` — handed over in the shop.
 */
function jobSourceLine(source: JobSource): string {
  switch (source) {
    case 'mail_in':
      return 'MAIL-IN — POST BACK';
    case 'walk_in':
      return 'WALK-IN — COLLECT IN SHOP';
    case 'online':
      return 'ONLINE — COLLECT IN SHOP';
  }
}

/**
 * Printable device label for a bench job. Hidden on screen inside the job
 * panel; `window.print()` + the `.print-label` rules in admin.css put ONLY
 * this on paper. The Code 39 barcode is real — a USB scanner reads the ref.
 */
export function JobLabel({ job }: { job: Job }) {
  return (
    <div className="print-area border-line hidden w-[340px] border bg-white p-4 text-black print:block">
      <div className="flex items-baseline justify-between">
        <span className="font-display text-sm font-extrabold uppercase">Fonology.</span>
        <span className="tabular text-[11px]">
          {new Date(job.createdAt).toLocaleDateString('en-GB')}
        </span>
      </div>
      <p className="font-display tabular my-1 text-3xl font-extrabold leading-none tracking-tight">
        {job.reference}
      </p>
      <Code39 value={job.reference} />
      <div className="mt-2 grid gap-0.5 text-[12px] leading-snug">
        <p className="font-bold">
          {job.customerName}
          {job.phone ? ` · ${job.phone}` : ' · No phone on file'}
        </p>
        {/* Item 1: can this be handed to whoever is at the counter? Above the
            device, because that question is asked while it's being picked off
            the shelf. */}
        <p className="text-[11px] font-extrabold tracking-wide">{jobSourceLine(job.source)}</p>
        <p>{job.deviceDescription}</p>
        <p className="text-[11px]">{job.problemDescription}</p>
        <p className="text-[11px] font-bold">
          {job.quotedPrice != null ? formatGBP(job.quotedPrice) : 'Quote on diagnosis'} —{' '}
          {/* deposit_paid means money is STILL OWED. This once read "PAID IN
              ADVANCE" — on a shelf label, the one wording that gets a device
              handed back without the balance. Matches the print agent's
              "Deposit paid" (render/label.ts). */}
          {job.paymentStatus === 'paid'
            ? 'PAID'
            : job.paymentStatus === 'deposit_paid'
              ? 'DEPOSIT PAID — BALANCE DUE'
              : 'UNPAID'}
        </p>
        {/* Item 1: the job note, in full. No truncation here either — a sheet
            of A4 has room, and a clipped "battery swollen, do not charge" is
            worse than a slightly taller label. */}
        {job.notes?.trim() ? (
          <div className="mt-1 border-t border-black/40 pt-1">
            <p className="text-[9px] font-bold tracking-wide">NOTE</p>
            <p className="whitespace-pre-wrap text-[11px]">{job.notes.trim()}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Code39({ value, height = 34 }: { value: string; height?: number }) {
  const { bars, totalWidth } = encodeCode39(value);
  return (
    <svg
      viewBox={`0 0 ${totalWidth} ${height}`}
      preserveAspectRatio="none"
      className="h-[34px] w-full"
      role="img"
      aria-label={`Barcode ${value}`}
    >
      {bars.map((bar, i) => (
        <rect key={i} x={bar.x} y={0} width={bar.width} height={height} fill="#000" />
      ))}
    </svg>
  );
}
