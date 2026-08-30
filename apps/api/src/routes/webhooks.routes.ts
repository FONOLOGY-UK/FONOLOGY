import express from 'express';
import type Stripe from 'stripe';
import { supabaseAdmin } from '../lib/supabase.js';
import { createRouter } from '../lib/router.js';
import { getStripe, verifyWebhookSignature, StripeNotConfiguredError } from '../lib/stripe.js';

/**
 * Payment provider webhooks.
 *
 * WHAT MAKES THIS SAFE TO EXPOSE
 * This router is mounted OUTSIDE the session middleware and is reachable by
 * anyone on the internet, because that is what a webhook is. The only thing
 * standing between a stranger and "mark this order paid" is the signature
 * check on the first few lines of the handler — Stripe signs every delivery
 * with a shared secret, and a body that does not verify is refused before a
 * single field of it is read.
 *
 * That check is the entire security boundary. It replaced a `requireStaff`
 * gate that the code itself described as a placeholder rather than security.
 *
 * THE RAW BODY IS LOAD-BEARING
 * Signature verification runs over the exact bytes Stripe sent. Parsing the
 * JSON and re-serialising it produces a different byte sequence (key order,
 * whitespace, unicode escaping) and the signature will not match. So this
 * router mounts express.raw() itself, and server.ts mounts it BEFORE the
 * global express.json(). If verification ever starts failing across the board
 * with no other change, that ordering is the first thing to check.
 *
 * IT ALWAYS ANSWERS 200 ONCE THE SIGNATURE PASSES
 * Stripe retries any non-2xx with backoff for up to three days. That is
 * exactly right for a database that is momentarily unreachable, and exactly
 * wrong for an event we understood perfectly and cannot act on — an order that
 * has been cancelled, say. Retrying that for three days produces three days of
 * failed deliveries and an alert nobody can clear.
 *
 * So the two cases are split deliberately:
 *   - infrastructure failed  -> 500, let Stripe retry
 *   - understood, can't act  -> 200, row recorded, human problem
 * The `payment_provider_events` row is what makes the second case visible
 * rather than silent.
 */

export const webhooksRouter = createRouter();

/** Stripe's smallest currency unit is the same unit as this schema's `pence`. */
interface ExtractedEvent {
  eventId: string;
  eventType: string;
  orderId: string | null;
  providerReference: string | null;
  amount: number | null;
  currency: string | null;
  status: string | null;
  failureCode: string | null;
  failureMessage: string | null;
}

/**
 * Pull the handful of fields worth keeping out of a Stripe event.
 *
 * This function is the reason `payment_provider_events` never sees a raw
 * payload. Everything it does NOT return — the customer's name, email, billing
 * address, card last4 and brand — is personal data that the orders table
 * already holds under its own retention rules, and a second uncontrolled copy
 * of it is what migration 0037 exists to avoid. Adding a field here is
 * therefore a data-protection decision, not a convenience one.
 */
function extract(event: Stripe.Event): ExtractedEvent {
  const base: ExtractedEvent = {
    eventId: event.id,
    eventType: event.type,
    orderId: null,
    providerReference: null,
    amount: null,
    currency: null,
    status: null,
    failureCode: null,
    failureMessage: null,
  };

  // Double assertion through `unknown`: event.data.object is a union of ~80
  // concrete Stripe resource types, none of which carries an index signature,
  // so TypeScript refuses the direct conversion. Reading it as a bag of
  // unknown keys is exactly what this function wants — every field below is
  // type-checked individually before it is used.
  const object = event.data.object as unknown as Record<string, unknown>;

  // Present on payment_intent.* and charge.*; absent on events we don't act on.
  const metadata = (object.metadata ?? {}) as Record<string, string | undefined>;
  base.orderId = metadata.order_id ?? null;
  base.providerReference = typeof object.id === 'string' ? object.id : null;
  base.currency = typeof object.currency === 'string' ? object.currency : null;
  base.status = typeof object.status === 'string' ? object.status : null;

  // `amount_received` is what actually landed; `amount` is what was asked for.
  // The received figure is the one worth reconciling against, and it falls
  // back to the requested one for event shapes that don't carry it.
  const received = object.amount_received;
  const requested = object.amount;
  if (typeof received === 'number') base.amount = received;
  else if (typeof requested === 'number') base.amount = requested;

  const lastError = object.last_payment_error as Record<string, unknown> | null | undefined;
  if (lastError) {
    base.failureCode = typeof lastError.code === 'string' ? lastError.code : null;
    // Stripe's customer-facing decline message. Describes the card's outcome
    // ("Your card was declined."), never the cardholder.
    base.failureMessage = typeof lastError.message === 'string' ? lastError.message : null;
  }

  return base;
}

