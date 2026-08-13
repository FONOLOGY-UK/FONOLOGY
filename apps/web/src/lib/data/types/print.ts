import { z } from 'zod';
import { isoDateTimeSchema } from './common';

/**
 * The print queue and the agents that drain it (migration 0033).
 *
 * WRITTEN AGAINST apps/api/src/routes/print.routes.ts — the response builders,
 * not the table columns. The rows are snake_case in Postgres and camelCase on
 * the wire, and several fields here are computed by the server and exist in no
 * table at all (`health`, `shopOpen`, `secondsSinceSeen`, `requestedByName`).
 */

/* ==========================================================================
 * Jobs
 * ======================================================================== */

export const printJobKindSchema = z.enum([
  'sale_receipt',
  'refund_receipt',
  'payout_receipt',
  'job_label',
  'shelf_label',
  'test_print',
]);
export type PrintJobKind = z.infer<typeof printJobKindSchema>;

export const printTargetSchema = z.enum(['receipt', 'label']);
export type PrintTarget = z.infer<typeof printTargetSchema>;

/**
 * The state machine from migration 0033.
 *
 * `unconfirmed` is the one that matters and the reason this screen exists: the
 * agent got bytes as far as the printer and then could not confirm the result,
 * so nobody knows whether paper came out. No algorithm can answer that; a
 * person has to look.
 */
export const printJobStatusSchema = z.enum([
  'queued',
  'leased',
  'printed',
  'unconfirmed',
  'failed',
]);
export type PrintJobStatus = z.infer<typeof printJobStatusSchema>;

export const printJobSchema = z.object({
  id: z.string(),
  kind: z.string(),
  target: printTargetSchema,
  status: printJobStatusSchema,
  attempts: z.number().int(),
  maxAttempts: z.number().int(),
  lastError: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  printedAt: isoDateTimeSchema.nullable(),
  requestedBy: z.string().nullable(),
  /** Resolved server-side. The screen never joins staff itself. */
  requestedByName: z.string().nullable(),
});
export type PrintJob = z.infer<typeof printJobSchema>;

/** What a person can say about a job that is waiting on them. */
export const printResolveOutcomeSchema = z.enum(['printed', 'reprint']);
export type PrintResolveOutcome = z.infer<typeof printResolveOutcomeSchema>;

/* ==========================================================================
 * Agents and devices
 * ======================================================================== */

/**
 * Per-printer health, as the agent reports it on each heartbeat.
 *
 * The fake transport deliberately reports `warning` and never `ok`, so a shop
 * accidentally running on the fake printer shows amber rather than a green
 * tick beside a printer that prints nothing.
 */
export const printDeviceStatusSchema = z.enum(['ok', 'warning', 'error']);
export type PrintDeviceStatus = z.infer<typeof printDeviceStatusSchema>;

export const printDeviceSchema = z.object({
  target: printTargetSchema,
  status: printDeviceStatusSchema,
  detail: z.string().nullable(),
  checkedAt: isoDateTimeSchema,
});
export type PrintDevice = z.infer<typeof printDeviceSchema>;

/**
 * Whether the agent itself is alive — computed by the server against the
 * shop's own opening hours.
 *
 * `asleep` is the distinction that makes this screen worth looking at: the same
 * silence means "the shop is shut and the till PC is off" at 3am and "nothing
 * can print and there are customers waiting" at 3pm. Without it the screen
 * shows a red alarm every night and gets ignored by the Saturday it matters.
 */
export const agentHealthSchema = z.enum(['ok', 'stale', 'asleep', 'down', 'never_seen']);
export type AgentHealth = z.infer<typeof agentHealthSchema>;

export const printAgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  isPrimary: z.boolean(),
  lastSeenAt: isoDateTimeSchema.nullable(),
  agentVersion: z.string().nullable(),
  /**
   * Set when two installs shared one token — they report different instance
   * ids against the same row. Without surfacing it the second install is
   * completely invisible, and two agents draining one queue is how a receipt
   * gets printed twice.
   */
  instanceConflictAt: isoDateTimeSchema.nullable(),
  revokedAt: isoDateTimeSchema.nullable(),
  health: agentHealthSchema,
  shopOpen: z.boolean(),
  secondsSinceSeen: z.number().int().nullable(),
  devices: z.array(printDeviceSchema),
});
export type PrintAgent = z.infer<typeof printAgentSchema>;

/* ==========================================================================
 * Enqueue
 * ======================================================================== */

export const printTestVariantSchema = z.enum(['width', 'cut', 'encoding', 'barcode', 'label']);
export type PrintTestVariant = z.infer<typeof printTestVariantSchema>;

export const printEnqueueInputSchema = z.object({
  kind: printJobKindSchema,
  /** The sale / refund / payout / job / product. Never content. */
  entityId: z.string().optional(),
  variant: printTestVariantSchema.optional(),
  /**
   * Makes pressing Print twice a no-op rather than two receipts. The server
   * treats a repeated key as success and returns the existing job.
   */
  dedupeKey: z.string(),
});
export type PrintEnqueueInput = z.infer<typeof printEnqueueInputSchema>;

export const printEnqueueResultSchema = z.object({
  id: z.string(),
  status: printJobStatusSchema,
  duplicate: z.boolean(),
});
export type PrintEnqueueResult = z.infer<typeof printEnqueueResultSchema>;

/* ==========================================================================
 * Display helpers — one place, so two screens cannot word this differently
 * ======================================================================== */

export function printKindLabel(kind: string): string {
  switch (kind) {
    case 'sale_receipt':
      return 'Sale receipt';
    case 'refund_receipt':
      return 'Refund receipt';
    case 'payout_receipt':
      return 'Trade-in receipt';
    case 'job_label':
      return 'Repair label';
    case 'shelf_label':
      return 'Shelf label';
    case 'test_print':
      return 'Test print';
    default:
      // Never invented. An unrecognised kind shows its raw name, which is a
      // question somebody asks rather than a wrong label nobody notices.
      return kind;
  }
}

/**
 * Agent health in words a shop employee can act on.
 *
 * No jargon and no status codes: this is read by someone with a customer
 * waiting who cannot debug anything.
 */
export function agentHealthLabel(agent: { health: AgentHealth; revokedAt: string | null }): {
  text: string;
  tone: 'ok' | 'warn' | 'bad' | 'muted';
} {
  if (agent.revokedAt) return { text: 'Switched off', tone: 'muted' };
  switch (agent.health) {
    case 'ok':
      return { text: 'Connected', tone: 'ok' };
    case 'stale':
      return { text: 'Slow to respond', tone: 'warn' };
    case 'asleep':
      return { text: 'Asleep — shop is closed', tone: 'muted' };
    case 'down':
      return { text: 'Not responding', tone: 'bad' };
    case 'never_seen':
      return { text: 'Never connected', tone: 'bad' };
  }
}

/** "4 minutes ago", for a screen that must not need a second clock. */
export function sinceLabel(seconds: number | null): string {
  if (seconds === null) return 'never';
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
