import type { SelectQueryBuilder } from 'kysely';
import type { DB } from '../../db/types.js';
import crypto from 'node:crypto';
import { attempt, db, rpc } from '../../lib/db.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { getStripe, StripeNotConfiguredError } from '../../lib/stripe.js';
import { refundInputBodySchema } from '../../schemas.js';
import { formatRefundCapError } from '../../lib/friendlyDbErrors.js';
import { toApiRefund, toApiRefunds, resolveReference } from './helpers.js';
import { createRouter } from '../../lib/router.js';
import { readShop } from '../../lib/shopScope.js';
import { optionalPaging, pageWithTotals } from '../../lib/pagination.js';

export const posRefundsRouter = createRouter();
const router = posRefundsRouter;

/* ---------------------------------------------------------------------- */
/* Refunds                                                                   */
/* ---------------------------------------------------------------------- */

/**
 * Deterministic idempotency key for a Stripe refund request.
 *
 * There is no internal `refunds` row to key off yet at the point this is
 * needed — Stripe is called BEFORE the ledger write, deliberately (see the
 * route below) — so the key is derived from the request's own identifying
 * fields instead: the order, the amount, the reason text, and who's asking.
 * A genuine retry (a network timeout the browser resends, or a staff
 * double-click before the button disables) resends an identical body and
 * lands on the same key, so Stripe returns the SAME refund object instead
 * of creating a second one.
 *
 * RESOLVED (independent audit finding HIGH-05). The preimage used to be
 * (order, amount, reason, staff) alone, which collided on two DELIBERATE,
 * textually-identical partial refunds of the same order — buy two identical
 * £15 cases, return them on separate visits with the same reason and the
 * same staff member on shift, and the second refund silently handed back
 * the FIRST one's Stripe object without moving any money. The customer was
 * simply out £15 until a human noticed the amount looked short.
 *
 * `alreadyRefundedPence` — what this order had already been refunded when
 * the request arrived — is what separates the two cases, and obtaining it
 * needs no client-minted nonce (the objection that left this unresolved):
 *
 *   * A GENUINE RETRY (a network timeout the browser resends, a staff
 *     double-click) arrives before anything has committed, reads the SAME
 *     total, and hashes identically. Still deduplicated — the property this
 *     key exists for is unchanged.
 *   * A DELIBERATE SECOND REFUND happens after the first one committed, so
 *     it reads a HIGHER total and hashes differently. It now goes through.
 *
 * Remaining edge, unchanged and deliberate: if a refund's Stripe call
 * succeeded but its ledger write failed (the loud reconciliation path in
 * the route below), the already-refunded total does not move, so a
 * subsequent identical refund still collides. That case already requires a
 * human, and colliding is the safe direction while it waits for one.
 */
function refundIdempotencyKey(
  orderId: string,
  amountPence: number,
  reason: string,
  staffId: string,
  alreadyRefundedPence: number,
) {
  return crypto
    .createHash('sha256')
    .update(
      `refund:${orderId}:${amountPence}:${reason.trim().toLowerCase()}:${staffId}:${alreadyRefundedPence}`,
    )
    .digest('hex');
}

