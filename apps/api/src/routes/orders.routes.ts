import { supabaseAdmin } from '../lib/supabase.js';
import {
  requireStaff,
  requirePermission,
  requireCustomer,
  blockStaffCheckout,
} from '../middleware/auth.js';
import { purgeExpiredDocuments } from '../lib/documentRetention.js';
import { clientIp } from '../lib/clientIp.js';
import { getStripe, isStripeConfigured } from '../lib/stripe.js';
import { isRateLimited } from '../lib/rateLimit.js';
import {
  orderInputBodySchema,
  orderStatusBodySchema,
  documentRejectBodySchema,
  deliveryQuoteBodySchema,
} from '../schemas.js';

import { createRouter } from '../lib/router.js';

export const ordersRouter = createRouter();

/**
 * UK delivery method -> DB delivery_method. 'remote' is not a real DB
 * method — it was the mock's own fixed-price self-report ("I know I'm in a
 * remote area"). The schema derives the real zone from the postcode on
 * every order regardless of what the customer picked, so 'remote' collapses
 * into 'standard' service tier here; the ACTUAL fee still comes out at the
 * remote rate if the postcode really is remote, and at the standard rate if
 * it isn't — never from what the client claims. See the B3 report.
 */
function mapDeliveryMethod(input: string): 'collect' | 'standard' | 'next_day' {
  if (input === 'collect') return 'collect';
  if (input === 'next-day') return 'next_day';
  return 'standard';
}

function mapDeliveryMethodOut(method: string): 'collect' | 'standard' | 'next-day' {
  if (method === 'next_day') return 'next-day';
  if (method === 'collect') return 'collect';
  return 'standard';
}

interface OrderLineRow {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  name: string;
  unit_price: number;
  quantity: number;
  products: { slug: string; sub: string | null; kind: string } | null;
}

async function toApiOrder(orderRow: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data: lineRows } = await supabaseAdmin
    .from('order_lines')
    .select('id, product_id, variant_id, name, unit_price, quantity, products(slug, sub, kind)')
    .eq('order_id', orderRow.id);

  const lines = ((lineRows ?? []) as unknown as OrderLineRow[]).map((line) => ({
    productId: line.product_id ?? line.id,
    // Round 5 Phase 4 #16: null for every line that isn't a variant.
    variantId: line.variant_id,
    name: line.name,
    // sub/slug/kind aren't snapshotted on order_lines (only name + price are
    // — the historically-meaningful fields). Joined from the live product
    // when it still exists; honest fallbacks when it's been deleted since.
    sub: line.products?.sub ?? '',
    slug: line.products?.slug ?? '',
    kind: line.products?.kind ?? 'accessory',
    unitPrice: line.unit_price,
    quantity: line.quantity,
  }));

  let email = orderRow.guest_email as string | null;
  if (!email && orderRow.customer_id) {
    const { data: customer } = await supabaseAdmin
      .from('customers')
      .select('email')
      .eq('id', orderRow.customer_id as string)
      .maybeSingle();
    email = customer?.email ?? null;
  }

  return {
    id: orderRow.id,
    reference: orderRow.reference,
    lines,
    name: orderRow.recipient_name ?? '',
    email: email ?? '',
    phone: orderRow.phone ?? '',
    delivery: mapDeliveryMethodOut(orderRow.delivery_method as string),
    address: orderRow.address_line1 ?? null,
    postcode: orderRow.postcode ?? null,
    subtotal: orderRow.subtotal,
    deliveryFee: orderRow.delivery_fee,
    discount: orderRow.discount,
    total: orderRow.total,
    status: orderRow.status,
    courier: orderRow.courier ?? null,
    trackingNumber: orderRow.tracking_number ?? null,
    createdAt: orderRow.created_at,
  };
}

/**
 * Admin: all orders, for the online-orders board. Gated the same as the
 * status-move endpoint below (requireStaff only) — there's no dedicated
 * "orders.manage" in the 15-value permission enum, and every counter/repair
 * staff member already needs visibility of what's shipped/awaiting collection.
 */
ordersRouter.get('/', requireStaff, async (_req, res) => {
  const { data: rows, error } = await supabaseAdmin
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Could not load orders.' });
  return res.json(
    await Promise.all((rows ?? []).map((row) => toApiOrder(row as Record<string, unknown>))),
  );
});

