import express from 'express';
import type Stripe from 'stripe';
import { attempt, db } from '../lib/db.js';
import { createRouter } from '../lib/router.js';
import { verifyWebhookSignature, StripeNotConfiguredError } from '../lib/stripe.js';
import { settleOrderPaid } from '../lib/orderPayments.js';

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
 * Postgres unique-violation. Checked by code rather than by message text
 * because the message is localised and the code is not.
 */
function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505';
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
  const { data: inserted, error: insertErr } = await attempt(() =>
    db
      .insertInto('payment_provider_events')
      .values({
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
      .returning('id')
      .executeTakeFirst(),
  );

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

  const eventRowId = inserted?.id;
  /** Close the row out, whatever the outcome — see processed_at in 0037. */
  const markProcessed = async () => {
    if (!eventRowId) return;
    await db
      .updateTable('payment_provider_events')
      .set({ processed_at: new Date().toISOString() })
      .where('id', '=', eventRowId)
      .execute()
      .catch(() => undefined);
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
    const { data: matches, error: matchErr } = await attempt(() =>
      db
        .selectFrom('refunds')
        .select('id')
        .where('stripe_refund_id', '=', extracted.providerReference)
        .execute(),
    );

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

    const { error: updateErr } = await attempt(() =>
      db
        .updateTable('refunds')
        .set({ stripe_refund_status: extracted.status })
        .where('stripe_refund_id', '=', extracted.providerReference)
        .execute(),
    );
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

  const outcome = await attempt(() =>
    settleOrderPaid(extracted.orderId!, extracted.providerReference ?? '', extracted.amount),
  ).catch((err: unknown) => ({ data: null, error: { message: String(err) } }));
  if (outcome.error) {
    // Infrastructure. Let Stripe retry it.
    // eslint-disable-next-line no-console
    console.error('[webhook] could not mark order paid:', outcome.error);
    return res.status(500).json({ error: 'Could not update order.' });
  }
  const result = outcome.data;
  await markProcessed();

  switch (result.outcome) {
    case 'missing':
      // eslint-disable-next-line no-console
      console.error(
        `[webhook] payment succeeded for order id ${extracted.orderId}, which does not exist. NEEDS A HUMAN.`,
      );
      return res.json({ received: true, acted: false });
    case 'mismatch':
      // What Stripe says it took disagrees with what this server decided to charge. The order is
      // deliberately LEFT ALONE so a human looks at two recorded figures that disagree.
      // eslint-disable-next-line no-console
      console.error(
        `[webhook] AMOUNT MISMATCH on ${result.reference}: Stripe reported ` +
          `${String(extracted.amount)} but the order total is ${result.total}. ` +
          'Order NOT marked paid. NEEDS A HUMAN.',
      );
      return res.json({ received: true, acted: false, mismatch: true });
    case 'already-paid':
      // Paid by another route (the confirmation page's check, a staff mark-paid, an earlier event).
      return res.json({ received: true, acted: false, alreadyPaid: true });
    case 'conflict':
      // Understood and unactionable — a cancelled order that was paid for, or the last unit sold
      // to someone else a moment earlier. Retrying cannot help. 200, recorded, and loud.
      // eslint-disable-next-line no-console
      console.error(
        `[webhook] payment succeeded for ${result.reference} but the order could not ` +
          `be marked paid (status ${result.status}): ${result.message}. ` +
          'MONEY HAS BEEN TAKEN AND THE ORDER IS NOT PAID. NEEDS A HUMAN — refund or fulfil.',
      );
      return res.json({ received: true, acted: false, conflict: true });
    case 'paid':
      // eslint-disable-next-line no-console
      console.log(
        `[webhook] ${result.reference} marked paid via ${result.methodType ?? 'unknown method'} ` +
          `(${extracted.providerReference ?? ''}).`,
      );
      return res.json({ received: true, acted: true });
  }
});
