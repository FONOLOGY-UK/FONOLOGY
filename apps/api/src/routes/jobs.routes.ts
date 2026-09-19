import { supabaseAdmin } from '../lib/supabase.js';
import { requireStaff, requirePermission } from '../middleware/auth.js';
import { isRangeOverrun, page } from '../lib/pagination.js';
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

export const jobsRouter = createRouter();

/**
 * No adapter/mock wiring in this router — see the B5 report. The frontend's
 * Job/JobStatus/JobPayment/JobSource types (types/job.ts) model a simplified
 * 4-status linear pipeline (new -> in-progress -> done -> collected) that
 * cannot represent the real, client-confirmed lifecycle this schema
 * enforces: waiting_approval (a repair costing more than quoted), cancelled
 * (with a reason and, for mail-in, whether the device is still held), and
 * two different terminal states depending on source (sent_back for mail-in,
 * collected for walk-in/online). Forcing the real 7-status branching machine
 * into the mock's 4-value hyphenated enum isn't a naming difference to
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
    // from the catalogue at all. All three or none (0079's own CHECK).
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
/*
 * `*` rather than the explicit column list this used to carry, and the
 * reason is deployment rather than brevity.
 *
 * PostgREST fails the WHOLE query when a named column does not exist, so the
 * list had to grow in lockstep with every migration that adds one — and if
 * the API reached production before that migration did, the JOBS BOARD went
 * down completely rather than the new feature simply being absent. Verified
 * in the browser: naming 0079's repair_type_id/device_id/part_tier against a
 * database without 0079 left the board showing "The board didn't load".
 *
 * A star select returns whatever the table actually has; toApiJob() reads
 * the new fields with `?? null`, so the board works either side of a
 * migration. Nothing is leaked by widening it — this is a staff-only
 * endpoint behind `jobs.manage`, and `jobs` holds no column a person with
 * that permission cannot already see on the job sheet.
 *
 * (The original note here said a single string literal was needed for
 * supabase-js to infer the row shape at the type level. That is still true,
 * and '*' is still a single string literal.)
 */
const JOB_BOARD_COLUMNS = '*';

/**
 * Board list. Same permission gate as every other job route — `jobs.manage`,
 * checked against the per-person permission set, never against the UI role.
 */
type JobListFilters = {
  status?: string[];
  source?: string;
  search?: string;
};

function jobsSelect(head: boolean) {
  return supabaseAdmin.from('jobs').select(JOB_BOARD_COLUMNS, { count: 'exact', head });
}

/** The filter half of the board query, shared by the page and its count. */
function applyJobFilters<Q extends ReturnType<typeof jobsSelect>>(
  query: Q,
  { status, source, search }: JobListFilters,
): Q {
  let q = query;
  if (status && status.length > 0) {
    q = status.length === 1 ? q.eq('status', status[0]) : q.in('status', status);
  }
  if (source) q = q.eq('source', source);
  if (search) {
    // Same treatment as GET /products: strip the ILIKE wildcards, and commas
    // too — a comma inside .or() would be read as a filter separator and
    // change the query's meaning rather than just its terms.
    const term = search.replace(/[%_,]/g, '');
    if (term) {
      q = q.or(
        `reference.ilike.%${term}%,customer_name.ilike.%${term}%,device_description.ilike.%${term}%`,
      );
    }
  }
  return q;
}

jobsRouter.get('/', requireStaff, requirePermission('jobs.manage'), async (req, res) => {
  const parsed = jobListQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const { status, source, search, sort, limit, offset } = parsed.data;
  const filters: JobListFilters = { status, source, search };

  let query = applyJobFilters(jobsSelect(false), filters);

  if (sort === 'created-asc') query = query.order('created_at', { ascending: true });
  else if (sort === 'updated-desc') query = query.order('updated_at', { ascending: false });
  else query = query.order('created_at', { ascending: false });

  const { data, error, count } = await query.range(offset, offset + limit - 1);

  if (error) {
    // A board paging past the last page is an empty page, not a server error.
    if (isRangeOverrun(error)) {
      const { count: total } = await applyJobFilters(jobsSelect(true), filters);
      return res.json(page([], total, limit, offset));
    }
    return res.status(500).json({ error: 'Could not load jobs.' });
  }

  return res.json(
    page(
      (data ?? []).map((row) => toApiJob(row as Record<string, unknown>)),
      count,
      limit,
      offset,
    ),
  );
});

