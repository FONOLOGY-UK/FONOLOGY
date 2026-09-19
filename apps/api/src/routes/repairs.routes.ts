import { supabaseAdmin } from '../lib/supabase.js';
import {
  requireStaff,
  requireCustomer,
  requirePermission,
  blockStaffCheckout,
} from '../middleware/auth.js';
import {
  bookingConvertBodySchema,
  bookingInputBodySchema,
  repairEnquiryBodySchema,
} from '../schemas.js';

import { createRouter } from '../lib/router.js';

export const repairsRouter = createRouter();

/* ---------------------------------------------------------------------- */
/* Catalogue reads — devices, repair types, part tiers, quote               */
/* ---------------------------------------------------------------------- */

repairsRouter.get('/devices', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('devices')
    .select('id, name, brand, price_multiplier')
    .eq('is_active', true)
    .order('name');
  if (error) return res.status(500).json({ error: 'Could not load devices.' });
  return res.json(
    (data ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      brand: d.brand,
      priceMultiplier: d.price_multiplier,
    })),
  );
});

repairsRouter.get('/types', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('repair_types')
    .select(
      'id, name, description, estimate_label, base_price_original, base_price_oem, base_price_copy',
    )
    .eq('is_active', true)
    .order('name');
  if (error) return res.status(500).json({ error: 'Could not load repair types.' });
  return res.json(
    (data ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      desc: r.description ?? '',
      time: r.estimate_label ?? '',
      // Diagnosis-only types (water damage, data recovery) have all three
      // base prices null (repair_types_all_or_no_pricing) — base is null,
      // never a partially-filled object.
      base:
        r.base_price_original === null
          ? null
          : { original: r.base_price_original, oem: r.base_price_oem, copy: r.base_price_copy },
    })),
  );
});

repairsRouter.get('/tiers', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('repair_part_tiers')
    .select('id, name, strap_line, warranty_label')
    .order('sort_order');
  if (error) return res.status(500).json({ error: 'Could not load part tiers.' });
  return res.json(
    (data ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      strap: t.strap_line ?? '',
      // No second description column exists on repair_part_tiers — see the
      // B5 report. Honest empty, not fabricated.
      line: '',
      warranty: t.warranty_label,
    })),
  );
});

repairsRouter.get('/quote', async (req, res) => {
  const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : null;
  const repairId = typeof req.query.repairId === 'string' ? req.query.repairId : null;
  const tierId = typeof req.query.tierId === 'string' ? req.query.tierId : null;
  if (!deviceId || !repairId || !tierId) {
    return res.status(400).json({ error: 'deviceId, repairId and tierId are all required.' });
  }

  const [{ data: price, error: priceErr }, { data: tier }, { data: repairType }] =
    await Promise.all([
      supabaseAdmin.rpc('repair_quote_price', {
        p_repair_type_id: repairId,
        p_device_id: deviceId,
        p_tier: tierId,
      }),
      supabaseAdmin
        .from('repair_part_tiers')
        .select('warranty_label')
        .eq('id', tierId)
        .maybeSingle(),
      supabaseAdmin.from('repair_types').select('estimate_label').eq('id', repairId).maybeSingle(),
    ]);
  if (priceErr) return res.status(400).json({ error: priceErr.message });

  return res.json({
    deviceId,
    repairId,
    tierId,
    // Never client-supplied — repair_quote_price() computes base x
    // multiplier server-side; diagnosis-only types return null here exactly
    // because the DB function's base_price columns are null for them.
    price,
    warranty: tier?.warranty_label ?? '',
    estTime: repairType?.estimate_label ?? '',
  });
});

/* ---------------------------------------------------------------------- */
/* Mail-in booking                                                          */
/* ---------------------------------------------------------------------- */

repairsRouter.post('/bookings', blockStaffCheckout('book a repair'), async (req, res) => {
  const parsed = bookingInputBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  // Price is computed server-side, from the schema's own function — never
  // trusted from the client, exactly like the quote read above.
  let quotedPrice: number | null = null;
  if (body.tierId) {
    const { data: price, error: priceErr } = await supabaseAdmin.rpc('repair_quote_price', {
      p_repair_type_id: body.repairId,
      p_device_id: body.deviceId,
      p_tier: body.tierId,
    });
    if (priceErr) return res.status(400).json({ error: priceErr.message });
    quotedPrice = price;
  }

  // Round 5 Phase 3 #22 — attributed to the signed-in customer's account
  // when there is one, exactly like orders.routes.ts's create-order path;
  // null (a guest booking) otherwise. Never required — mail-in repair
  // booking has never needed an account (BUSINESS RULE) and still doesn't.
  const customerId = req.user?.kind === 'customer' ? req.user.id : null;

  const { data: row, error } = await supabaseAdmin
    .from('bookings')
    .insert({
      device_id: body.deviceId,
      repair_type_id: body.repairId,
      tier: body.tierId,
      quoted_price: quotedPrice,
      customer_id: customerId,
      customer_name: body.name,
      phone: body.phone,
      email: body.email,
      address_line1: body.address,
      postcode: body.postcode,
      preferred_contact: body.preferredContact,
      notes: body.notes ?? null,
    })
    .select('*')
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json(toApiBooking(row));
});

function toApiBooking(row: Record<string, unknown>) {
  return {
    id: row.id,
    reference: row.reference,
    deviceId: row.device_id,
    repairId: row.repair_type_id,
    tierId: row.tier,
    name: row.customer_name,
    phone: row.phone,
    email: row.email,
    address: row.address_line1,
    postcode: row.postcode,
    preferredContact: row.preferred_contact,
    notes: row.notes,
    // hyphenated to match the frontend's bookingStatusSchema — the only
    // naming difference from booking_status; the five values are otherwise
    // identical, unlike jobs/sell-requests (see the B5 report).
    status: (row.status as string).replace('_', '-'),
    price: row.quoted_price,
    createdAt: row.created_at,
  };
}

