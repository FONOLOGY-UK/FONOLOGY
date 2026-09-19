import { supabaseAdmin } from './supabase.js';

/**
 * Print-queue retention and lease housekeeping.
 *
 * Deliberately shaped like documentRetention.ts, because the same reasoning
 * applies: the SQL function decides WHAT is safe to remove and the TypeScript
 * decides HOW and writes the audit entry. There is one code path, used by both
 * the scheduled script and any manual trigger, so a "scheduled" behaviour can
 * never drift from what actually runs.
 *
 * WHY THIS MATTERS BEYOND HOUSEKEEPING
 * A queued job label carries a customer's name and phone number. That makes
 * this a retention obligation, not a disk-space chore, which is why the
 * default window is 7 days rather than a year. It is safe to be that short
 * precisely because a reprint for a return re-renders from the sale — never
 * from this queue.
 */

export interface PrintPurgeResult {
  deleted: number;
  failed: number;
}

/**
 * Delete every terminal print job past the retention window.
 *
 * The SQL function returns only `printed` and `failed` rows — a job that is
 * queued, leased or unconfirmed is never returned regardless of age, because
 * an unconfirmed job is a question waiting on a person and deleting it loses
 * the question.
 */
export async function purgeExpiredPrintJobs(actorId?: string): Promise<PrintPurgeResult> {
  const { data: due, error } = await supabaseAdmin.rpc('print_jobs_due_for_deletion');
  if (error) throw error;

  const rows = (due ?? []) as { id: string; kind: string; target: string; status: string }[];
  let deleted = 0;
  let failed = 0;

  // One at a time, so a single failure cannot take the batch down with it.
  for (const row of rows) {
    const { error: deleteError } = await supabaseAdmin.from('print_jobs').delete().eq('id', row.id);

    if (deleteError) {
      failed += 1;
      continue;
    }
    deleted += 1;

    // The row is gone; the fact that it existed and was removed is not. Note
    // that no payload is copied into the audit entry — that would defeat the
    // entire point of deleting it.
    await supabaseAdmin.from('audit_log').insert({
      actor_id: actorId ?? null,
      actor_label: actorId ? 'Staff' : 'System (retention)',
      action: 'print_job.purge',
      entity_type: 'print_job',
      entity_id: row.id,
      note: `${row.kind} (${row.target}, ${row.status}) purged past the retention window.`,
    });
  }

  return { deleted, failed };
}

/**
 * Reclaim leases nobody acknowledged.
 *
 * Separate from retention and run far more often. All the interesting logic —
 * receipts to `unconfirmed`, labels requeued while attempts remain — lives in
 * the SQL function so it is one implementation rather than one per caller.
 */
export async function expirePrintLeases(): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc('expire_print_leases');
  if (error) throw error;
  return (data as number | null) ?? 0;
}

/**
 * Give up on jobs that sat queued with no agent to claim them (0090).
 *
 * Distinct from expirePrintLeases(), which is about a job someone DID take
 * and never acknowledged. This is about a job nobody ever took: the till PC
 * was off, and the queue kept it forever because queued is not a terminal
 * state and nothing else ages it.
 *
 * Two things went wrong because of that, and both are fixed by making these
 * rows terminal. The agent claims oldest-first with no age check, so a PC
 * returning after a week printed the entire backlog at once — including sale
 * receipts for days-old sales. And `purgeExpiredPrintJobs()` only ever sees
 * terminal rows, so the customer names and phone numbers on a queued label
 * were held indefinitely against a seven-day policy. Found on dev as nine
 * jobs queued since 22 August, none ever claimed.
 *
 * Retention ages from created_at, so marking a job failed here hands it to
 * purgeExpiredPrintJobs() rather than deleting it. A backlog already older
 * than print_job_retention_days is therefore purged in this same run, which
 * is why the caller runs this BEFORE the purge. A job that goes stale while
 * still inside the retention window is not — it waits out the remainder,
 * which is correct: this changes what retention can SEE, never its timing.
 */
export async function expireStalePrintJobs(): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc('expire_stale_print_jobs');
  if (error) throw error;
  return (data as number | null) ?? 0;
}