jobsRouter.post('/', requireStaff, requirePermission('jobs.manage'), async (req, res) => {
  const parsed = jobCreateBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  // BUG-15-followup #10: this used to hard-require a bookingId for every
  // mail-in job (FEATURE-10) — correct for a device that came through the
  // website's /repair mail-in form, but it left no way to log a device that
  // physically arrived by post with no prior booking at all. bookingId stays
  // optional here; `booking_id` on the row is null either way, exactly as it
  // already was for a walk-in.

  // Change request item 6: a staff quote may not go below the shop's own
  // price for the repair that was picked. 0079's trigger is the authority;
  // this is the friendlier refusal a step earlier, naming the figure.
  if (body.quotedPrice != null) {
    const floor = await getQuoteFloor(body);
    if (floor != null && body.quotedPrice < floor) {
      return res.status(409).json({ error: belowFloorMessage(floor, false), floor });
    }
  }

  const { data: row, error } = await supabaseAdmin
    .from('jobs')
    .insert({
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
      // these by 0079's trigger through repair_quote_price() — the same
      // function /admin/repair-pricing prices with — so there is no figure in
      // the request body anyone could lower.
      //
      // Spread only when a repair was actually picked, and that is a
      // deliberate deploy-safety choice rather than tidiness. 0079 must land
      // before this service does (the standing rule in CLAUDE.md), but if the
      // order ever slips, writing `device_id: null` unconditionally makes
      // PostgREST reject EVERY job creation with "could not find the
      // 'device_id' column" — the whole Add Job screen, not just the new
      // path. Verified on dev: with 0079 unapplied, the unconditional version
      // 400s a plain free-text job. This way a mis-ordered deploy costs only
      // catalogue-picked jobs, and it fails loudly on exactly the new feature.
      ...(body.repairTypeId && body.deviceId && body.partTier
        ? {
            repair_type_id: body.repairTypeId,
            device_id: body.deviceId,
            part_tier: body.partTier,
          }
        : {}),
      assigned_staff_id: req.user!.id,
    })
    .select('*')
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json(toApiJob(row));
});

jobsRouter.get('/:id', requireStaff, requirePermission('jobs.manage'), async (req, res) => {
  const { data: row } = await supabaseAdmin
    .from('jobs')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!row) return res.status(404).json({ error: 'Job not found.' });
  return res.json(toApiJob(row));
});

