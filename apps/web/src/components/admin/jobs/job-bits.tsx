'use client';

import { Mail, Store } from 'lucide-react';
import type { Job, JobPayment, JobStatus } from '@/lib/data/types';
import { isMailIn, jobPaymentLabel, jobSourceLabel, jobStatusLabel } from '@/lib/data/types';
import { StatusChip, type ChipTone } from '@/components/admin/status-chip';

/** Shared chip mappings so the board, table and sheet all speak identically. */

const STATUS_TONE: Record<JobStatus, ChipTone> = {
  new: 'accent',
  in_progress: 'ink',
  // Blocked, not in flight — the shop is waiting on the customer, and the
  // colour has to say so or another technician picks the device up by mistake.
  waiting_approval: 'warning',
  done: 'success',
  sent_back: 'neutral',
  collected: 'neutral',
  cancelled: 'neutral',
};

const PAYMENT_TONE: Record<JobPayment, ChipTone> = {
  unpaid: 'warning',
  deposit_paid: 'accent',
  paid: 'success',
};

export function JobStatusChip({ status }: { status: JobStatus }) {
  return <StatusChip tone={STATUS_TONE[status]}>{jobStatusLabel(status)}</StatusChip>;
}

export function JobPaymentChip({ payment }: { payment: JobPayment }) {
  return <StatusChip tone={PAYMENT_TONE[payment]}>{jobPaymentLabel(payment)}</StatusChip>;
}

/**
 * How the device leaves — shown at EVERY stage, not only at the end.
 *
 * Staff have to be able to tell at a glance whether a device goes back in the
 * post or is handed over at the counter, because it changes what they do with
 * it: a mail-in needs packing and a tracking number, a walk-in needs someone
 * phoned. Getting that wrong means a customer's phone sitting on a shelf
 * waiting for a collection that was never going to happen.
 */
export function JobSourceChip({ job }: { job: Job }) {
  if (isMailIn(job.source)) {
    return (
      <StatusChip tone="accent">
        <Mail className="mr-1 inline size-3" aria-hidden="true" />
        Mail-in, posts back
      </StatusChip>
    );
  }
  return (
    <StatusChip tone="neutral">
      <Store className="mr-1 inline size-3" aria-hidden="true" />
      {jobSourceLabel(job.source)}, collected
    </StatusChip>
  );
}

/** "2h ago" / "3d ago" for bench age. */
export function jobAge(iso: string): string {
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
