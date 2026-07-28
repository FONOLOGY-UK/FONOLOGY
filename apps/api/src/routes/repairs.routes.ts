import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireStaff } from '../middleware/auth.js';
import { bookingInputBodySchema, repairEnquiryBodySchema } from '../schemas.js';

export const repairsRouter = Router();

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

repairsRouter.post('/bookings', async (req, res) => {
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

  const { data: row, error } = await supabaseAdmin
    .from('bookings')
    .insert({
      device_id: body.deviceId,
      repair_type_id: body.repairId,
      tier: body.tierId,
      quoted_price: quotedPrice,
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
