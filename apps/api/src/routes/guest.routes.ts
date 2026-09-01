import { supabaseAdmin } from '../lib/supabase.js';
import { clientIp } from '../lib/clientIp.js';
import { isRateLimited } from '../lib/rateLimit.js';
import { guestResolveQuerySchema } from '../schemas.js';

import { createRouter } from '../lib/router.js';

export const guestRouter = createRouter();

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
 *
 * Rate limited on the same terms as the other two unauthenticated
 * reference lookups (order-lookup, sell-lookup): 10 per IP per 10 minutes.
 * Independent audit finding HIGH-04 — this route was the one lookup of the
 * three that never got it. The email pairing means this is not open
 * enumeration, but it does answer "does this person have anything with the
 * shop" for a KNOWN email against a sequential, guessable reference space,
 * and sweeping that space was free.
 */
guestRouter.get('/resolve', async (req, res) => {
  if (
    isRateLimited(`guest-resolve:${clientIp(req) ?? 'unknown'}`, { max: 10, windowMs: 10 * 60_000 })
  ) {
    return res.status(429).json({ error: 'Too many lookups — please try again in a few minutes.' });
  }

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