/**
 * Which payment rail actually took the money.
 *
 * `orders.payment_provider` is constrained to 'stripe' or 'clearpay' (0005).
 * Everything here goes THROUGH Stripe, so the distinction being drawn is not
 * "which company processed it" but "which rail was used", and that matters
 * after the sale: a Clearpay order is an instalment plan, its refunds behave
 * differently, and the shop needs to be able to tell one from the other
 * without opening the Stripe dashboard.
 *
 * Stripe calls the method `afterpay_clearpay` — one payment method serving
 * Afterpay in some countries and Clearpay in the UK. Anything else (card,
 * Link, Klarna, Revolut Pay, Amazon Pay) is recorded as plain 'stripe',
 * because those are the only two values the column permits and inventing a
 * third would fail the CHECK.
 */
function providerForMethod(methodType: string | null | undefined): 'stripe' | 'clearpay' {
  return methodType === 'afterpay_clearpay' ? 'clearpay' : 'stripe';
}

/**
 * Ask Stripe what method settled this intent.
 *
 * The succeeded event carries `latest_charge` as a bare id, and
 * `payment_method_types` lists everything that was OFFERED rather than what
 * was used — so neither answers the question on its own. One retrieve with the
 * charge expanded does, and it only runs on payments that actually succeeded.
 *
 * Deliberately soft: if this call fails, the order still gets marked paid.
 * Recording the rail is useful; refusing to acknowledge money that has already
 * moved because a metadata lookup failed would be a much worse trade.
 */
async function methodTypeForIntent(intentId: string | null): Promise<string | null> {
  if (!intentId) return null;
  try {
    const intent = await getStripe().paymentIntents.retrieve(intentId, {
      expand: ['latest_charge'],
    });
    const charge = intent.latest_charge;
    if (charge && typeof charge !== 'string') {
      return charge.payment_method_details?.type ?? null;
    }
    // Fall back to the offered list only when it is unambiguous.
    return intent.payment_method_types?.length === 1
      ? (intent.payment_method_types[0] ?? null)
      : null;
  } catch {
    return null;
  }
}

/**
 * Postgres unique-violation. Checked by code rather than by message text
 * because the message is localised and the code is not.
 */
function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

/**
 * A failure the database will produce again on every retry.
 *
 * The split matters because Stripe retries a non-2xx for up to three days, and
 * that is only ever useful for a transient fault. There are two ways marking
 * an order paid fails permanently, and both mean money has already been taken:
 *
 *   - an illegal status move: the order was cancelled, so pending -> paid is
 *     not a legal transition;
 *   - stock ran out underneath it: `stock_consume` raises "Not enough stock"
 *     from inside the paid trigger. Two customers can each be the last buyer
 *     of the same item — both orders pass the stock check at CHECKOUT time,
 *     because nothing is reserved until payment lands, and then only the first
 *     webhook can actually consume it.
 *
 * Retrying either for three days produces three days of failed deliveries, a
 * permanently red webhook dashboard, and no fix — while a real customer is out
 * of pocket and waiting. Both are recorded, acknowledged, and shouted about in
 * the log so a person refunds or reorders.
 */
function isTerminalOrderError(error: { message?: string } | null): boolean {
  const message = error?.message ?? '';
  return /cannot move from/i.test(message) || /not enough stock/i.test(message);
}

