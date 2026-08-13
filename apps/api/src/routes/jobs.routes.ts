import { supabaseAdmin } from '../lib/supabase.js';
import { requireStaff, requirePermission } from '../middleware/auth.js';
import { isRangeOverrun, page } from '../lib/pagination.js';
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
    cancellationReason: row.cancellation_reason,
    deviceReturned: row.device_returned,
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
// One string literal, not a concatenation: supabase-js parses this at the type
// level to infer the row shape, and it can't follow a `+` chain.
// prettier-ignore
const JOB_BOARD_COLUMNS = 'id, reference, source, booking_id, order_id, customer_name, phone, email, device_description, problem_description, notes, status, payment_status, quoted_price, deposit_amount, revised_quote, revised_quote_approved_by, revised_quote_approved_at, return_tracking_number, cancellation_reason, device_returned, assigned_staff_id, created_at, updated_at';

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

  if (body.source === 'mail_in' && !body.bookingId) {
    return res.status(400).json({ error: 'A mail-in job must link to its booking.' });
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
    patch.return_tracking_number = body.returnTrackingNumber;
  }

  if (body.status === 'cancelled') {
    if (!body.cancellationReason) {
      return res.status(400).json({ error: 'A cancellation reason is required.' });
    }
    patch.cancellation_reason = body.cancellationReason;
    if (body.deviceReturned !== undefined) patch.device_returned = body.deviceReturned;
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
 * cleanly here, never re-derived.
 */
jobsRouter.post(
  '/:id/payments',
  requireStaff,
  requirePermission('jobs.manage'),
  async (req, res) => {
    const parsed = jobPaymentBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    const { data: paymentId, error } = await supabaseAdmin.rpc('record_job_payment', {
      p_job_id: req.params.id,
      p_kind: body.kind,
      p_amount: body.amount,
      p_tender: body.tender,
      p_staff_id: req.user!.id,
    });
    if (error) return res.status(409).json({ error: error.message });

    const { data: row } = await supabaseAdmin
      .from('job_payments')
      .select('*')
      .eq('id', paymentId)
      .single();
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
