'use client';

import type { Job, JobPayment, JobStatus } from '@/lib/data/types';
import { jobPaymentLabel, jobSourceLabel, jobStatusLabel } from '@/lib/data/types';
import { StatusChip, type ChipTone } from '@/components/admin/status-chip';

/** Shared chip mappings so the board, table and sheet all speak identically. */

const STATUS_TONE: Record<JobStatus, ChipTone> = {
  new: 'accent',
  'in-progress': 'ink',
  done: 'success',
  collected: 'neutral',
};

const PAYMENT_TONE: Record<JobPayment, ChipTone> = {
  unpaid: 'warning',
  'paid-advance': 'accent',
  paid: 'success',
};

export function JobStatusChip({ status }: { status: JobStatus }) {
  return <StatusChip tone={STATUS_TONE[status]}>{jobStatusLabel(status)}</StatusChip>;
}

export function JobPaymentChip({ payment }: { payment: JobPayment }) {
  return <StatusChip tone={PAYMENT_TONE[payment]}>{jobPaymentLabel(payment)}</StatusChip>;
}

export function JobSourceChip({ job }: { job: Job }) {
  if (job.source === 'walk-in') return null; // the default door — not worth a chip
  return <StatusChip tone="neutral">{jobSourceLabel(job.source)}</StatusChip>;
}

/** "2h ago" / "3d ago" for bench age. */
export function jobAge(iso: string): string {
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