webhooksRouter.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['stripe-signature'];
  if (typeof signature !== 'string') {
    return res.status(400).json({ error: 'Missing stripe-signature header.' });
  }
  if (!Buffer.isBuffer(req.body)) {
    // Means express.json() got to the body first. A real deployment problem,
    // not a caller problem — say so loudly rather than failing the signature
    // check and sending someone hunting for the wrong bug.
    // eslint-disable-next-line no-console
    console.error(
      '[webhook] body is not a Buffer — express.json() is parsing the webhook route. ' +
        'The raw mount in server.ts must come BEFORE app.use(express.json()).',
    );
    return res.status(500).json({ error: 'Webhook misconfigured.' });
  }

  let event: Stripe.Event;
  try {
    event = verifyWebhookSignature(req.body, signature);
  } catch (err) {
    if (err instanceof StripeNotConfiguredError) {
      // eslint-disable-next-line no-console
      console.error('[webhook] refused: ', err.message);
      return res.status(503).json({ error: 'Webhook not configured.' });
    }
    // Bad signature, altered body, or a timestamp outside the replay
    // tolerance. Nothing inside the payload has been read and nothing will
    // be. 400 tells Stripe not to bother retrying — a signature that failed
    // once fails identically every time.
    // eslint-disable-next-line no-console
    console.warn('[webhook] signature verification failed — payload ignored.');
    return res.status(400).json({ error: 'Signature verification failed.' });
  }

  const extracted = extract(event);

  // Record first, act second. The insert is the idempotency gate: the unique
  // index on (provider, event_id) means a redelivery of an event we have
  // already seen loses this race and returns 23505, and we stop. Doing it
  // this way round rather than "check, then act, then record" is what makes
  // it correct under a concurrent redelivery — two copies of the same event
  // arriving at once cannot both get past the insert.
  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('payment_provider_events')
    .insert({
      provider: 'stripe',
      event_id: extracted.eventId,
      event_type: extracted.eventType,
      order_id: extracted.orderId,
      provider_reference: extracted.providerReference,
      amount: extracted.amount,
      currency: extracted.currency,
      status: extracted.status,
      failure_code: extracted.failureCode,
      failure_message: extracted.failureMessage,
    })
    .select('id')
    .maybeSingle();

  if (insertErr) {
    if (isUniqueViolation(insertErr)) {
      // Already handled. 200 so Stripe stops redelivering.
      return res.json({ received: true, duplicate: true });
    }
    // The database is unreachable or otherwise broken. This one IS worth
    // retrying, so give Stripe a 5xx and let its backoff do the work.
    // eslint-disable-next-line no-console
    console.error('[webhook] could not record event:', insertErr);
    return res.status(500).json({ error: 'Could not record event.' });
  }

  const eventRowId = inserted?.id as string | undefined;
  /** Close the row out, whatever the outcome — see processed_at in 0037. */
  const markProcessed = async () => {
    if (!eventRowId) return;
    await supabaseAdmin
      .from('payment_provider_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('id', eventRowId);
  };

  // Two event types actually change something on our side. Everything else
  // is recorded above and acknowledged — including types we have never
  // seen, which must not 500 or Stripe will retry them for three days.
  if (event.type !== 'payment_intent.succeeded' && event.type !== 'refund.updated') {
    await markProcessed();
    return res.json({ received: true, acted: false });
  }

  /**
   * Readiness-audit Group 3 — closes the loop for a refund that settles
   * asynchronously on Stripe's side. `stripe.refunds.create()` (pos.routes.ts)
   * already writes the refund's INITIAL status at creation time; this is
   * what updates it if Stripe later reports the refund actually failed, or
   * moves from pending to succeeded for a payment method that doesn't
   * settle instantly. `extract()` above already works unmodified for a
   * Refund object — same `.id`, `.status`, `.amount`, `.metadata.order_id`
   * shape `payment_intent.succeeded` reads, since Stripe refund objects were
   * given the same order_id metadata at creation (see pos.routes.ts).
   */
  if (event.type === 'refund.updated') {
    const { data: matches, error: matchErr } = await supabaseAdmin
      .from('refunds')
      .select('id, order_id, amount')
      .eq('stripe_refund_id', extracted.providerReference);

    if (matchErr) {
      // eslint-disable-next-line no-console
      console.error('[webhook] could not look up refund by stripe_refund_id:', matchErr);
      return res.status(500).json({ error: 'Could not update refund status.' });
    }
    if (!matches || matches.length === 0) {
      // A refund.updated event for a Stripe refund this app has no record
      // of — most likely one created directly in the Stripe dashboard,
      // bypassing pos.routes.ts entirely. Recorded above either way; loud
      // because a human made a refund this system's own ledger won't show.
      // eslint-disable-next-line no-console
      console.error(
        `[webhook] refund.updated for ${extracted.providerReference ?? '(no id)'} matches no ` +
          'internal refund row — likely issued outside this app. NEEDS A HUMAN to reconcile.',
      );
      await markProcessed();
      return res.json({ received: true, acted: false });
    }

    const { error: updateErr } = await supabaseAdmin
      .from('refunds')
      .update({ stripe_refund_status: extracted.status })
      .eq('stripe_refund_id', extracted.providerReference);
    if (updateErr) {
      // eslint-disable-next-line no-console
      console.error('[webhook] could not update refund status:', updateErr);
      return res.status(500).json({ error: 'Could not update refund status.' });
    }

    await markProcessed();
    // eslint-disable-next-line no-console
    console.log(
      `[webhook] refund ${extracted.providerReference} status now ${extracted.status ?? 'unknown'} ` +
        `(${matches.length} internal row(s)).`,
    );
    return res.json({ received: true, acted: true });
  }

  if (!extracted.orderId) {
    // Money moved and we cannot say what for. The row exists with a null
    // order_id precisely so this is findable — 0037 made that column
    // nullable for exactly this case.
    // eslint-disable-next-line no-console
    console.error(
      `[webhook] payment_intent.succeeded ${extracted.providerReference ?? '(no id)'} carries no ` +
        'order_id in metadata — recorded with no order attached. NEEDS A HUMAN.',
    );
    await markProcessed();
    return res.json({ received: true, acted: false });
  }

  const { data: orderRow, error: orderErr } = await supabaseAdmin
    .from('orders')
    .select('id, reference, total, status')
    .eq('id', extracted.orderId)
    .maybeSingle();

  if (orderErr) {
    // eslint-disable-next-line no-console
    console.error('[webhook] could not load order:', orderErr);
    return res.status(500).json({ error: 'Could not load order.' });
  }
  if (!orderRow) {
    // eslint-disable-next-line no-console
    console.error(
      `[webhook] payment succeeded for order id ${extracted.orderId}, which does not exist. NEEDS A HUMAN.`,
    );
    await markProcessed();
    return res.json({ received: true, acted: false });
  }

  // THE RECONCILIATION CHECK 0037 EXISTS FOR.
  // What Stripe says it took, against what this server decided to charge. In
  // a correct run these are the same number because the intent's amount came
  // out of this very column. If they ever differ, something has gone wrong
  // that nobody should paper over by marking the order paid anyway — so the
  // order is deliberately LEFT ALONE and a human gets to look at two
  // recorded figures that disagree.
  if (extracted.amount !== null && extracted.amount !== orderRow.total) {
    // eslint-disable-next-line no-console
    console.error(
      `[webhook] AMOUNT MISMATCH on ${String(orderRow.reference)}: Stripe reported ` +
        `${extracted.amount} but the order total is ${String(orderRow.total)}. ` +
        'Order NOT marked paid. NEEDS A HUMAN.',
    );
    await markProcessed();
    return res.json({ received: true, acted: false, mismatch: true });
  }

  if (orderRow.status === 'paid') {
    // Already paid by another route (a staff mark-paid, or an earlier
    // delivery of a different event for the same intent). The status trigger
    // would no-op anyway; skipping the write keeps the log quiet.
    await markProcessed();
    return res.json({ received: true, acted: false, alreadyPaid: true });
  }

  // The move itself. The database's own trigger turns this into paid_at plus
  // one stock_consume('online_order') per line, inside one transaction — see
  // validate_order_status_transition in 0005. Deliberately no new order-state
  // logic here: there is exactly one definition of what becoming paid means,
  // and it lives in the schema.
  const methodType = await methodTypeForIntent(extracted.providerReference);

  const { error: updateErr } = await supabaseAdmin
    .from('orders')
    .update({
      status: 'paid',
      provider_reference: extracted.providerReference,
      payment_provider: providerForMethod(methodType),
    })
    .eq('id', orderRow.id);

  if (updateErr) {
    if (isTerminalOrderError(updateErr)) {
      // Understood and unactionable — a cancelled order that was paid for,
      // or the last unit sold to someone else a moment earlier. Retrying
      // cannot help either one. 200, recorded, and loud.
      // eslint-disable-next-line no-console
      console.error(
        `[webhook] payment succeeded for ${String(orderRow.reference)} but the order could not ` +
          `be marked paid (status ${String(orderRow.status)}): ${updateErr.message}. ` +
          'MONEY HAS BEEN TAKEN AND THE ORDER IS NOT PAID. NEEDS A HUMAN — refund or fulfil.',
      );
      await markProcessed();
      return res.json({ received: true, acted: false, conflict: true });
    }
    // Anything else is infrastructure. Let Stripe retry it.
    // eslint-disable-next-line no-console
    console.error('[webhook] could not mark order paid:', updateErr);
    return res.status(500).json({ error: 'Could not update order.' });
  }

  await markProcessed();
  // eslint-disable-next-line no-console
  console.log(
    `[webhook] ${String(orderRow.reference)} marked paid via ${methodType ?? 'unknown method'} ` +
      `(${extracted.providerReference ?? ''}).`,
  );
  return res.json({ received: true, acted: true });
});