/** Admin: all bookings — same gating precedent as GET /orders (requireStaff only). */
repairsRouter.get('/bookings', requireStaff, async (_req, res) => {
  const { data: rows, error } = await supabaseAdmin
    .from('bookings')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Could not load bookings.' });
  return res.json((rows ?? []).map(toApiBooking));
});

/**
 * Round 5 Phase 3 #22 — the signed-in customer's own repair booking
 * history, for the account dashboard. Self-scoped the same way
 * GET /orders/mine is; registered before /bookings/:reference so "mine"
 * is never swallowed as a reference lookup.
 */
repairsRouter.get('/bookings/mine', requireCustomer, async (req, res) => {
  const { data: rows, error } = await supabaseAdmin
    .from('bookings')
    .select('*')
    .eq('customer_id', req.user!.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Could not load your repair bookings.' });
  return res.json((rows ?? []).map(toApiBooking));
});

/** Guest read-back: reference + email, same primitive as B1's /guest/resolve. */
repairsRouter.get('/bookings/:reference', async (req, res) => {
  const reference = (req.params.reference ?? '').trim().toUpperCase();
  const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : null;

  const { data: row } = await supabaseAdmin
    .from('bookings')
    .select('*')
    .eq('reference', reference)
    .maybeSingle();
  if (!row || !email || (row.email as string).trim().toLowerCase() !== email) {
    return res.json(null);
  }
  return res.json(toApiBooking(row));
});

/* ---------------------------------------------------------------------- */
/* "My model isn't listed" — an enquiry, not a fake device row              */
/* ---------------------------------------------------------------------- */

/**
 * Change request item 2 — which details each repair type needs collecting at
 * intake, for the "Send to Jobs" pop-up.
 *
 * DELIBERATELY NOT ON GET /repair/types, which is the PUBLIC endpoint the
 * storefront's repair wizard reads. Two reasons, and the first one bit
 * during verification: adding the column to that select made the whole
 * public endpoint 500 on a database without 0088, taking the customer-facing
 * booking flow down rather than just the new feature. The second is that a
 * customer has no business knowing what the shop collects at the bench.
 *
 * Returned as a map keyed by repair type id — one request for the whole
 * lookup, rather than one per row on a list of requests.
 */
repairsRouter.get(
  '/conversion-fields',
  requireStaff,
  requirePermission('jobs.manage'),
  async (_req, res) => {
    const { data, error } = await supabaseAdmin
      .from('repair_types')
      .select('id, conversion_required_fields');
    if (error) {
      return res.status(500).json({ error: 'Could not load the intake requirements.' });
    }
    const out: Record<string, string[]> = {};
    for (const row of data ?? []) {
      out[row.id as string] = (row.conversion_required_fields as string[] | null) ?? ['quote'];
    }
    return res.json(out);
  },
);

/**
 * Change request item 2 — turn a repair request into a bench job.
 *
 * Everything the customer already told us is carried across by
 * convert_booking_to_job(); this endpoint only supplies the details the
 * request could not contain, and only the ones that repair type is
 * configured to require. Staff re-keying a name and a phone number off a
 * screen the customer filled in was the whole complaint.
 *
 * One transaction in the function, deliberately: a job created against a
 * request still showing as unclaimed is how the same device gets booked onto
 * the bench twice.
 *
 * Numbering needed nothing — bookings and jobs have had independent
 * issue_reference() sequences since 0006. The job number appears on the
 * request through the existing jobs.booking_id link, not a new column.
 */
repairsRouter.post(
  '/bookings/:id/convert',
  requireStaff,
  requirePermission('jobs.manage'),
  async (req, res) => {
    const parsed = bookingConvertBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

    const { data: jobId, error } = await supabaseAdmin.rpc('convert_booking_to_job', {
      p_booking_id: req.params.id,
      // From the session, never the body — same rule as every other staff
      // attribution here.
      p_staff_id: req.user!.id,
      p_quoted_price: parsed.data.quotedPrice ?? null,
      p_intake_details: parsed.data.intakeDetails ?? {},
    });
    // Every guard in the function raises with a sentence already written for
    // a person ("already on the bench", "a quote is required", "missing
    // required detail: passcode"), so there is nothing to reword.
    if (error) return res.status(409).json({ error: error.message });

    const { data: job } = await supabaseAdmin
      .from('jobs')
      .select('id, reference')
      .eq('id', jobId)
      .maybeSingle();
    if (!job) return res.status(500).json({ error: 'Converted, but could not load the new job.' });
    return res.status(201).json({ id: job.id, reference: job.reference });
  },
);

repairsRouter.post('/enquiries', async (req, res) => {
  const parsed = repairEnquiryBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  const { data: row, error } = await supabaseAdmin
    .from('repair_enquiries')
    .insert({
      customer_name: body.customerName,
      phone: body.phone ?? null,
      email: body.email ?? null,
      device_description: body.deviceDescription,
      fault_description: body.faultDescription,
    })
    .select('*')
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json({
    id: row.id,
    customerName: row.customer_name,
    phone: row.phone,
    email: row.email,
    deviceDescription: row.device_description,
    faultDescription: row.fault_description,
    status: row.status,
    createdAt: row.created_at,
  });
});

/** Staff: list enquiries (follow-up queue). */
repairsRouter.get('/enquiries', requireStaff, async (_req, res) => {
  const { data } = await supabaseAdmin
    .from('repair_enquiries')
    .select('*')
    .order('created_at', { ascending: false });
  return res.json(data ?? []);
});
