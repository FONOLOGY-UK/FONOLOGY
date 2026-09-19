import { supabaseAdmin } from './supabase.js';

/**
 * The true, live state of what a job owes — shared by two callers that must
 * never disagree with each other or with the database:
 *
 *   - GET /jobs/:id/outstanding (jobs.routes.ts), which the payments panel
 *     reads instead of the stale `jobs.deposit_amount` column.
 *   - POST /jobs/:id/payments (jobs.routes.ts), which clamps a cash
 *     over-tender to this same figure before ever calling record_job_payment.
 *
 * Deliberately not a SQL function/view — two plain queries, computed the
 * same way record_job_payment() itself computes v_target/v_paid_total
 * (0006_repairs.sql:438-442), just read-only and one layer up. No migration
 * needed for either caller.
 *
 * `deposit_amount` is NOT used here. It freezes once a job reaches
 * `payment_status = 'paid'` (0006_repairs.sql:483-486, deliberate — see that
 * comment) and can understate the true total from then on. That staleness is
 * exactly the bug this function exists to stop reproducing.
 */
export interface JobOutstanding {
  reference: string;
  /** coalesce(revised_quote, quoted_price, null) — null means no quote yet. */
  target: number | null;
  /** Live sum(job_payments.amount) for this job — never the frozen column. */
  paidTotal: number;
  /** target - paidTotal, or null when target is null (nothing to check against). */
  outstanding: number | null;
}

export async function getJobOutstanding(jobId: string): Promise<JobOutstanding | null> {
  const { data: job } = await supabaseAdmin
    .from('jobs')
    .select('reference, quoted_price, revised_quote')
    .eq('id', jobId)
    .maybeSingle();
  if (!job) return null;

  const { data: payments } = await supabaseAdmin
    .from('job_payments')
    .select('amount')
    .eq('job_id', jobId);
  const paidTotal = (payments ?? []).reduce((sum, p) => sum + (p.amount as number), 0);

  const target = (job.revised_quote ?? job.quoted_price ?? null) as number | null;

  return {
    reference: job.reference as string,
    target,
    paidTotal,
    outstanding: target == null ? null : target - paidTotal,
  };
}
