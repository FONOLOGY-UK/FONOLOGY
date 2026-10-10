import { db } from './db.js';
import { getStripe, isStripeConfigured } from './stripe.js';
import { sendTransactionalEmail } from './email.js';
import { formatPence } from './money.js';
import { escapeHtml } from './html.js';

/**
 * An online order becoming paid — the one definition, shared by the Stripe webhook
 * (routes/webhooks.routes.ts) and the confirmation page's status check
 * (GET /orders/:reference/payment-status), which asks Stripe directly when the webhook is late
 * or missing so a paid customer is never left on "Confirming your payment…" (tester bug B-3).
 */

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
export function providerForMethod(methodType: string | null | undefined): 'stripe' | 'clearpay' {
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
export async function methodTypeForIntent(intentId: string | null): Promise<string | null> {
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

interface ConfirmationLine {
  name: string;
  quantity: number;
  unitPrice: number;
}

/**
 * Order-confirmation email — closes the gap the client-readiness pass
 * found: the checkout confirmation page has always told every customer
 * "We've emailed your confirmation" and no such email existed anywhere in
 * this codebase. Matches acceptanceEmailHtml's style in sell.routes.ts
 * (the only other email this app sends) rather than inventing a new one —
 * plain, no separate marketing-template system to diverge from.
 */
function orderConfirmationEmailHtml(params: {
  reference: string;
  lines: ConfirmationLine[];
  delivery: 'collect' | 'standard' | 'next_day';
  address: string | null;
  postcode: string | null;
  /** shop_settings.shop_address — where a collection order is collected. */
  shopAddress: string | null;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
}): string {
  const rows = params.lines
    .map(
      (line) =>
        `<tr><td>${line.quantity} × ${escapeHtml(line.name)}</td><td style="text-align:right">${formatPence(
          line.unitPrice * line.quantity,
        )}</td></tr>`,
    )
    .join('');

  const deliveryLine =
    params.delivery === 'collect'
      ? `<p>Collection in shop${params.shopAddress ? ` — ${escapeHtml(params.shopAddress)}` : ''}.</p>`
      : `<p>Delivery${params.address ? ` to ${escapeHtml(params.address)}` : ''}${
          params.postcode ? `, ${escapeHtml(params.postcode)}` : ''
        } (${params.delivery === 'next_day' ? 'next day' : 'standard'}).</p>`;

  const discountRow =
    params.discount > 0
      ? `<tr><td>Discount</td><td style="text-align:right">-${formatPence(params.discount)}</td></tr>`
      : '';

  return `
    <p>Order confirmed — reference <strong>${escapeHtml(params.reference)}</strong>.</p>
    <table style="width:100%;border-collapse:collapse">
      ${rows}
      <tr><td>Subtotal</td><td style="text-align:right">${formatPence(params.subtotal)}</td></tr>
      <tr><td>Delivery</td><td style="text-align:right">${formatPence(params.deliveryFee)}</td></tr>
      ${discountRow}
      <tr><td><strong>Total</strong></td><td style="text-align:right"><strong>${formatPence(
        params.total,
      )}</strong></td></tr>
    </table>
    ${deliveryLine}
    <p>Track it any time at fonology.co.uk/track with your reference.</p>
    <p>Fonology</p>
  `;
}

/**
 * Fetches what the email needs and sends it. Called only from the one place
 * an order genuinely becomes paid (below) — never from checkout submission,
 * so a declined card never gets a confirmation. Fire-and-forget by design,
 * matching lib/email.ts's own fail-soft contract: an email failure must
 * never affect the webhook's response to Stripe or roll back the order,
 * which is already committed by the time this runs.
 */
export async function sendOrderConfirmation(orderId: string): Promise<void> {
  const order = await db
    .selectFrom('orders')
    .leftJoin('customers', 'customers.id', 'orders.customer_id')
    .select([
      'orders.reference',
      'orders.guest_email',
      'orders.delivery_method',
      'orders.address_line1',
      'orders.postcode',
      'orders.subtotal',
      'orders.delivery_fee',
      'orders.discount',
      'orders.total',
      'customers.email as customer_email',
    ])
    .where('orders.id', '=', orderId)
    .executeTakeFirst();
  if (!order) return;

  const email = order.guest_email || order.customer_email || null;
  if (!email) {
    // eslint-disable-next-line no-console
    console.error(
      `[email] order ${String(order.reference)} has no email on file — skipping confirmation.`,
    );
    return;
  }

  // Collection orders are collected at the shop that fulfils them.
  const shop = await db
    .selectFrom('shops')
    .innerJoin('orders', 'orders.fulfilment_shop_id', 'shops.id')
    .select('shops.address as shop_address')
    .where('orders.id', '=', orderId)
    .executeTakeFirst();

  const lineRows = await db
    .selectFrom('order_lines')
    .select(['name', 'unit_price', 'quantity'])
    .where('order_id', '=', orderId)
    .execute();
  const lines: ConfirmationLine[] = lineRows.map((l) => ({
    name: l.name,
    quantity: l.quantity,
    unitPrice: l.unit_price,
  }));

  const result = await sendTransactionalEmail({
    to: { email },
    subject: `Order confirmed — ${String(order.reference)}`,
    htmlContent: orderConfirmationEmailHtml({
      reference: order.reference,
      lines,
      delivery: order.delivery_method,
      address: order.address_line1 ?? null,
      postcode: order.postcode ?? null,
      shopAddress: shop?.shop_address ?? null,
      subtotal: order.subtotal,
      deliveryFee: order.delivery_fee,
      discount: order.discount,
      total: order.total,
    }),
  });
  // eslint-disable-next-line no-console
  console.log(
    `[email] order confirmation for ${String(order.reference)}: ${
      result.sent ? 'sent' : `not sent (${result.reason})`
    }.`,
  );
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
export function isTerminalOrderError(error: { message?: string } | null): boolean {
  const message = error?.message ?? '';
  return /cannot move from/i.test(message) || /not enough stock/i.test(message);
}

/**
 * The customer's card was charged but the order cannot be fulfilled (the last unit went to someone else, or
 * staff cancelled the order before the payment landed). Refund the payment in full and close the order, so
 * the customer is not left out of pocket waiting for a person to notice a log line. Returns `refunded` when
 * the money is on its way back, `failed` when it could not be done (the caller keeps its loud log).
 *
 * The Stripe refund carries a per-order idempotency key, so a webhook redelivery or the payment-status
 * poller reaching here again cannot refund twice; an already fully refunded charge counts as refunded.
 * Nothing is written to the `refunds` ledger: the order never became `paid`, so the shop never booked the
 * takings this would reverse.
 */
export async function refundUnfulfillableOrder(
  order: { id: string; reference: string },
  intentId: string,
): Promise<'refunded' | 'failed'> {
  if (!intentId || !isStripeConfigured()) return 'failed';
  try {
    await getStripe().refunds.create(
      {
        payment_intent: intentId,
        metadata: {
          order_id: order.id,
          order_reference: order.reference,
          cause: 'order_unfulfillable',
        },
      },
      { idempotencyKey: `unfulfillable-refund-${order.id}` },
    );
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code !== 'charge_already_refunded') {
      // eslint-disable-next-line no-console
      console.error(
        `[payment] could not auto-refund ${order.reference} (${intentId}):`,
        err instanceof Error ? err.message : err,
      );
      return 'failed';
    }
  }

  await db
    .updateTable('orders')
    .set({ status: 'cancelled' })
    .where('id', '=', order.id)
    .where('status', '=', 'pending')
    .execute()
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[payment] ${order.reference} refunded but could not be cancelled:`, err);
    });

  void sendOrderRefundedEmail(order.id).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[email] refund notice threw:', err instanceof Error ? err.message : err);
  });
  return 'refunded';
}

async function sendOrderRefundedEmail(orderId: string): Promise<void> {
  const order = await db
    .selectFrom('orders')
    .leftJoin('customers', 'customers.id', 'orders.customer_id')
    .select(['orders.reference', 'orders.guest_email', 'customers.email as customer_email'])
    .where('orders.id', '=', orderId)
    .executeTakeFirst();
  const email = order?.guest_email || order?.customer_email || null;
  if (!order || !email) return;
  await sendTransactionalEmail({
    to: { email },
    subject: `Your order ${order.reference} has been refunded`,
    htmlContent: `
      <p>We're sorry - the last unit of an item in order <strong>${escapeHtml(order.reference)}</strong> sold just before your payment reached us, so we could not fulfil it.</p>
      <p>Your payment has been <strong>refunded in full</strong> to the card you used. It normally appears within 5-10 working days.</p>
      <p>Please get in touch if you would like us to find you an alternative.</p>
      <p>Fonology</p>`,
  });
}

export type SettleResult =
  | { outcome: 'paid'; reference: string; methodType: string | null }
  | { outcome: 'already-paid' }
  | { outcome: 'missing' }
  | { outcome: 'mismatch'; reference: string; total: number }
  | { outcome: 'conflict'; reference: string; status: string; message: string };

/**
 * Marks an order paid once Stripe says its payment intent succeeded — from whichever arrives
 * first, the webhook or the confirmation page's check. Safe to call twice: the move is made
 * only `where status = 'pending'`, so the second caller sees `already-paid` and the confirmation
 * email goes out exactly once.
 *
 * `amount` is what Stripe says landed. It must equal the order's total (the intent's amount came
 * out of that very column); if not, the order is left alone for a human — the reconciliation
 * check 0037 exists for. Throws only on an infrastructure failure, which is worth retrying.
 */
export async function settleOrderPaid(
  orderId: string,
  intentId: string,
  amount: number | null,
): Promise<SettleResult> {
  const order = await db
    .selectFrom('orders')
    .select(['id', 'reference', 'total', 'status'])
    .where('id', '=', orderId)
    .executeTakeFirst();
  if (!order) return { outcome: 'missing' };
  if (amount !== null && amount !== order.total) {
    return { outcome: 'mismatch', reference: order.reference, total: order.total };
  }
  if (order.status === 'paid') return { outcome: 'already-paid' };

  // The move itself. The database's own trigger turns this into paid_at plus one
  // stock_consume('online_order') per line, inside one transaction — see
  // validate_order_status_transition in 0005. There is exactly one definition of what becoming
  // paid means, and it lives in the schema.
  const methodType = await methodTypeForIntent(intentId);
  let moved: { id: string } | undefined;
  try {
    moved = await db
      .updateTable('orders')
      .set({
        status: 'paid',
        provider_reference: intentId,
        payment_provider: providerForMethod(methodType),
      })
      .where('id', '=', order.id)
      .where('status', '=', 'pending')
      .returning('id')
      .executeTakeFirst();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isTerminalOrderError({ message })) {
      return { outcome: 'conflict', reference: order.reference, status: order.status, message };
    }
    throw err;
  }

  if (!moved) {
    // Someone else moved it first — the other path got there (fine), or it was cancelled.
    const now = await db
      .selectFrom('orders')
      .select('status')
      .where('id', '=', order.id)
      .executeTakeFirst();
    if (now?.status === 'paid') return { outcome: 'already-paid' };
    return {
      outcome: 'conflict',
      reference: order.reference,
      status: String(now?.status ?? order.status),
      message: 'the order is no longer pending',
    };
  }

  // Reached once per order. Never awaited: the caller answers regardless of the email.
  void sendOrderConfirmation(order.id).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[email] order confirmation threw:', err instanceof Error ? err.message : err);
  });
  return { outcome: 'paid', reference: order.reference, methodType };
}
