import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { guestResolveQuerySchema } from '../schemas.js';

export const guestRouter = Router();

type EntityType = 'order' | 'booking' | 'sell_request';

/**
 * Resolves a guest's reference + email to the thing it belongs to, via
 * `reference_registry` — one indexed lookup for the reference, then a
 * single follow-up lookup on whichever table it points at. Only the entity
 * types a guest can actually own are eligible (jobs/sales/trade-in payouts
 * are staff-only records, even if they happen to share the same reference
 * sequence).
 *
 * Always returns 404 for both "no such reference" and "wrong email" — never
 * distinguishing the two in the response, so this endpoint can't be used to
 * probe whether a reference exists.
 */
guestRouter.get('/resolve', async (req, res) => {
  const parsed = guestResolveQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const reference = parsed.data.reference.trim().toUpperCase();
  const email = parsed.data.email.trim().toLowerCase();

  const { data: registryRow } = await supabaseAdmin
    .from('reference_registry')
    .select('entity_type, entity_id')
    .eq('reference', reference)
    .maybeSingle();

  if (!registryRow) return res.status(404).json({ error: 'Not found.' });

  const entityType = registryRow.entity_type as EntityType;
  const entityId = registryRow.entity_id as string;

  let ownerEmail: string | null = null;

  if (entityType === 'order') {
    const { data: order } = await supabaseAdmin
      .from('orders')
      .select('guest_email, customer_id, customers(email)')
      .eq('id', entityId)
      .maybeSingle();
    if (order) {
      ownerEmail =
        (order.guest_email as string | null) ??
        (order.customers as unknown as { email: string } | null)?.email ??
        null;
    }
  } else if (entityType === 'booking') {
    const { data: booking } = await supabaseAdmin
      .from('bookings')
      .select('email')
      .eq('id', entityId)
      .maybeSingle();
    ownerEmail = booking?.email ?? null;
  } else if (entityType === 'sell_request') {
    const { data: sellRequest } = await supabaseAdmin
      .from('sell_requests')
      .select('email')
      .eq('id', entityId)
      .maybeSingle();
    ownerEmail = sellRequest?.email ?? null;
  } else {
    // A real reference, but not a guest-ownable entity (job / sale / trade-in
    // payout) — treat exactly like "not found".
    return res.status(404).json({ error: 'Not found.' });
  }

  if (!ownerEmail || ownerEmail.trim().toLowerCase() !== email) {
    return res.status(404).json({ error: 'Not found.' });
  }

  return res.json({ kind: entityType, id: entityId, reference });
});
