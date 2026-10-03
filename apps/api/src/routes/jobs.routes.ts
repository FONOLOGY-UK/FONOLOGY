import type { SelectQueryBuilder } from 'kysely';
import { attempt, db, rpc, sql } from '../lib/db.js';
import type { DB, JobSource, JobStatus } from '../db/types.js';
import { isUuid } from '../lib/uuid.js';
import { formatPence } from '../lib/money.js';
import { requireStaff, requirePermission } from '../middleware/auth.js';
import { page } from '../lib/pagination.js';
import { getJobOutstanding } from '../lib/jobPayments.js';
import { formatJobPaymentOverrun } from '../lib/friendlyDbErrors.js';
import { belowFloorMessage, getJobQuoteFloor, getQuoteFloor } from '../lib/jobQuoteFloor.js';
import {
  jobCreateBodySchema,
  jobStatusBodySchema,
  jobPartBodySchema,
  jobPaymentBodySchema,
  jobListQuerySchema,
} from '../schemas.js';

import { createRouter } from '../lib/router.js';
import { canRead, canWrite, readShop, writeShop } from '../lib/shopScope.js';

export const jobsRouter = createRouter();

/**
 * The frontend's
 * Job/JobStatus/JobPayment/JobSource types (types/job.ts) model a simplified
 * 4-status linear pipeline (new -> in-progress -> done -> collected) that
 * cannot represent the real, client-confirmed lifecycle this schema
 * enforces: waiting_approval (a repair costing more than quoted), cancelled
 * (with a reason and, for mail-in, whether the device is still held), and
 * two different terminal states depending on source (sent_back for mail-in,
 * collected for walk-in/online). Forcing the real 7-status branching machine
 * into a 4-value hyphenated enum isn't a naming difference to
 * paper over (like Booking's status was) — the states themselves don't
 * exist on the other side. Built here to match the schema exactly, proven
 * directly against dev.
 */

