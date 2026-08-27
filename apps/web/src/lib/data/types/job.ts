import { z } from 'zod';
import { emailSchema, idSchema, isoDateTimeSchema, ukPhoneSchema } from './common';
import { moneySchema } from './pricing';

/**
 * Repair jobs — the admin bench pipeline (item 7, Jobs module).
 *
 * A Job is the operational record the shop works from: every device on the
 * bench, whatever door it came through. Walk-ins are created at the counter via
 * "Add job"; mail-in bookings and online orders become jobs when the backend
 * links them (`source` records the door). The customer-facing Booking (mail-in,
 * /track) stays a separate entity — see NOTES.md.
 *
 * These types now use the API's own `snake_case` enum values verbatim, as
 * decided. The previous hyphenated set could not represent reality:
 *
 *   • `jobStatusSchema` had 4 of the database's 7 — no `waiting_approval`,
 *     `sent_back` or `cancelled`, so a job in any of those states could not be
 *     parsed at all
 *   • `jobPaymentSchema` said `paid-advance` where the database says
 *     `deposit_paid`
 *   • the field names differed (`device`/`problem`/`quote`/`payment` against
 *     `deviceDescription`/`problemDescription`/`quotedPrice`/`paymentStatus`)
 *   • and eight columns had nowhere to go: the revised quote and its approval,
 *     the return tracking number, the cancellation reason, whether the device
 *     was returned, and the booking/order/assigned-staff links
 *
 * Pipeline: new → in_progress → waiting_approval → done → sent_back | collected,
 * with cancelled reachable from anywhere before the end.
 */