/**
 * Read-only: what create_order would actually charge for delivery, for this
 * basket/method/postcode, before the order exists. Calls delivery_quote() —
 * the exact same function create_order() calls — so what the checkout screen
 * shows can never drift from what gets charged (see 0021_delivery_quote.sql).
 */
ordersRouter.post('/delivery-quote', async (req, res) => {
  const parsed = deliveryQuoteBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  const productIds = [...new Set(body.lines.map((l) => l.productId))];
  const { data: products, error: productsErr } = await supabaseAdmin
    .from('products')
    .select('id, is_active')
    .in('id', productIds);
  if (productsErr) return res.status(500).json({ error: 'Could not price the basket.' });
  const byId = new Set((products ?? []).map((p) => p.id as string));
  for (const line of body.lines) {
    if (!byId.has(line.productId)) {
      return res
        .status(400)
        .json({ error: `One of the items in your bag is no longer available.` });
    }
  }

  const pLines = body.lines.map((l) => ({ product_id: l.productId, quantity: l.quantity }));
  const deliveryMethod = mapDeliveryMethod(body.delivery);

  const { data, error } = await supabaseAdmin
    .rpc('delivery_quote', {
      p_lines: pLines,
      p_delivery_method: deliveryMethod,
      p_postcode: body.postcode ?? null,
    })
    .single();
  if (error) return res.status(400).json({ error: error.message });

  const row = data as { delivery_fee: number; zone_code: string | null };

  // When it would actually arrive, honouring shop_settings.next_day_cutoff_time
  // and skipping weekends (0026). Computed server-side because it depends on
  // the shop's Europe/London clock and a settings value — a browser-side
  // version would drift with the visitor's own timezone, and this is a date the
  // shop will be held to.
  const { data: estimate } = await supabaseAdmin
    .rpc('delivery_estimate', { p_delivery_method: deliveryMethod })
    .single();
  const est = estimate as {
    dispatch_date: string | null;
    arrival_date: string | null;
    cutoff_time: string;
    after_cutoff: boolean;
  } | null;

  return res.json({
    deliveryFee: row.delivery_fee,
    zone: row.zone_code,
    // Null for collect — there is no dispatch for a collection.
    dispatchDate: est?.dispatch_date ?? null,
    arrivalDate: est?.arrival_date ?? null,
    cutoffTime: est?.cutoff_time ?? null,
    afterCutoff: est?.after_cutoff ?? false,
  });
});

