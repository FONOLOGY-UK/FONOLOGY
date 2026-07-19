'use client';

import type { Job } from '@/lib/data/types';
import { formatGBP } from '@/lib/data/types';
import { encodeCode39 } from '@/lib/barcode';

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
          {job.customerName} · {job.phone}
        </p>
        <p>{job.device}</p>
        <p className="text-[11px]">{job.problem}</p>
        <p className="text-[11px] font-bold">
          {job.quote != null ? formatGBP(job.quote) : 'Quote on diagnosis'} —{' '}
          {job.payment === 'paid'
            ? 'PAID'
            : job.payment === 'paid-advance'
              ? 'PAID IN ADVANCE'
              : 'UNPAID'}
        </p>
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
