import { z } from 'zod';
import { emailSchema, idSchema, isoDateTimeSchema, ukPhoneSchema } from './common';
import { moneySchema } from './pricing';

/**
 * Repair jobs — the admin bench pipeline (item 7, Jobs module).
 *
 * A Job is the operational record the shop works from: every device on the
 * bench, whatever door it came through. Walk-ins are created at the counter
 * via "Add job"; mail-in bookings and online orders become jobs when the
 * backend links them (`source` records the door). The customer-facing Booking
 * (mail-in, /track) stays a separate entity — see NOTES.md.
 *
 * Pipeline: new → in-progress → done → collected.
 */

export const jobStatusSchema = z.enum(['new', 'in-progress', 'done', 'collected']);
export type JobStatus = z.infer<typeof jobStatusSchema>;

/** Board column order — the single source for pipeline sequencing. */
export const JOB_PIPELINE: JobStatus[] = ['new', 'in-progress', 'done', 'collected'];

export function jobStatusLabel(status: JobStatus): string {
  switch (status) {
    case 'new':
      return 'New';
    case 'in-progress':
      return 'In progress';
    case 'done':
      return 'Done';
    case 'collected':
      return 'Collected';
  }
}

/** The step after `status`, or null when the job is at the end of the bench. */
export function nextJobStatus(status: JobStatus): JobStatus | null {
  const i = JOB_PIPELINE.indexOf(status);
  const next = JOB_PIPELINE[i + 1];
  return next ?? null;
}

/** Payment state of a job (till vocabulary from the brief). */
export const jobPaymentSchema = z.enum(['unpaid', 'paid-advance', 'paid']);
export type JobPayment = z.infer<typeof jobPaymentSchema>;

export function jobPaymentLabel(payment: JobPayment): string {
  switch (payment) {
    case 'unpaid':
      return 'Unpaid';
    case 'paid-advance':
      return 'Paid in advance';
    case 'paid':
      return 'Paid';
  }
}

/** Which door the job came through. */
export const jobSourceSchema = z.enum(['walk-in', 'mail-in', 'online']);
export type JobSource = z.infer<typeof jobSourceSchema>;

export function jobSourceLabel(source: JobSource): string {
  switch (source) {
    case 'walk-in':
      return 'Walk-in';
    case 'mail-in':
      return 'Mail-in';
    case 'online':
      return 'Online';
  }
}

/**
 * Payload for "Add job" (walk-ins at the counter). `device` is free text —
 * customers bring anything, not just the catalogued repair devices.
 */
export const jobInputSchema = z.object({
  customerName: z.string().trim().min(2, 'Enter the customer name'),
  phone: ukPhoneSchema,
  email: emailSchema.optional(),
  device: z.string().trim().min(2, 'Enter the device'),
  problem: z.string().trim().min(3, 'Describe the problem'),
  notes: z.string().max(1000).optional(),
  /** Agreed price in pence; null = quote after diagnosis. */
  quote: moneySchema.nullable(),
  payment: jobPaymentSchema,
});
export type JobInput = z.infer<typeof jobInputSchema>;

export const jobSchema = jobInputSchema.extend({
  id: idSchema,
  reference: z.string(), // "FNL-1234" — printed on the device label
  status: jobStatusSchema,
  source: jobSourceSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Job = z.infer<typeof jobSchema>;

/** Fields the admin can change after creation (status moves, payment, edits). */
export type JobPatch = Partial<
  Omit<Job, 'id' | 'reference' | 'source' | 'createdAt' | 'updatedAt'>
>;
