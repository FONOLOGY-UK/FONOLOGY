'use client';

import { RotateCw } from 'lucide-react';
import { useJobSms, useResendJobSms, useSetJobSmsUpdates } from '@/lib/data/hooks';
import type { Job, JobSms } from '@/lib/data/types';
import { jobStatusLabel } from '@/lib/data/types';
import { formatDateTime } from '@/lib/dates';
import { Button } from '@/components/ui/button';
import { StatusChip } from '@/components/admin/status-chip';

/**
 * Texts to the customer for this job (0105): whether they're being texted, every text tried —
 * sent, failed, or not sent and why — and a resend for the current stage.
 */
export function JobTextsPanel({ job }: { job: Job }) {
  const { data: history, isPending } = useJobSms(job.id);
  const resend = useResendJobSms(job.id);
  const toggle = useSetJobSmsUpdates(job.id);
  const on = job.smsUpdates !== false;

  return (
    <section className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted text-[11px] font-bold uppercase tracking-[0.14em]">Texts</p>
        <div className="flex items-center gap-2">
          <label className="text-ink flex items-center gap-1.5 text-xs font-semibold">
            <input
              type="checkbox"
              className="size-3.5 accent-[var(--red)]"
              checked={on}
              disabled={toggle.isPending}
              onChange={(e) => toggle.mutate(e.target.checked)}
            />
            Text the customer
          </label>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            disabled={resend.isPending || !on}
            onClick={() => resend.mutate()}
          >
            <RotateCw className="size-3" aria-hidden="true" />
            Resend
          </Button>
        </div>
      </div>
      {isPending ? (
        <p className="text-muted text-xs">Loading…</p>
      ) : (history ?? []).length === 0 ? (
        <p className="text-muted text-xs">No texts yet.</p>
      ) : (
        <ul className="border-line bg-card divide-line divide-y rounded-lg border">
          {history!.slice(0, 8).map((sms) => (
            <li key={sms.id} className="grid gap-0.5 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-ink text-xs font-semibold">{jobStatusLabel(sms.status)}</span>
                <span className="flex items-center gap-1.5">
                  <SmsState sms={sms} />
                  <span className="text-muted tabular text-[11px]">
                    {formatDateTime(sms.createdAt)}
                  </span>
                </span>
              </div>
              {sms.body ? <p className="text-ink-2 text-xs">{sms.body}</p> : null}
              {sms.state !== 'sent' && sms.reason ? (
                <p className="text-muted text-[11px]">{sms.reason}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SmsState({ sms }: { sms: JobSms }) {
  if (sms.state === 'sent') return <StatusChip tone="success">Sent</StatusChip>;
  if (sms.state === 'failed') return <StatusChip tone="danger">Failed</StatusChip>;
  return <StatusChip tone="neutral">Not sent</StatusChip>;
}