/**
 * The true, live "what does this job still owe" — never jobs.deposit_amount,
 * which freezes once payment_status reaches 'paid' (0006_repairs.sql:483-486)
 * and can understate the real total from then on. See lib/jobPayments.ts.
 *
 * The payments panel reads this instead of the job's own (possibly stale)
 * depositAmount field; POST /:id/payments below uses the same helper to
 * decide how much of a cash over-tender to actually record. One source of
 * truth for both, not two calculations that can disagree.
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
  // 0078's jobs_validate_unpaid_handover is the load-bearing version of this —
  // it refuses the UPDATE whatever issues it. This is the friendlier one, a
  // step earlier, so the person at the counter gets a sentence with the figure
  // in it instead of a raised exception forwarded as a 409.
  //
  // Both exemptions are the trigger's, kept deliberately identical: a job that
  // was never quoted has no figure to check against (blank = on diagnosis is a
  // real state), and posting back a CANCELLED mail-in owes nothing — the
  // repair never happened, and any deposit goes back through create_refund().
  if (body.status === 'collected' || body.status === 'sent_back') {
    const { data: current } = await supabaseAdmin
      .from('jobs')
      .select('status')
      .eq('id', req.params.id)
      .maybeSingle();

    if (current && current.status !== 'cancelled') {
      const info = await getJobOutstanding(req.params.id!);
      if (info && info.outstanding !== null && info.outstanding > 0) {
        const owed = (info.outstanding / 100).toFixed(2);
        const verb = body.status === 'collected' ? 'collected' : 'posted back';
        return res.status(409).json({
          error: `${info.reference} still owes £${owed}. Take the remaining payment before marking it ${verb}.`,
          outstanding: info.outstanding,
          target: info.target,
          paidTotal: info.paidTotal,
        });
      }
    }
  }

  const { data: row, error } = await supabaseAdmin
    .from('jobs')
    .update(patch)
    .eq('id', req.params.id)
    .select('*')
    .maybeSingle();

  if (error) return res.status(409).json({ error: error.message });
  if (!row) return res.status(404).json({ error: 'Job not found.' });
  return res.json(toApiJob(row));
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

  const { data: partId, error } = await supabaseAdmin.rpc('add_job_part', {
    p_job_id: req.params.id,
    p_product_id: body.productId,
    p_quantity: body.quantity,
    p_staff_id: req.user!.id,
  });
  if (error) return res.status(409).json({ error: error.message });

  const { data: row } = await supabaseAdmin.from('job_parts').select('*').eq('id', partId).single();
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
  const { data } = await supabaseAdmin.from('job_parts').select('*').eq('job_id', req.params.id);
  return res.json(
    (data ?? []).map((row) => ({
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
 * cleanly here, never re-derived, for every tender except one:
 *
 * Cash over-tender (client decision, batch 2 item B): the shop takes the
 * money and gives change. Card/transfer stay capped exactly at outstanding
 * — you cannot give change against a card, so those tenders are passed
 * through unchanged and record_job_payment()'s own cap is still what
 * refuses them, precisely as before this change.
 *
 * For cash, `body.amount` is what the customer TENDERED, not necessarily
 * what gets recorded. It is clamped to the live outstanding figure
 * (lib/jobPayments.ts — the same helper GET /:id/outstanding uses, so the
 * clamp and the panel's own display can never disagree) before
 * record_job_payment ever sees it; changeDue is the difference.
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

    const isCash = body.tender === 'cash';
    let amountToRecord = body.amount;

    if (isCash) {
      if (info.outstanding == null || info.outstanding <= 0) {
        return res.status(409).json({ error: 'Nothing is outstanding on this job.' });
      }
      amountToRecord = Math.min(body.amount, info.outstanding);
    }

    const { data: paymentId, error } = await supabaseAdmin.rpc('record_job_payment', {
      p_job_id: req.params.id,
      p_kind: body.kind,
      p_amount: amountToRecord,
      p_tender: body.tender,
      p_staff_id: req.user!.id,
    });

    if (error) {
      if (isCash) {
        // amountToRecord was already clamped to what getJobOutstanding()
        // said was owed a moment ago. If record_job_payment still refused
        // it, the true outstanding shrank in the gap between that read and
        // this write — another payment landed on this job in between. That
        // is staleness, not an overrun, and the generic "would take the job
        // to £X, more than its £Y price" wording would be actively
        // misleading here, since clamping was specifically meant to make
        // that message impossible. Its own case, its own message.
        return res.status(409).json({
          error:
            'Another payment landed on this job just now, so the amount due has changed. Reload and try again.',
        });
      }
      // Non-cash: the normal, expected overrun (or, much more rarely, the
      // same race on a card/transfer amount typed to match the panel
      // exactly) — built from data this handler already has in `info`,
      // never from error.message.
      return res.status(409).json({
        error: formatJobPaymentOverrun({
          reference: info.reference,
          attempted: body.amount,
          newTotal: info.paidTotal + body.amount,
          target: info.target ?? 0,
        }),
      });
    }

    const { data: row } = await supabaseAdmin
      .from('job_payments')
      .select('*')
      .eq('id', paymentId)
      .single();

    // Derived from row.amount — what the database actually has — not from
    // the local amountToRecord variable computed before the insert. Same
    // number today (record_job_payment never adjusts the amount it's
    // given, only accepts or rejects it whole), but the response should
    // say what's true in the database, not repeat an earlier guess.
    const changeDue = isCash ? body.amount - (row.amount as number) : 0;

    return res.status(201).json({
      id: row.id,
      jobId: row.job_id,
      kind: row.kind,
      amount: row.amount,
      tender: row.tender,
      staffId: row.staff_id,
      at: row.at,
      changeDue,
    });
  },
);