router.post('/refunds', requireStaff, requirePermission('returns.manage'), async (req, res) => {
  const parsed = refundInputBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  if (body.source === 'no-receipt') {
    return res.status(400).json({
      error:
        'A refund must reference a sale or an order — there is no link-less "goodwill, no receipt" refund in this system. Use the counter sale or online order reference.',
    });
  }
  if (!body.reference) {
    return res.status(400).json({ error: 'A reference is required.' });
  }

  const entityType = body.source === 'counter' ? 'sale' : 'order';
  const entityId = await resolveReference(body.reference, entityType);
  if (!entityId) {
    return res.status(404).json({ error: `No ${entityType} found for ${body.reference}.` });
  }

  // Compute whether this is genuinely outside the return window — from the
  // real original date and the real setting, never from the client's say-so.
  const settings = await db
    .selectFrom('shop_settings')
    .select('return_window_days')
    .executeTakeFirst();
  const windowDays = settings?.return_window_days ?? 30;

  let originalCreatedAt: string | null = null;
  let originalTender: string | null = null;
  // Only ever populated for entityType === 'order' — see the Stripe-refund
  // block below, which is the only reader.
  let orderPaymentProvider: string | null = null;
  let orderProviderReference: string | null = null;
  if (entityType === 'sale') {
    const sale = await db
      .selectFrom('sales')
      .select('created_at')
      .where('id', '=', entityId)
      .executeTakeFirst();
    originalCreatedAt = sale?.created_at ?? null;
    const firstPayment = await db
      .selectFrom('sale_payments')
      .select('tender')
      .where('sale_id', '=', entityId)
      .orderBy('created_at', 'asc')
      .limit(1)
      .executeTakeFirst();
    originalTender = firstPayment?.tender ?? null;
  } else {
    const order = await db
      .selectFrom('orders')
      .select(['created_at', 'payment_provider', 'provider_reference'])
      .where('id', '=', entityId)
      .executeTakeFirst();
    originalCreatedAt = order?.created_at ?? null;
    orderPaymentProvider = order?.payment_provider ?? null;
    orderProviderReference = order?.provider_reference ?? null;
    // Online orders don't have a tender_method-compatible payment record
    // (Stripe/Clearpay aren't till tenders) — left null rather than guessed.
  }

  const ageDays = originalCreatedAt
    ? (Date.now() - new Date(originalCreatedAt).getTime()) / 86400000
    : Infinity;
  const isOutsideWindow = ageDays > windowDays;

  if (isOutsideWindow && !body.override) {
    return res.status(409).json({
      error: `This sale is outside the ${windowDays}-day return window. Confirm the override to refund it anyway — the authorisation is kept on record.`,
    });
  }
  // Red-team finding #6b (MEDIUM, confirmed — permissions.config.ts's own
  // comment on returns.manage reads "refunds + window overrides", one
  // permission gating both). Anyone with returns.manage can still process
  // an ordinary in-window refund; only actually USING the override now also
  // requires returns.override (0071/0072), separately grantable — checked
  // here, not as route-level middleware, because whether an override is
  // even in play depends on data (the order's age, the setting) this
  // handler has already computed by this point, not on the route alone.
  if (isOutsideWindow && body.override && !req.user!.permissions?.includes('returns.override')) {
    return res.status(403).json({
      error:
        'Missing permission: returns.override — overriding the return window needs separate authorisation from processing an ordinary refund.',
    });
  }

  const pLines = body.lines.map((l) => ({
    product_id: l.productId,
    // Round 5 Phase 4 #16: which variant, when the original line was one —
    // create_refund's restock branch credits the variant's own shelf.
    variant_id: l.variantId ?? null,
    name: l.name,
    quantity: l.quantity,
    unit_price: l.unitPrice,
    restock: body.restock,
  }));

  /**
   * Stripe integration (readiness-audit Group 3).
   *
   * ONLY reachable via an order refund with 'stripe' explicitly chosen as
   * the refund method — every till/cash refund, and a 'stripe' tender on a
   * SALE (which should never happen through the real UI: till card
   * payments are manual-entry pos1/pos2, never Stripe — see 0030's
   * migration comment), never reach this block and behave exactly as
   * before. A sale with tender 'stripe' is refused outright below rather
   * than silently recorded as a plain ledger 'transfer', which is what it
   * quietly did before this change.
   */
  let stripeRefundId: string | null = null;
  let stripeRefundStatus: string | null = null;

  if (body.tender === 'stripe') {
    if (entityType !== 'order') {
      return res.status(400).json({
        error: 'A Stripe refund can only be issued against an online order, not a till sale.',
      });
    }
    if (orderPaymentProvider !== 'stripe' || !orderProviderReference) {
      return res.status(400).json({
        error:
          'This order was not paid through Stripe (or has no recorded payment reference), so a Stripe refund cannot be issued for it. Choose a different refund method.',
      });
    }

    let stripe: ReturnType<typeof getStripe>;
    try {
      stripe = getStripe();
    } catch (err) {
      if (err instanceof StripeNotConfiguredError) {
        return res.status(503).json({ error: err.message });
      }
      throw err;
    }

    try {
      // Card refunds only, per the schema constraint on orders.payment_provider
      // ('stripe' | 'clearpay') combined with the tender check above — a
      // Clearpay order never reaches this branch because it can never have
      // payment_provider = 'stripe'. Deliberately no `reason` field passed to
      // Stripe: Stripe's own `reason` is a closed enum ('duplicate' |
      // 'fraudulent' | 'requested_by_customer') and mapping this shop's free-
      // text staff-entered reason onto it would either lose information or
      // guess wrong — the real reason lives in this app's own `reason` column
      // instead, same as it always has.
      // Read BEFORE the Stripe call, so a retry of this same request (which
      // has committed nothing) sees the same figure and hashes the same,
      // while a later deliberate refund sees a higher one. Failure to read
      // it is not fatal: falling back to -1 keeps the key well-defined and
      // simply means this one request cannot be deduplicated by a retry.
      const { data: priorRefunds } = await attempt(() =>
        db.selectFrom('refunds').select('amount').where('order_id', '=', entityId).execute(),
      );
      const alreadyRefunded = priorRefunds
        ? priorRefunds.reduce((sum, r) => sum + r.amount, 0)
        : -1;

      const refund = await stripe.refunds.create(
        {
          payment_intent: orderProviderReference,
          amount: body.amount,
          metadata: { order_id: entityId },
        },
        {
          idempotencyKey: refundIdempotencyKey(
            entityId,
            body.amount,
            body.reason,
            req.user!.id,
            alreadyRefunded,
          ),
        },
      );
      stripeRefundId = refund.id;
      stripeRefundStatus = refund.status ?? null;
    } catch (err) {
      // Nothing moved and nothing was recorded — safe to just report it.
      // eslint-disable-next-line no-console
      console.error(
        `[refund] Stripe refund failed for order ${entityId} (${body.reference}):`,
        err,
      );
      const message = err instanceof Error ? err.message : 'Stripe refund failed.';
      return res.status(502).json({ error: `Could not process the Stripe refund: ${message}` });
    }
  }

  const { data: refundId, error: refundErr } = await attempt(() =>
    rpc<string>('create_refund', {
      p_staff_id: req.user!.id,
      p_amount: body.amount,
      p_refund_tender: body.tender === 'stripe' ? 'transfer' : body.tender, // stripe isn't a till tender_method; nearest real refund-out method
      p_reason: body.reason,
      p_lines: pLines,
      p_sale_id: entityType === 'sale' ? entityId : null,
      p_order_id: entityType === 'order' ? entityId : null,
      p_job_id: null,
      p_original_tender: originalTender,
      p_outside_window: isOutsideWindow,
      p_window_override_by: isOutsideWindow ? req.user!.id : null,
      p_stripe_refund_id: stripeRefundId,
      p_stripe_refund_status: stripeRefundStatus,
    }),
  );

  if (refundErr) {
    if (stripeRefundId) {
      // THE CASE THE ORDERING IN THIS ROUTE EXISTS TO MAKE LOUD RATHER THAN
      // SILENT. Stripe has already confirmed the money moved — stripeRefundId
      // is only set once refund creation above succeeded — and the ledger
      // write for it just failed. The customer's card WILL be credited (or
      // already has been); this shop's own records will not show it unless a
      // person intervenes. Not retried automatically here: a blind retry
      // risks a second write racing whatever caused this one to fail, and
      // "silently believed it worked" is worse than "loudly needs a human".
      // eslint-disable-next-line no-console
      console.error(
        `[refund] MONEY MOVED, LEDGER WRITE FAILED — NEEDS MANUAL RECONCILIATION. ` +
          `Stripe refund ${stripeRefundId} (status ${stripeRefundStatus ?? 'unknown'}) succeeded for ` +
          `order ${entityId} (${body.reference}), amount ${body.amount}p, but create_refund failed: ` +
          `${refundErr.message}`,
      );
      return res.status(500).json({
        error:
          'The Stripe refund went through, but recording it here failed. This needs a human to check — nothing further has been attempted automatically. Quote this order reference to whoever investigates.',
      });
    }
    // Batch 2 item C: was a verbatim passthrough of create_refund()'s raw
    // message — three unformatted pence figures and no reference. Now
    // states what's actually left to refund, not just that the attempt was
    // too high — a staff member at the counter shouldn't have to go work
    // that out from the number they were just refused. Falls back to the
    // raw message on the (currently unreachable through this route) chance
    // this was some other guard in create_refund entirely.
    return res.status(409).json({
      error: formatRefundCapError(refundErr.message, body.reference) ?? refundErr.message,
    });
  }

  const refundRow = await db
    .selectFrom('refunds')
    .selectAll()
    .where('id', '=', refundId)
    .executeTakeFirstOrThrow();
  return res.status(201).json(await toApiRefund(refundRow));
});