function toApiJob(row: Record<string, unknown>) {
  return {
    id: row.id,
    reference: row.reference,
    source: row.source,
    bookingId: row.booking_id,
    orderId: row.order_id,
    customerName: row.customer_name,
    phone: row.phone,
    email: row.email,
    deviceDescription: row.device_description,
    problemDescription: row.problem_description,
    notes: row.notes,
    status: row.status,
    paymentStatus: row.payment_status,
    quotedPrice: row.quoted_price,
    depositAmount: row.deposit_amount,
    revisedQuote: row.revised_quote,
    revisedQuoteApprovedBy: row.revised_quote_approved_by,
    revisedQuoteApprovedAt: row.revised_quote_approved_at,
    returnTrackingNumber: row.return_tracking_number,
    courier: row.courier,
    cancellationReason: row.cancellation_reason,
    deviceReturned: row.device_returned,
    // Change request item 6 — which catalogue repair this is, when it came
    // from the catalogue at all. All three or none (0082's own CHECK).
    repairTypeId: row.repair_type_id ?? null,
    deviceId: row.device_id ?? null,
    partTier: row.part_tier ?? null,
    assignedStaffId: row.assigned_staff_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The jobs row and nothing else — no parts, payments, booking or order joins.
 * A board card needs the device, the customer, where it is in the pipeline and
 * the mail-in marker; pulling each job's related records to render a column of
 * cards would be one query per card for data the card never shows.
 */
/**
 * Board list. Same permission gate as every other job route — `jobs.manage`,
 * checked against the per-person permission set, never against the UI role.
 */
type JobListFilters = {
  status?: string[];
  source?: string;
  search?: string;
  shopId?: string | null;
};

/** The filter half of the board query, shared by the page and its count. */
function applyJobFilters<O>(
  query: SelectQueryBuilder<DB, 'jobs', O>,
  { status, source, search, shopId }: JobListFilters,
): SelectQueryBuilder<DB, 'jobs', O> {
  let q = query;
  if (shopId) q = q.where('shop_id', '=', shopId);
  if (status && status.length > 0) q = q.where('status', 'in', status as JobStatus[]);
  if (source) q = q.where('source', '=', source as JobSource);
  if (search) {
    // Strip the ILIKE wildcards so a search term is only ever a literal
    // substring (commas too, as they were once filter separators here).
    const term = search.replace(/[%_,]/g, '');
    if (term) {
      const like = `%${term}%`;
      q = q.where((eb) =>
        eb.or([
          eb('reference', 'ilike', like),
          eb('customer_name', 'ilike', like),
          eb('device_description', 'ilike', like),
        ]),
      );
    }
  }
  return q;
}

/**
 * Every /jobs/:id/... route acts on one job, which belongs to one shop (where it was taken in).
 * Reading needs read access to that shop, anything else write access; a job outside the
 * caller's reach reads as not found. The database refuses cross-shop payments and parts too
 * (record_job_payment, add_job_part) — this is the layer that gives the friendly answer.
 */
jobsRouter.use('/:id', async (req, res, next) => {
  if (!req.user || req.user.kind !== 'staff' || !isUuid(req.params.id)) return next();
  const job = await db
    .selectFrom('jobs')
    .select('shop_id')
    .where('id', '=', req.params.id)
    .executeTakeFirst();
  if (!job) return next();
  const allowed = req.method === 'GET' ? canRead(req, job.shop_id) : canWrite(req, job.shop_id);
  if (!allowed) return res.status(404).json({ error: 'Job not found.' });
  next();
});

jobsRouter.get('/', requireStaff, requirePermission('jobs.manage'), async (req, res) => {
  const parsed = jobListQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const { status, source, search, sort, limit, offset } = parsed.data;
  const filters: JobListFilters = { status, source, search, shopId: readShop(req) };

  let query = applyJobFilters(db.selectFrom('jobs').selectAll(), filters);

  if (sort === 'created-asc') query = query.orderBy('created_at', 'asc');
  else if (sort === 'updated-desc') query = query.orderBy('updated_at', 'desc');
  else query = query.orderBy('created_at', 'desc');

  // The page and the total come from the same filters; a page past the end is
  // simply empty, with the real total.
  const { data, error } = await attempt(() =>
    Promise.all([
      query.limit(limit).offset(offset).execute(),
      applyJobFilters(
        db.selectFrom('jobs').select((eb) => eb.fn.countAll<number>().as('count')),
        filters,
      ).executeTakeFirstOrThrow(),
    ]),
  );
  if (error) return res.status(500).json({ error: 'Could not load jobs.' });

  const [rows, { count }] = data;
  return res.json(page(rows.map(toApiJob), count, limit, offset));
});

jobsRouter.post('/', requireStaff, requirePermission('jobs.manage'), async (req, res) => {
  const parsed = jobCreateBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;
  const shopId = await writeShop(req, res);
  if (!shopId) return;

  // BUG-15-followup #10: this used to hard-require a bookingId for every
  // mail-in job (FEATURE-10) — correct for a device that came through the
  // website's /repair mail-in form, but it left no way to log a device that
  // physically arrived by post with no prior booking at all. bookingId stays
  // optional here; `booking_id` on the row is null either way, exactly as it
  // already was for a walk-in.

  // Change request item 6: a staff quote may not go below the shop's own
  // price for the repair that was picked. 0082's trigger is the authority;
  // this is the friendlier refusal a step earlier, naming the figure.
  if (body.quotedPrice != null) {
    const floor = await getQuoteFloor(body);
    if (floor != null && body.quotedPrice < floor) {
      return res.status(409).json({ error: belowFloorMessage(floor, false), floor });
    }
  }

  const { data: row, error } = await attempt(() =>
    db
      .insertInto('jobs')
      .values({
        shop_id: shopId,
        source: body.source,
        booking_id: body.bookingId ?? null,
        order_id: body.orderId ?? null,
        customer_name: body.customerName,
        phone: body.phone ?? null,
        email: body.email ?? null,
        device_description: body.deviceDescription,
        problem_description: body.problemDescription,
        notes: body.notes ?? null,
        // Staff-set quote, exactly like the ground rules require — never
        // derived, never client-computed; just recorded as given by whoever
        // is looking at the device.
        quoted_price: body.quotedPrice ?? null,
        // Item 6: the SELECTION, never a price. The floor is recomputed from
        // these by 0082's trigger through repair_quote_price() — the same
        // function /admin/repair-pricing prices with — so there is no figure in
        // the request body anyone could lower.
        //
        // Spread only when a repair was actually picked, and that is a
        // deliberate deploy-safety choice rather than tidiness. 0082 must land
        // before this service does (the standing rule in CLAUDE.md), but if the
        // order ever slips, writing `device_id: null` unconditionally makes
        // PostgREST reject EVERY job creation with "could not find the
        // 'device_id' column" — the whole Add Job screen, not just the new
        // path. Verified on dev: with 0082 unapplied, the unconditional version
        // 400s a plain free-text job. This way a mis-ordered deploy costs only
        // catalogue-picked jobs, and it fails loudly on exactly the new feature.
        // (Still true in spirit: the insert only names what it has.)
        ...(body.repairTypeId && body.deviceId && body.partTier
          ? {
              repair_type_id: body.repairTypeId,
              device_id: body.deviceId,
              part_tier: body.partTier,
            }
          : {}),
        assigned_staff_id: req.user!.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),
  );

  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json(toApiJob(row));
});

jobsRouter.get('/:id', requireStaff, requirePermission('jobs.manage'), async (req, res) => {
  const jobId = req.params.id ?? '';
  const row = isUuid(jobId)
    ? await db.selectFrom('jobs').selectAll().where('id', '=', jobId).executeTakeFirst()
    : undefined;
  if (!row) return res.status(404).json({ error: 'Job not found.' });
  return res.json(toApiJob(row));
});

/**
 * The true, live "what does this job still owe" — never jobs.deposit_amount,
 * which freezes once payment_status reaches 'paid' (0006_repairs.sql:483-486)
 * and can understate the real total from then on. See lib/jobPayments.ts.
 *
 * The payments panel reads this instead of the job's own (possibly stale)
 * depositAmount field; POST /:id/payments below uses the same helper to word
 * its refusal when an amount would overshoot. One source of truth for both,
 * not two calculations that can disagree.
 */
jobsRouter.get(
  '/:id/outstanding',
  requireStaff,
  requirePermission('jobs.manage'),
  async (req, res) => {
    const info = await getJobOutstanding(req.params.id!);
    if (!info) return res.status(404).json({ error: 'Job not found.' });
    return res.json(info);
  },
);

/**
 * Every status move goes through one UPDATE, and the schema's own
 * validate_job_status_transition trigger is what actually enforces the
 * whole state machine (legal moves, waiting_approval requiring a revised
 * quote, sent_back requiring mail-in + tracking, cancelled requiring a
 * reason and, for mail-in, a device-held answer). This route only shapes
 * the update payload from the request; it never re-implements the guard.
 */
jobsRouter.post('/:id/status', requireStaff, requirePermission('jobs.manage'), async (req, res) => {
  const parsed = jobStatusBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  const patch: Record<string, unknown> = { status: body.status };

  if (body.status === 'waiting_approval') {
    if (body.revisedQuote === undefined) {
      return res
        .status(400)
        .json({ error: 'A revised quote is required to move a job to waiting_approval.' });
    }
    // Item 6, the second place a low quote could get in. A revision is
    // normally a cost overrun going UP, so this rarely bites — but a floor
    // enforced only on creation is bypassed in two clicks: create at the
    // floor, then "revise" to £5.
    const floor = await getJobQuoteFloor(req.params.id!);
    if (floor != null && body.revisedQuote < floor) {
      return res.status(409).json({ error: belowFloorMessage(floor, true), floor });
    }
    patch.revised_quote = body.revisedQuote;
  }

  if (body.status === 'in_progress' && body.approved) {
    // Leaving waiting_approval — record who approved the revised quote and
    // when, exactly what the trigger requires before it allows this move.
    patch.revised_quote_approved_by = req.user!.id;
    patch.revised_quote_approved_at = new Date().toISOString();
  }

  if (body.status === 'sent_back') {
    if (!body.returnTrackingNumber) {
      return res
        .status(400)
        .json({ error: 'A return tracking number is required to send a job back.' });
    }
    // Round 3 #2.2/#2.4: required for every move to sent_back, including a
    // cancelled job now being posted back (0051 relaxed the DB transition
    // for exactly that case) — the trigger enforces this too, this is just
    // the friendlier 400 ahead of it.
    if (!body.courier) {
      return res.status(400).json({ error: 'A courier name is required to send a job back.' });
    }
    patch.return_tracking_number = body.returnTrackingNumber;
    patch.courier = body.courier;
  }

  if (body.status === 'cancelled') {
    if (!body.cancellationReason) {
      return res.status(400).json({ error: 'A cancellation reason is required.' });
    }
    patch.cancellation_reason = body.cancellationReason;
    if (body.deviceReturned !== undefined) patch.device_returned = body.deviceReturned;
  }

  // Change request item 14: the device does not leave with money still owed.
  //
  // 0081's jobs_validate_unpaid_handover is the load-bearing version of this —
  // it refuses the UPDATE whatever issues it. This is the friendlier one, a
  // step earlier, so the person at the counter gets a sentence with the figure
  // in it instead of a raised exception forwarded as a 409.
  //
  // Both exemptions are the trigger's, kept deliberately identical: a job that
  // was never quoted has no figure to check against (blank = on diagnosis is a
  // real state), and posting back a CANCELLED mail-in owes nothing — the
  // repair never happened, and any deposit goes back through create_refund().
  if (body.status === 'collected' || body.status === 'sent_back') {
    const current = isUuid(req.params.id)
      ? await db
          .selectFrom('jobs')
          .select('status')
          .where('id', '=', req.params.id)
          .executeTakeFirst()
      : undefined;

    if (current && current.status !== 'cancelled') {
      const info = await getJobOutstanding(req.params.id!);
      if (info && info.outstanding !== null && info.outstanding > 0) {
        const verb = body.status === 'collected' ? 'collected' : 'posted back';
        return res.status(409).json({
          error: `${info.reference} still owes ${formatPence(info.outstanding)}. Take the remaining payment before marking it ${verb}.`,
          outstanding: info.outstanding,
          target: info.target,
          paidTotal: info.paidTotal,
        });
      }
    }
  }

  // Cancelling a job gives back what the customer paid, in the same transaction as the status
  // move — so a job can never read "cancelled" while its money still sits in the day's takings,
  // and a refused move (the status trigger says no) refunds nothing. One refund per payment
  // method, recorded as a normal job refund: it nets the original payment out of that day's
  // revenue and out of the drawer's expected cash. (Before the day is closed that is all a "void"
  // needs to be; after it, it is the same refund, dated today.)
  const refundOnCancel = body.status === 'cancelled' && body.refundPayments !== false;
  const jobId = req.params.id ?? '';
  const refunded: { reference: string; tender: string; amount: number }[] = [];

  const { data: row, error } = await attempt(() =>
    db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('jobs')
        .set(patch)
        .where('id', '=', jobId)
        .returningAll()
        .executeTakeFirst();
      if (!updated || !refundOnCancel) return updated;

      const [paid, back] = await Promise.all([
        trx
          .selectFrom('job_payments')
          .select((eb) => ['tender', eb.fn.sum<number>('amount').as('amount')])
          .where('job_id', '=', jobId)
          .groupBy('tender')
          .execute(),
        trx
          .selectFrom('refunds')
          .select((eb) => ['refund_tender as tender', eb.fn.sum<number>('amount').as('amount')])
          .where('job_id', '=', jobId)
          .groupBy('refund_tender')
          .execute(),
      ]);
      const returned = new Map(back.map((b) => [b.tender, Number(b.amount)]));
      for (const p of paid) {
        const due = Number(p.amount) - (returned.get(p.tender) ?? 0);
        if (due <= 0) continue;
        const made = await sql<{ id: string }>`
          select public.create_refund(
            p_staff_id => ${req.user!.id}::uuid,
            p_amount => ${due}::integer,
            p_refund_tender => ${p.tender}::tender_method,
            p_reason => ${`Job cancelled: ${body.cancellationReason}`},
            p_job_id => ${jobId}::uuid,
            p_original_tender => ${p.tender}::tender_method
          ) as id`.execute(trx);
        const refund = await trx
          .selectFrom('refunds')
          .select('reference')
          .where('id', '=', made.rows[0]!.id)
          .executeTakeFirstOrThrow();
        refunded.push({ reference: refund.reference, tender: p.tender, amount: due });
      }
      return updated;
    }),
  );

  if (error) return res.status(409).json({ error: error.message });
  if (!row) return res.status(404).json({ error: 'Job not found.' });
  // `refunds`: what must now be handed back, per payment method — the screen tells the counter.
  return res.json({ ...toApiJob(row), refunds: refunded });
});

/**
 * Consumes stock the moment the part is fitted — add_job_part() calls
 * stock_consume(kind 'repair_part') and snapshots products.cost_price into
 * job_parts.unit_cost in the same call. That snapshot is what makes a later
 * cost change on the product not rewrite this job's recorded figure.
 */
jobsRouter.post('/:id/parts', requireStaff, requirePermission('jobs.manage'), async (req, res) => {
  const parsed = jobPartBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  const { data: partId, error } = await attempt(() =>
    rpc<string>('add_job_part', {
      p_job_id: req.params.id,
      p_product_id: body.productId,
      p_quantity: body.quantity,
      p_staff_id: req.user!.id,
    }),
  );
  if (error) return res.status(409).json({ error: error.message });

  const row = await db
    .selectFrom('job_parts')
    .selectAll()
    .where('id', '=', partId)
    .executeTakeFirstOrThrow();
  return res.status(201).json({
    id: row.id,
    jobId: row.job_id,
    productId: row.product_id,
    quantity: row.quantity,
    unitCost: row.unit_cost,
    stockMovementId: row.stock_movement_id,
    addedBy: row.added_by,
    addedAt: row.added_at,
  });
});

jobsRouter.get('/:id/parts', requireStaff, requirePermission('jobs.manage'), async (req, res) => {
  const jobId = req.params.id ?? '';
  const data = isUuid(jobId)
    ? await db.selectFrom('job_parts').selectAll().where('job_id', '=', jobId).execute()
    : [];
  return res.json(
    data.map((row) => ({
      id: row.id,
      jobId: row.job_id,
      productId: row.product_id,
      quantity: row.quantity,
      unitCost: row.unit_cost,
      stockMovementId: row.stock_movement_id,
      addedBy: row.added_by,
      addedAt: row.added_at,
    })),
  );
});

/**
 * record_job_payment() enforces the deposit-not-over-price cap itself
 * (raises when cumulative payments would exceed the job's price) — surfaced
 * cleanly here, never re-derived, for every tender without exception.
 *
 * `body.amount` is the amount being RECORDED against the job, for every
 * tender including cash. The system deliberately has no notion of change:
 * whatever cash actually changes hands across the counter is the counter's
 * business, and the only figure this records is what the job was paid.
 * An amount over what's outstanding is a mistake, not an over-tender, and
 * is refused here exactly as it always was — there is nothing to clamp and
 * nothing to hand back.
 *
 * `getJobOutstanding` is still read first, but only to build the refusal
 * message from figures this handler holds itself rather than from
 * error.message. It never changes what gets recorded.
 */
jobsRouter.post(
  '/:id/payments',
  requireStaff,
  requirePermission('jobs.manage'),
  async (req, res) => {
    const parsed = jobPaymentBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    const info = await getJobOutstanding(req.params.id!);
    if (!info) return res.status(404).json({ error: 'Job not found.' });

    const { data: paymentId, error } = await attempt(() =>
      rpc<string>('record_job_payment', {
        p_job_id: req.params.id,
        p_kind: body.kind,
        p_amount: body.amount,
        p_tender: body.tender,
        p_staff_id: req.user!.id,
      }),
    );

    if (error) {
      // The expected overrun — the amount would take cumulative payments
      // past the job's price. Built from data this handler already has in
      // `info`, never from error.message.
      return res.status(409).json({
        error: formatJobPaymentOverrun({
          reference: info.reference,
          attempted: body.amount,
          newTotal: info.paidTotal + body.amount,
          target: info.target ?? 0,
        }),
      });
    }

    const row = await db
      .selectFrom('job_payments')
      .selectAll()
      .where('id', '=', paymentId)
      .executeTakeFirstOrThrow();

    return res.status(201).json({
      id: row.id,
      jobId: row.job_id,
      kind: row.kind,
      amount: row.amount,
      tender: row.tender,
      staffId: row.staff_id,
      at: row.at,
    });
  },
);