ordersRouter.post('/', blockStaffCheckout('place an order'), async (req, res) => {
  const parsed = orderInputBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  const productIds = [...new Set(body.lines.map((l) => l.productId))];
  const variantIds = [...new Set(body.lines.map((l) => l.variantId).filter(Boolean))] as string[];
  const [{ data: products, error: productsErr }, { data: variants, error: variantsErr }] =
    await Promise.all([
      supabaseAdmin
        .from('products')
        .select('id, price, stock_qty, is_active, kind, free_delivery, has_variants')
        .in('id', productIds),
      variantIds.length
        ? supabaseAdmin
            .from('product_variants')
            .select('id, product_id, stock_qty, is_active')
            .in('id', variantIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
  if (productsErr) return res.status(500).json({ error: 'Could not validate the basket.' });
  if (variantsErr) return res.status(500).json({ error: 'Could not validate the basket.' });

  const byId = new Map((products ?? []).map((p) => [p.id as string, p]));
  const variantById = new Map((variants ?? []).map((v) => [v.id as string, v]));

  for (const line of body.lines) {
    const product = byId.get(line.productId);
    if (!product || !product.is_active) {
      return res
        .status(400)
        .json({ error: `One of the items in your bag is no longer available.` });
    }
    if (product.kind === 'vape') {
      return res
        .status(400)
        .json({ error: 'Vapes are in-store only and cannot be ordered online.' });
    }

    // Round 5 Phase 4 #16: a has_variants product's own stock_qty is frozen
    // and unused (0060) — the oversell pre-check below has to look at the
    // NAMED VARIANT's stock, not the parent's.
    if (line.variantId) {
      const variant = variantById.get(line.variantId);
      if (!variant || !variant.is_active || variant.product_id !== line.productId) {
        return res
          .status(400)
          .json({ error: `One of the items in your bag is no longer available.` });
      }
      if ((variant.stock_qty as number) < line.quantity) {
        return res.status(409).json({
          error: `Only ${variant.stock_qty} left of one item in your bag — please adjust the quantity.`,
        });
      }
    } else if ((product.stock_qty as number) < line.quantity) {
      return res.status(409).json({
        error: `Only ${product.stock_qty} left of one item in your bag — please adjust the quantity.`,
      });
    }
  }

  // Identity: from the authenticated session if one exists, never from the
  // request body. A customer can't place an order "as" someone else by
  // editing a client-side field, because there is no client-side field for
  // it — customer_id only ever comes from the verified session cookie.
  const customerId = req.user?.kind === 'customer' ? req.user.id : null;
  const guestEmail = customerId ? null : body.email;

  const pLines = body.lines.map((l) => ({
    product_id: l.productId,
    variant_id: l.variantId ?? null,
    quantity: l.quantity,
  }));
  const recipientName = `${body.firstName} ${body.lastName}`.trim();
  const deliveryMethod = mapDeliveryMethod(body.delivery);

  const { data: orderId, error: createErr } = await supabaseAdmin.rpc('create_order', {
    p_lines: pLines,
    p_delivery_method: deliveryMethod,
    p_customer_id: customerId,
    p_guest_email: guestEmail,
    p_recipient_name: recipientName,
    p_address_line1: body.address ?? null,
    p_address_line2: null,
    p_city: null,
    p_county: null,
    p_postcode: body.postcode ?? null,
    // Deliberately always 0 — see schemas.ts: there is no customer-facing
    // discount-code path in this schema. promoCode is accepted so the
    // request validates, and is never read again after that.
    p_discount: 0,
    p_phone: body.phone,
    // Which provider the customer chose, recorded on the order at creation.
    // 0030 added this parameter specifically because paymentMethod was being
    // accepted by the request schema and then silently dropped, leaving
    // orders.payment_provider null on every order ever placed. Null stays
    // meaningful: it means the customer never got as far as choosing.
    p_payment_provider: body.paymentMethod ?? null,
  });

  if (createErr) {
    return res.status(400).json({ error: createErr.message });
  }

  const hasPlateLine = body.lines.some((l) => byId.get(l.productId)?.kind === 'plate');
  if (hasPlateLine && body.verification) {
    await supabaseAdmin.from('order_documents').insert([
      {
        order_id: orderId,
        kind: 'v5c',
        storage_path: body.verification.registrationDoc,
        status: 'pending',
      },
      {
        order_id: orderId,
        kind: 'driving_licence',
        storage_path: body.verification.licence,
        status: 'pending',
      },
    ]);
  }

  const { data: orderRow } = await supabaseAdmin
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();
  return res.status(201).json(await toApiOrder(orderRow as Record<string, unknown>));
});

/**
 * Does this requester own this order?
 *
 * Either they're signed in AS the customer the order belongs to, or they can
 * produce the email address the order was placed with. Extracted so the order
 * lookup and the payment-intent endpoint below cannot drift apart — an
 * ownership rule that exists in two copies is one that will eventually be
 * enforced in one place and not the other.
 */
async function requesterOwnsOrder(
  req: { user?: { kind: string; id: string } | null; query: Record<string, unknown> },
  orderRow: Record<string, unknown>,
): Promise<boolean> {
  if (req.user?.kind === 'customer' && req.user.id === orderRow.customer_id) return true;

  const emailParam =
    typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : null;
  let ownerEmail: string | null = orderRow.guest_email as string | null;
  if (!ownerEmail && orderRow.customer_id) {
    const { data: customer } = await supabaseAdmin
      .from('customers')
      .select('email')
      .eq('id', orderRow.customer_id as string)
      .maybeSingle();
    ownerEmail = customer?.email ?? null;
  }
  return Boolean(emailParam && ownerEmail && ownerEmail.trim().toLowerCase() === emailParam);
}

/**
 * Round 3 #1.3: staff-only lookup by reference, no email required.
 *
 * `GET /:reference` below is the CUSTOMER-facing one — it deliberately
 * never distinguishes "wrong email" from "no such order" (see
 * requesterOwnsOrder's own comment), which is exactly right for a stranger
 * on the tracking page and exactly wrong for a member of staff processing a
 * return, who has no email to supply and every right to look any order up.
 * This is a SEPARATE route rather than a bypass added to `requesterOwnsOrder`
 * — the customer-facing authorization stays exactly as strict as it was;
 * staff get their own door in, gated by `requireStaff` the normal way.
 */
ordersRouter.get(
  '/lookup/:reference',
  requireStaff,
  requirePermission('returns.manage'),
  async (req, res) => {
    const reference = (req.params.reference ?? '').trim().toUpperCase();
    const { data: orderRow } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('reference', reference)
      .maybeSingle();
    if (!orderRow) return res.json(null);
    return res.json(await toApiOrder(orderRow as Record<string, unknown>));
  },
);

/**
 * Round 5 Phase 3 #22 — the signed-in customer's own order history, for the
 * account dashboard. A real, separate route rather than reusing
 * `GET /:reference` in a loop: this is the one place a customer's full
 * order list is ever assembled, and it stays self-scoped
 * (`.eq('customer_id', req.user!.id)`) the same way every other
 * self-service route in this file already is.
 */
ordersRouter.get('/mine', requireCustomer, async (req, res) => {
  const { data: rows, error } = await supabaseAdmin
    .from('orders')
    .select('*')
    .eq('customer_id', req.user!.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Could not load your orders.' });
  return res.json(
    await Promise.all((rows ?? []).map((r) => toApiOrder(r as Record<string, unknown>))),
  );
});

/**
 * Round 5 Phase 3 #23 — guest tracking, ID only, no email. Deliberately a
 * separate, narrower endpoint from `GET /:reference` below rather than
 * that route with its email requirement relaxed: this returns ONLY
 * courier + tracking number, never the address, line items, name or
 * phone `GET /:reference` does. References are sequential and guessable
 * (see the comment on requesterOwnsOrder) — the small, deliberately
 * useless-on-its-own response shape is the main mitigation for that;
 * `isRateLimited` (rateLimit.ts) is the second one, so a bare reference
 * being enough to get an answer doesn't also mean the whole reference
 * space is free to sweep. See the security-tradeoff discussion this
 * shipped with for the full reasoning.
 */
ordersRouter.get('/:reference/tracking', async (req, res) => {
  const key = clientIp(req) ?? 'unknown';
  if (isRateLimited(key, { max: 20, windowMs: 10 * 60_000 })) {
    return res.status(429).json({ error: 'Too many lookups — please try again in a few minutes.' });
  }

  const reference = (req.params.reference ?? '').trim().toUpperCase();
  const { data: orderRow } = await supabaseAdmin
    .from('orders')
    .select('courier, tracking_number')
    .eq('reference', reference)
    .maybeSingle();
  if (!orderRow) return res.json(null);
  return res.json({
    courier: orderRow.courier ?? null,
    trackingNumber: orderRow.tracking_number ?? null,
  });
});

/**
 * Red-team finding #2 (CRITICAL, confirmed): `requesterOwnsOrder` accepts a
 * bare `?email=` match as sole proof of identity for a guest requester
 * (below), against a sequential, guessable reference — and until now
 * nothing here slowed down a sweep. Rate-limited the same way the
 * guest-tracking lookup already is (`orders.routes.ts`'s own
 * `/:reference/tracking`), keyed by IP alone rather than IP+email: the
 * actual attack shape is "hold one known/guessed email fixed, sweep many
 * references", so IP is the dimension that actually varies across a
 * sweep and the one worth capping. Stricter than the tracking-only route's
 * 20/10min, because a full order response here carries name, address and
 * phone — the tracking route deliberately returns none of that.
 *
 * This slows enumeration; it does not close the underlying gap that a bare
 * email match is weak proof of identity. See the design note this ships
 * with (readiness-audit follow-up) for the stronger alternative — a
 * one-time code or signed link — flagged as a product decision, not
 * shipped here.
 */
ordersRouter.get('/:reference', async (req, res) => {
  if (
    isRateLimited(`order-lookup:${clientIp(req) ?? 'unknown'}`, { max: 10, windowMs: 10 * 60_000 })
  ) {
    return res.status(429).json({ error: 'Too many lookups — please try again in a few minutes.' });
  }

  const reference = (req.params.reference ?? '').trim().toUpperCase();
  const { data: orderRow } = await supabaseAdmin
    .from('orders')
    .select('*')
    .eq('reference', reference)
    .maybeSingle();

  if (!orderRow) return res.json(null);

  // Same rule as B1's /guest/resolve: never distinguish "wrong email" from
  // "no such order" — both look identical from the outside.
  if (!(await requesterOwnsOrder(req, orderRow as Record<string, unknown>))) return res.json(null);

  return res.json(await toApiOrder(orderRow as Record<string, unknown>));
});

/**
 * Start paying for an order that already exists.
 *
 * THE ORDER COMES FIRST, AND THAT IS THE WHOLE DESIGN
 * The checkout creates a `pending` order before Stripe is involved at all, so
 * by the time this runs the server has already priced the basket, derived the
 * delivery fee from the postcode, and written a total. The amount below is
 * read straight back out of that row. Nothing the browser sends can influence
 * it — there is no amount field in this request to influence it WITH, which is
 * the point. The checkout used to do the opposite: it called a mock pay() with
 * a total the browser had computed, and only then created the order.
 *
 * WHY THE VAPE CHECK IS HERE TOO
 * It is already enforced in three places: the order_lines insert trigger, the
 * create_order function, and POST /orders above. This is the fourth, and it is
 * not redundant — the other three all fire at order-creation time, and an
 * order can sit pending for as long as the customer leaves the tab open. A
 * product re-categorised as a vape in that window would otherwise be paid for
 * online. Payment is the last gate before money moves, so it gets its own
 * check rather than trusting one taken minutes earlier.
 *
 * NO VAT. The amount is orders.total, which is subtotal + delivery - discount.
 * There is no tax line anywhere in this schema and none is added here; the
 * business is not VAT registered.
 */
ordersRouter.post('/:reference/payment-intent', async (req, res) => {
  if (!isStripeConfigured()) {
    return res.status(503).json({
      error: 'Card payment is not available right now. Please choose collection, or call the shop.',
    });
  }

  const reference = (req.params.reference ?? '').trim().toUpperCase();
  const { data: orderRow } = await supabaseAdmin
    .from('orders')
    .select('id, reference, total, status, customer_id, guest_email, provider_reference')
    .eq('reference', reference)
    .maybeSingle();

  // Indistinguishable from "wrong email", exactly as the lookup above.
  if (!orderRow) return res.status(404).json({ error: 'Order not found.' });
  if (!(await requesterOwnsOrder(req, orderRow))) {
    return res.status(404).json({ error: 'Order not found.' });
  }

  if (orderRow.status !== 'pending') {
    // Already paid is a success from the customer's point of view — they
    // should be looking at their confirmation, not at a card form. Anything
    // else (cancelled) is genuinely closed.
    return res.status(409).json({
      error:
        orderRow.status === 'paid'
          ? 'This order has already been paid for.'
          : `This order can no longer be paid for (${String(orderRow.status)}).`,
      status: orderRow.status,
    });
  }

  // Fourth vape gate — see the note above. Checked against the LIVE product
  // rows, not the order's snapshot, because the thing being guarded against is
  // the product changing after the order was written.
  const { data: lineRows, error: linesErr } = await supabaseAdmin
    .from('order_lines')
    .select('product_id, products(kind, is_active)')
    .eq('order_id', orderRow.id);
  if (linesErr) return res.status(500).json({ error: 'Could not check the order.' });

  const blocked = ((lineRows ?? []) as unknown as { products: { kind: string } | null }[]).some(
    (line) => line.products?.kind === 'vape',
  );
  if (blocked) {
    return res
      .status(400)
      .json({ error: 'Vapes are in-store only and cannot be paid for online.' });
  }

  const amount = orderRow.total as number;
  if (!Number.isInteger(amount) || amount < 0) {
    // A non-integer or negative total means the row is not what this code
    // thinks it is. Refusing beats sending a guess to a payment provider.
    return res.status(500).json({ error: 'Could not price this order for payment.' });
  }

  /**
   * Red-team finding #6a (MEDIUM, confirmed — the old check was
   * `amount <= 0`, treating a genuinely free order identically to a
   * broken one). A 100%-off promotion, or any other path that legitimately
   * zeroes out `orders.total`, has nothing for Stripe to charge — sending
   * it to `paymentIntents.create` either errors outright (Stripe rejects a
   * zero-amount intent) or, worse, silently succeeds with an intent worth
   * nothing while the order sits `pending` forever, since nothing would
   * ever fire the webhook that marks it paid.
   *
   * Skips Stripe entirely and marks the order paid the exact same way
   * `POST /:reference/paid` (below) already does for a counter/bank-
   * transfer order that never touches Stripe: `UPDATE orders SET status =
   * 'paid'`, which validate_order_status_transition (0005) turns into
   * paid_at plus stock_consume per line, idempotently. `clientSecret: null`
   * in the response is not a new state invented for this — it is the exact
   * shape `stripe-payment.tsx` already treats as "nothing to charge here,
   * complete the order without a card step" for the mock-adapter case
   * (see order.ts's own paymentIntentSchema comment) — a free real order
   * now reaches that same, already-handled branch.
   */
  if (amount === 0) {
    const { error: paidErr } = await supabaseAdmin
      .from('orders')
      .update({ status: 'paid' })
      .eq('id', orderRow.id);
    if (paidErr) return res.status(409).json({ error: paidErr.message });

    return res.json({
      clientSecret: null,
      amount,
      currency: 'gbp',
      reference: orderRow.reference,
    });
  }

  const stripe = getStripe();
  const intent = await stripe.paymentIntents.create(
    {
      // Integer pence, straight from the database. Stripe's smallest-unit
      // convention and this schema's `pence` domain are the same unit, so
      // there is deliberately no conversion step here to get wrong.
      amount,
      currency: 'gbp',
      // Card and whatever else the account has enabled. Clearpay is a
      // dashboard toggle on a verified account and is NOT enabled — see
      // HANDOVER-PROJECT.md section 8, still an open question with the client.
      automatic_payment_methods: { enabled: true },
      // How a webhook finds its way back to an order. Both are recorded: the
      // id is what the handler matches on, the reference is what a human reads
      // in the Stripe dashboard when someone rings up about FNL-10047.
      metadata: {
        order_id: String(orderRow.id),
        order_reference: String(orderRow.reference),
      },
      description: `Fonology order ${String(orderRow.reference)}`,
    },
    {
      // Keyed on the order, so a double-clicked Pay button, a retried request
      // or a refreshed tab all resolve to the SAME intent rather than creating
      // a second one for the same basket. Stripe returns the original.
      idempotencyKey: `order-intent-${String(orderRow.id)}`,
    },
  );

  // Recorded now rather than at confirmation. 0030 said this column gets
  // filled "when payment is actually confirmed", and the webhook does confirm
  // it — but an intent that is created and then abandoned is exactly the case
  // support needs to be able to trace ("I definitely paid"), and writing it
  // here is what makes that traceable. `status` remains the only thing that
  // says whether money arrived; a reference on a pending order means an
  // attempt, not a payment.
  await supabaseAdmin
    .from('orders')
    .update({ provider_reference: intent.id, payment_provider: 'stripe' })
    .eq('id', orderRow.id);

  return res.json({
    clientSecret: intent.client_secret,
    // Echoed back so the client can display what it is about to pay WITHOUT it
    // ever being an input. Read-only, server-authored.
    amount,
    currency: 'gbp',
    reference: orderRow.reference,
  });
});

/**
 * Staff marking an order paid by hand. NOT a webhook — see below.
 *
 * This used to be described as a stand-in for the payment webhook, and its
 * requireStaff gate was explicitly called out as a placeholder rather than
 * security. The real Stripe webhook now exists at POST /webhooks/stripe with
 * genuine signature verification (routes/webhooks.routes.ts), so this endpoint
 * stops pretending to be one and becomes the thing it actually is: a counter
 * action for money that did not arrive through Stripe.
 *
 * That is a real case, not a leftover. A click-and-collect order paid in cash
 * at the counter, or a bank transfer that lands in the shop account, has no
 * provider event to confirm it — a person confirms it. Deleting this would
 * leave those orders stuck at `pending` forever.
 *
 * requireStaff (rather than a permission) matches POST /id/:id/status directly
 * below, which already lets any staff session set ANY status including 'paid'.
 * This endpoint therefore grants no power a staff member does not already
 * have; tightening one without the other would only look like security.
 *
 * The update itself is `UPDATE orders SET status = 'paid'`, which the DB's own
 * validate_order_status_transition trigger turns into the paid_at timestamp
 * plus one stock_consume('online_order') per line — idempotently, because the
 * trigger's first check is `if new.status = old.status then return new;`, so
 * firing this twice on an already-paid order is a genuine no-op rather than
 * just an app-layer guard.
 */
ordersRouter.post('/:reference/paid', requireStaff, async (req, res) => {
  const reference = (req.params.reference ?? '').trim().toUpperCase();
  const { data: orderRow } = await supabaseAdmin
    .from('orders')
    .select('id')
    .eq('reference', reference)
    .maybeSingle();
  if (!orderRow) return res.status(404).json({ error: 'Order not found.' });

  const { error } = await supabaseAdmin
    .from('orders')
    .update({ status: 'paid' })
    .eq('id', orderRow.id);
  if (error) return res.status(409).json({ error: error.message });

  const { data: updated } = await supabaseAdmin
    .from('orders')
    .select('*')
    .eq('id', orderRow.id)
    .single();
  return res.json(await toApiOrder(updated as Record<string, unknown>));
});

/**
 * Staff-driven status moves (ready/shipped/collected/cancelled) — the admin
 * orders panel. Keyed by `id`, not `reference`, to match
 * DataAdapter.updateOrderStatus(id, status) exactly — the frontend already
 * has an order's `id` from wherever it fetched the order, and this is the
 * one order-mutation the mock interface names by id rather than reference.
 */
ordersRouter.post('/id/:id/status', requireStaff, async (req, res) => {
  const parsed = orderStatusBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  // Found in QA regression testing: this route used to accept 'shipped'
  // with nothing else — the shop would have no record of how a parcel
  // actually went out. Both fields required the moment the move is
  // actually TO shipped; an order already shipped keeps whatever it has
  // when moved on to some other status later.
  if (body.status === 'shipped' && (!body.courier || !body.trackingNumber)) {
    return res.status(400).json({
      error: 'A courier and tracking number are required to mark an order as shipped.',
    });
  }

  const id = req.params.id;
  const patch: Record<string, unknown> = { status: body.status };
  if (body.status === 'shipped') {
    patch.courier = body.courier;
    patch.tracking_number = body.trackingNumber;
  }

  const { error } = await supabaseAdmin.from('orders').update(patch).eq('id', id);
  if (error) return res.status(409).json({ error: error.message });

  const { data: updated } = await supabaseAdmin.from('orders').select('*').eq('id', id).single();
  return res.json(await toApiOrder(updated as Record<string, unknown>));
});

/**
 * Owner-only visibility (B6) — gated behind settings.manage, the closest
 * fit in the existing 15-value permission enum (there's no dedicated
 * "documents.manage"; retention/verification policy is settings-adjacent).
 * See the B6 report.
 */
ordersRouter.get(
  '/:reference/documents',
  requireStaff,
  requirePermission('settings.manage'),
  async (req, res) => {
    const reference = (req.params.reference ?? '').trim().toUpperCase();
    const { data: orderRow } = await supabaseAdmin
      .from('orders')
      .select('id')
      .eq('reference', reference)
      .maybeSingle();
    if (!orderRow) return res.status(404).json({ error: 'Order not found.' });

    const { data: documents } = await supabaseAdmin
      .from('order_documents')
      .select(
        'id, kind, status, storage_path, reviewed_by, reviewed_at, rejection_reason, uploaded_at',
      )
      .eq('order_id', orderRow.id);

    return res.json(documents ?? []);
  },
);

ordersRouter.post(
  '/:reference/documents/:kind/approve',
  requireStaff,
  requirePermission('settings.manage'),
  async (req, res) => {
    const reference = (req.params.reference ?? '').trim().toUpperCase();
    const { data: orderRow } = await supabaseAdmin
      .from('orders')
      .select('id')
      .eq('reference', reference)
      .maybeSingle();
    if (!orderRow) return res.status(404).json({ error: 'Order not found.' });

    const { data: updated, error } = await supabaseAdmin
      .from('order_documents')
      .update({
        status: 'approved',
        reviewed_by: req.user!.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('order_id', orderRow.id)
      .eq('kind', req.params.kind)
      .select('id, kind, status')
      .maybeSingle();

    if (error) return res.status(500).json({ error: 'Could not approve document.' });
    if (!updated) return res.status(404).json({ error: 'Document not found.' });
    return res.json(updated);
  },
);

ordersRouter.post(
  '/:reference/documents/:kind/reject',
  requireStaff,
  requirePermission('settings.manage'),
  async (req, res) => {
    const parsed = documentRejectBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

    const reference = (req.params.reference ?? '').trim().toUpperCase();
    const { data: orderRow } = await supabaseAdmin
      .from('orders')
      .select('id')
      .eq('reference', reference)
      .maybeSingle();
    if (!orderRow) return res.status(404).json({ error: 'Order not found.' });

    const { data: updated, error } = await supabaseAdmin
      .from('order_documents')
      .update({
        status: 'rejected',
        rejection_reason: parsed.data.reason,
        reviewed_by: req.user!.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('order_id', orderRow.id)
      .eq('kind', req.params.kind)
      .select('id, kind, status')
      .maybeSingle();

    if (error) return res.status(500).json({ error: 'Could not reject document.' });
    if (!updated) return res.status(404).json({ error: 'Document not found.' });
    return res.json(updated);
  },
);

/**
 * Issues a short-lived signed URL for a private document and calls
 * log_document_view() first — the database can't observe Storage access on
 * its own (see 0009_settings.sql's own comment), so this call IS the audit
 * log, not a side effect of one. Every view goes through here; there is no
 * other path in this API that reads a document's bytes.
 */
ordersRouter.get(
  '/:reference/documents/:kind/view',
  requireStaff,
  requirePermission('settings.manage'),
  async (req, res) => {
    const reference = (req.params.reference ?? '').trim().toUpperCase();
    const { data: orderRow } = await supabaseAdmin
      .from('orders')
      .select('id')
      .eq('reference', reference)
      .maybeSingle();
    if (!orderRow) return res.status(404).json({ error: 'Order not found.' });

    const { data: doc } = await supabaseAdmin
      .from('order_documents')
      .select('id, storage_path')
      .eq('order_id', orderRow.id)
      .eq('kind', req.params.kind)
      .maybeSingle();
    if (!doc) return res.status(404).json({ error: 'Document not found.' });

    await supabaseAdmin.rpc('log_document_view', {
      p_document_id: doc.id,
      p_document_type: 'order_document',
      p_staff_id: req.user!.id,
    });

    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from('id-documents')
      .createSignedUrl(doc.storage_path, 60); // short-lived: 60 seconds
    if (signErr) {
      // The dev-proof documents from B3 are placeholder filenames with no
      // real object behind them, so signing can fail here — the audit log
      // above already recorded the view attempt regardless, which is the
      // part that actually matters for this proof. See the B6 report.
      return res.status(200).json({ signedUrl: null, note: signErr.message, viewLogged: true });
    }
    return res.json({ signedUrl: signed.signedUrl, viewLogged: true });
  },
);

/**
 * Global — every private document past its retention window, across all
 * orders, so a scheduled job (or an owner, on demand) can see what's due
 * before purge_expired_order_documents() removes the rows for real.
 */
ordersRouter.get(
  '/documents/due-for-deletion',
  requireStaff,
  requirePermission('settings.manage'),
  async (_req, res) => {
    // Same function the purge job itself uses to pick candidates — one
    // definition of "due", never two definitions that can drift apart. See
    // documents_due_for_deletion() (0020_document_retention_job.sql).
    const { data, error } = await supabaseAdmin.rpc('documents_due_for_deletion');
    if (error) return res.status(500).json({ error: error.message });
    const rows = (data ?? []) as Record<string, unknown>[];
    return res.json(
      rows.map((row) => ({
        id: row.id,
        orderId: row.order_id,
        reference: row.reference,
        kind: row.kind,
        uploadedAt: row.uploaded_at,
        orderStatus: row.order_status,
      })),
    );
  },
);

/**
 * Manual/admin-triggerable purge — the same function the scheduled job
 * (scripts/purge-documents.ts) calls. No separate "manual" logic to drift
 * from what actually runs on a schedule.
 */
ordersRouter.post(
  '/documents/purge',
  requireStaff,
  requirePermission('settings.manage'),
  async (_req, res) => {
    try {
      const result = await purgeExpiredDocuments();
      return res.json(result);
    } catch (err) {
      // Generic 500 — the real cause (a Storage error, a DB error, anything
      // else purgeExpiredDocuments can throw) goes to the log, not the
      // client. Same posture as the global error handler in server.ts.
      // eslint-disable-next-line no-console
      console.error('[api] documents/purge failed:', err);
      return res.status(500).json({ error: 'Could not purge documents.' });
    }
  },
);