router.get('/refunds', requireStaff, requirePermission('returns.manage'), async (req, res) => {
  // Refunds paid out of this shop's drawer (a cross-shop refund shows where the money left).
  const shopId = readShop(req);
  const paging = optionalPaging(req);
  // Paged requests may search the refund's own reference, its reason, or an item on it.
  const term =
    paging && typeof req.query.search === 'string'
      ? req.query.search.replace(/[%_,]/g, '').trim()
      : '';
  const like = `%${term}%`;
  const narrow = <O>(qb: SelectQueryBuilder<DB, 'refunds', O>) => {
    let q = qb;
    if (shopId) q = q.where('shop_id', '=', shopId);
    if (term) {
      q = q.where((eb) =>
        eb.or([
          eb('reference', 'ilike', like),
          eb('reason', 'ilike', like),
          eb.exists(
            eb
              .selectFrom('refund_lines')
              .select('refund_lines.id')
              .whereRef('refund_lines.refund_id', '=', 'refunds.id')
              .where('refund_lines.name', 'ilike', like),
          ),
        ]),
      );
    }
    return q;
  };
  const rows = await db
    .selectFrom('refunds')
    .selectAll()
    .$if(true, narrow)
    .orderBy('created_at', 'desc')
    .$if(!!paging, (qb) => qb.limit(paging!.limit).offset(paging!.offset))
    .execute();
  const shaped = await toApiRefunds(rows);
  if (!paging) return res.json(shaped);

  // Whole-list figures, not just this page's.
  const whole = await db
    .selectFrom('refunds')
    .select((eb) => [
      eb.fn.countAll<number>().as('count'),
      eb.fn.sum<number>('amount').as('amount'),
    ])
    .$if(true, narrow)
    .executeTakeFirstOrThrow();
  return res.json(
    pageWithTotals(shaped, Number(whole.count), paging, { amount: Number(whole.amount ?? 0) }),
  );
});