export const jobStatusSchema = z.enum([
  'new',
  'in_progress',
  'waiting_approval',
  'done',
  'sent_back',
  'collected',
  'cancelled',
]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

/**
 * Board column order — the single source for pipeline sequencing.
 *
 * `sent_back` and `collected` are NOT columns here (BUG-15-followup #13) —
 * they used to be, and being endings meant the columns only ever grew: a
 * shop a year in had two "columns" that were really just an unbounded
 * history sitting on the live board, all the way to page-load time. A move
 * INTO either still happens exactly the same way — the button lives on a
 * `done` ticket via `nextJobStatuses()`, unrelated to whether the target has
 * its own visible column — the job just leaves the board the moment it
 * lands there instead of piling up on it. `/admin/jobs/archive` is where a
 * finished job actually lives after that. `cancelled` was already off the
 * board entirely (CancelledStrip, not a column) and stays that way — it is
 * not a stage of work, and giving it a column would imply jobs flow into it.
 */
export const JOB_PIPELINE: JobStatus[] = ['new', 'in_progress', 'waiting_approval', 'done'];

/** Finished — no longer active work, but not a stage a job flows into either. Archived, not boarded. */
export const JOB_ARCHIVE_STATUSES: JobStatus[] = ['collected', 'sent_back', 'cancelled'];

/** The status that blocks work: the shop is waiting on the customer, not the bench. */
export const JOB_BLOCKED_STATUS: JobStatus = 'waiting_approval';

/** Terminal states — no work follows them. */
export const JOB_TERMINAL_STATUSES: JobStatus[] = ['sent_back', 'collected', 'cancelled'];

export function jobStatusLabel(status: JobStatus): string {
  switch (status) {
    case 'new':
      return 'New';
    case 'in_progress':
      return 'On the bench';
    case 'waiting_approval':
      return 'Waiting on customer';
    case 'done':
      return 'Done';
    case 'sent_back':
      return 'Posted back';
    case 'collected':
      return 'Collected';
    case 'cancelled':
      return 'Cancelled';
  }
}

/**
 * Short labels for the MOVE buttons on a board card, where the full status
 * name has to share a narrow column with one or two siblings.
 *
 * "Waiting on customer" wrapped to two lines there, making that card taller
 * than every other card in the row — the board looked ragged and the columns
 * stopped lining up. These read as the action the button performs rather than
 * the state it lands in, which is what a button should say anyway.
 *
 * Deliberately separate from `jobStatusLabel`: chips, column headings and the
 * job sheet all still show the full, unambiguous name.
 */
export function jobMoveLabel(status: JobStatus): string {
  switch (status) {
    case 'in_progress':
      return 'Bench';
    case 'waiting_approval':
      return 'Ask customer';
    case 'sent_back':
      return 'Post back';
    default:
      return jobStatusLabel(status);
  }
}

/** Which door the job came through. */
export const jobSourceSchema = z.enum(['walk_in', 'mail_in', 'online']);
export type JobSource = z.infer<typeof jobSourceSchema>;

export function jobSourceLabel(source: JobSource): string {
  switch (source) {
    case 'walk_in':
      return 'Walk-in';
    case 'mail_in':
      return 'Mail-in';
    case 'online':
      return 'Online';
  }
}

/**
 * A mail-in device goes back in the post; anything else is handed over in the
 * shop. Staff need to know which at a glance at every stage, so this is the one
 * predicate the board keys its marker off.
 */
export function isMailIn(source: JobSource): boolean {
  return source === 'mail_in';
}

/**
 * Legal next statuses, narrowed by where the device has to end up.
 *
 * The server enforces this too (the schema's own transition guard), and it is
 * the authority — this exists so the board never offers a button the API will
 * refuse. A mail-in job can only finish at `sent_back`; a walk-in or online job
 * only at `collected`. Offering both would mean half the buttons 409.
 */
export const JOB_STATUS_FLOW: Record<JobStatus, JobStatus[]> = {
  new: ['in_progress', 'cancelled'],
  in_progress: ['waiting_approval', 'done', 'cancelled'],
  // NOT 'done' — the database's own job_status_allowed_next() (0013_schema_gaps.sql)
  // only allows waiting_approval -> in_progress or -> cancelled. A job here has to
  // resume (recording who approved the revised quote) before it can finish; offering
  // 'done' directly from here 409s every time. This exact mismatch is why FNL-10221
  // sat approved-but-stuck for a week in dev — see BUG-07/08/09 investigation.
  waiting_approval: ['in_progress', 'cancelled'],
  done: ['sent_back', 'collected'],
  sent_back: [],
  collected: [],
  // Round 3 #2.4: a cancelled MAIL-IN job can be posted back (0051 relaxed
  // the DB's own job_status_allowed_next to match) — nextJobStatuses below
  // already narrows 'sent_back' to mail-in only, so a cancelled walk-in
  // never sees this as an option. Not 'collected': a cancelled walk-in
  // stays at status 'cancelled' with deviceReturned flipped true instead
  // (BUG-15-followup #12) — no DB transition needed for that one.
  cancelled: ['sent_back'],
};

export function nextJobStatuses(status: JobStatus, source?: JobSource): JobStatus[] {
  const all = JOB_STATUS_FLOW[status];
  if (!source) return all;
  return all.filter((next) => {
    if (next === 'sent_back') return isMailIn(source);
    if (next === 'collected') return !isMailIn(source);
    return true;
  });
}

/** Payment state of a job. `deposit_paid` is the API's word, not "paid-advance". */
export const jobPaymentSchema = z.enum(['unpaid', 'deposit_paid', 'paid']);
export type JobPayment = z.infer<typeof jobPaymentSchema>;

export function jobPaymentLabel(payment: JobPayment): string {
  switch (payment) {
    case 'unpaid':
      return 'Unpaid';
    case 'deposit_paid':
      return 'Deposit paid';
    case 'paid':
      return 'Paid';
  }
}

/**
 * Payload for "Add job" — a walk-in at the counter, or a mail-in linked to an
 * existing booking (FEATURE-10). `deviceDescription` is free text either way —
 * customers bring anything, not just the catalogued repair devices, and even
 * a mail-in job records its own description rather than re-reading the
 * booking's every time.
 */
export const jobInputSchema = z.object({
  /**
   * Which door it came through. `POST /jobs` REQUIRES this — the payload used
   * to omit it entirely, so every "Add job" would have been rejected 400 by the
   * real API while working perfectly in mock mode.
   */
  source: jobSourceSchema,
  /**
   * Required by the API when source is 'mail_in' (it 400s without one) — a
   * mail-in job has to link the real booking it came from, never invent one.
   * Never sent for a walk-in.
   */
  bookingId: idSchema.optional(),
  customerName: z.string().trim().min(2, 'Enter the customer name'),
  phone: ukPhoneSchema,
  email: emailSchema.optional(),
  deviceDescription: z.string().trim().min(2, 'Enter the device'),
  problemDescription: z.string().trim().min(3, 'Describe the problem'),
  notes: z.string().max(1000).optional(),
  /** Agreed price in pence; null = quote after diagnosis. */
  quotedPrice: moneySchema.nullable(),
  /**
   * A deposit is an AMOUNT, not a flag — and can't exceed the job total.
   *
   * `POST /jobs` does not accept it: money is recorded by
   * `POST /jobs/:id/payments`, which is where `record_job_payment()` enforces
   * the cap and derives `payment_status`. The adapter therefore creates the job
   * and then records the deposit, rather than sending a figure the create route
   * would silently drop.
   */
  depositAmount: moneySchema.nullable().optional(),
  /** How the deposit was taken. Asked for, never assumed — see the adapter. */
  depositTender: z.enum(['cash', 'pos1', 'pos2', 'transfer']).optional(),
});
export type JobInput = z.infer<typeof jobInputSchema>;

export const jobSchema = z.object({
  id: idSchema,
  reference: z.string(), // "FNL-1234" — printed on the device label
  source: jobSourceSchema,
  /** Set when the job came from a mail-in booking or an online order. */
  bookingId: idSchema.nullable().optional(),
  orderId: idSchema.nullable().optional(),
  customerName: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  deviceDescription: z.string(),
  problemDescription: z.string(),
  notes: z.string().nullable(),
  status: jobStatusSchema,
  paymentStatus: jobPaymentSchema,
  quotedPrice: moneySchema.nullable(),
  depositAmount: moneySchema.nullable(),
  /**
   * A repair that turned out to cost more than quoted. The job sits at
   * `waiting_approval` until the customer agrees — the approval is recorded
   * with who took it and when, because "the customer said yes" is a claim that
   * needs an owner.
   */
  revisedQuote: moneySchema.nullable(),
  revisedQuoteApprovedBy: idSchema.nullable(),
  revisedQuoteApprovedAt: z.string().nullable(),
  /** Required before a mail-in job can reach `sent_back`. */
  returnTrackingNumber: z.string().nullable(),
  /** Round 3 #2.2: required alongside returnTrackingNumber before `sent_back`. */
  courier: z.string().nullable().optional(),
  /** Required to cancel. */
  cancellationReason: z.string().nullable(),
  /**
   * For a cancelled mail-in job: has the device gone back to the customer?
   * A customer's phone must never be unaccounted for in the system.
   */
  deviceReturned: z.boolean().nullable(),
  assignedStaffId: idSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: z.string().nullable().optional(),
});
export type Job = z.infer<typeof jobSchema>;

/** The paginated envelope `GET /jobs` returns. */
export const jobPageSchema = z.object({
  items: z.array(jobSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
export type JobPage = z.infer<typeof jobPageSchema>;

/** Board filters, read from the URL on the server page and passed down. */
export const jobQuerySchema = z.object({
  status: z.array(jobStatusSchema).optional(),
  source: jobSourceSchema.optional(),
  search: z.string().trim().optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
});
export type JobQuery = z.infer<typeof jobQuerySchema>;

/**
 * A status move, with the evidence that move requires.
 *
 * `sent_back` needs a tracking number; `cancelled` needs a reason, plus — for a
 * mail-in — whether the shop still holds the device. The server refuses without
 * them; these fields exist so the screen can ask rather than let it fail.
 */
export const jobStatusChangeSchema = z.object({
  status: jobStatusSchema,
  /** Required to enter `waiting_approval` — the figure the customer must agree. */
  revisedQuote: moneySchema.nonnegative().optional(),
  /** Set when leaving `waiting_approval`: the server stamps who approved and when. */
  approved: z.boolean().optional(),
  /** Required for `sent_back` (mail-in only), alongside `courier`. */
  returnTrackingNumber: z.string().trim().optional(),
  /** Round 3 #2.2: required alongside returnTrackingNumber for `sent_back`. */
  courier: z.string().trim().optional(),
  /** Required for `cancelled`. */
  cancellationReason: z.string().trim().optional(),
  /**
   * Round 3 #2.3: no longer asked of staff for a mail-in cancellation — the
   * dialog defaults it to `false` itself now, same as it already did for a
   * walk-in (BUG-15-followup #12). Still sent on every cancel either way; the
   * DB's own CHECK constraint (jobs_cancelled_mail_in_resolves_device) still
   * requires it non-null for a cancelled mail-in job.
   */
  deviceReturned: z.boolean().optional(),
});
export type JobStatusChange = z.infer<typeof jobStatusChangeSchema>;

/**
 * A part consumed by a job — the exact shape `GET /jobs/:id/parts` returns.
 *
 * There is no `name`: the row records the product id and the cost, not a label,
 * so the screen resolves the name from the product list rather than pretending
 * the API sends one.
 */
export const jobPartSchema = z.object({
  id: idSchema,
  jobId: idSchema,
  productId: idSchema.nullable(),
  quantity: z.number().int().positive(),
  /**
   * What the part cost the shop when it was fitted, in pence. Frozen: the API
   * snapshots `products.cost_price` inside `add_job_part()`, so a later price
   * change cannot rewrite this job's figure and an old repair's margin doesn't
   * silently move with today's supplier prices.
   */
  unitCost: moneySchema,
  /** The stock movement that took it off the shelf — parts and sales share stock. */
  stockMovementId: idSchema.nullable(),
  addedBy: idSchema.nullable(),
  addedAt: isoDateTimeSchema,
});
export type JobPart = z.infer<typeof jobPartSchema>;

export const jobPartInputSchema = z.object({
  productId: idSchema,
  quantity: z.number().int().positive('At least one'),
});
export type JobPartInput = z.infer<typeof jobPartInputSchema>;

/** A payment against a job — the shape `POST /jobs/:id/payments` returns. */
export const jobPaymentRecordSchema = z.object({
  id: idSchema,
  jobId: idSchema,
  kind: z.enum(['deposit', 'balance']),
  amount: moneySchema,
  tender: z.string(),
  staffId: idSchema.nullable(),
  at: isoDateTimeSchema,
});
export type JobPaymentRecord = z.infer<typeof jobPaymentRecordSchema>;

/**
 * `record_job_payment()` refuses when the cumulative total would exceed the
 * job's price — the cap lives there, not here, because only the server knows
 * what has already been taken.
 */
export const jobPaymentInputSchema = z.object({
  kind: z.enum(['deposit', 'balance']),
  amount: moneySchema.positive('Enter an amount'),
  tender: z.enum(['cash', 'pos1', 'pos2', 'transfer']),
});
export type JobPaymentInput = z.infer<typeof jobPaymentInputSchema>;

/** Fields the admin can change after creation (edits, not status moves). */
export type JobPatch = Partial<
  Omit<Job, 'id' | 'reference' | 'source' | 'createdAt' | 'updatedAt'>
>;
