import { db, sql } from '../../lib/db.js';
import { requireStaff, requireUnlocked, requirePermission } from '../../middleware/auth.js';
import { jobTillPaymentBodySchema } from '../../schemas.js';
import { getJobOutstanding } from '../../lib/jobPayments.js';
import { formatJobPaymentOverrun } from '../../lib/friendlyDbErrors.js';
import { createRouter } from '../../lib/router.js';
import { canWrite } from '../../lib/shopScope.js';

export const posJobPaymentsRouter = createRouter();
const router = posJobPaymentsRouter;

/* ---------------------------------------------------------------------- */
/* Taking money for a repair at the till                                    */
/* ---------------------------------------------------------------------- */

/**
 * A repair payment goes through the same checkout as a sale: the counter picks a job, the till
 * opens with it as the ticket, and the customer pays by cash, card, transfer or any split of
 * them — with the card-limit check, the slip reference and the unlock rules every till payment
 * has. This is where that ticket lands.
 *
 * It records one job payment per tender portion in a single transaction (so a refused card limit
 * on the second portion takes the first back with it), with the kind worked out cumulatively:
 * anything short of the price is a deposit, the payment that reaches it is the balance. The
 * server decides the amounts' legality (not over what the job is owed); the browser only
 * proposes them.
 *
 * The older \`POST /jobs/:id/payments\` is left for direct API use; the screens no longer call it.
 */
router.post(
  '/job-payments',
  requireStaff,
  requireUnlocked,
  requirePermission('pos.operate'),
  requirePermission('jobs.manage'),
  async (req, res) => {
    const parsed = jobTillPaymentBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const { jobId, payments } = parsed.data;

    const job = await db
      .selectFrom('jobs')
      .select(['id', 'shop_id', 'reference', 'status'])
      .where('id', '=', jobId)
      .executeTakeFirst();
    if (!job || !canWrite(req, job.shop_id)) {
      return res.status(404).json({ error: 'Job not found.' });
    }
    if (job.status === 'cancelled') {
      return res
        .status(409)
        .json({ error: `${job.reference} was cancelled, so it takes no payment.` });
    }

    const info = await getJobOutstanding(jobId);
    if (!info) return res.status(404).json({ error: 'Job not found.' });
    if (info.target == null || info.outstanding == null) {
      return res.status(409).json({
        error: `${info.reference} has no price yet, so there is nothing to take payment against.`,
      });
    }
    if (info.outstanding <= 0) {
      return res.status(409).json({ error: `${info.reference} is already paid in full.` });
    }
    const total = payments.reduce((sum, p) => sum + p.amount, 0);
    if (total > info.outstanding) {
      return res.status(409).json({
        error: formatJobPaymentOverrun({
          reference: info.reference,
          attempted: total,
          newTotal: info.paidTotal + total,
          target: info.target,
        }),
      });
    }

    try {
      await db.transaction().execute(async (trx) => {
        let running = info.paidTotal;
        for (const p of payments) {
          running += p.amount;
          await sql`
            select public.record_job_payment(
              p_job_id => ${jobId}::uuid,
              p_kind => ${running >= info.target! ? 'balance' : 'deposit'},
              p_amount => ${p.amount}::integer,
              p_tender => ${p.tender}::tender_method,
              p_staff_id => ${req.user!.id}::uuid
            )`.execute(trx);
        }
      });
    } catch (err) {
      // The card-limit trigger raises a sentence written for the counter; everything else
      // (a staff/job shop mismatch, a race past the cap) is equally a refusal with nothing taken.
      const message = err instanceof Error ? err.message : 'Could not record the payment.';
      return res.status(409).json({ error: message });
    }

    const after = await getJobOutstanding(jobId);
    return res.status(201).json({
      jobId,
      reference: info.reference,
      paid: total,
      paidTotal: after?.paidTotal ?? info.paidTotal + total,
      outstanding: after?.outstanding ?? info.outstanding - total,
      payments: payments.map((p) => ({ tender: p.tender, amount: p.amount })),
    });
  },
);
