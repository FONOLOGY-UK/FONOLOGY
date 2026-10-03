/**
 * Plays Stripe's part in a local checkout: sends the signed `payment_intent.succeeded`
 * webhook for an order that has been paid in the browser with a test card.
 *
 * Locally nothing delivers Stripe's webhooks (that needs `stripe listen`, signed in), so a
 * paid order stays `pending` forever. This signs the same event with the API's own
 * STRIPE_WEBHOOK_SECRET and posts it to the running API — the real handler does the rest.
 *
 *   npx tsx scripts/simulate-stripe-paid.ts FNL-10159
 *
 * Used by packages/e2e (customer-journeys). Refuses a non-test database like the rest.
 */
import Stripe from 'stripe';
import { assertTestWritesAllowed } from '../src/config.js';
import { db, pool } from '../src/lib/db.js';

const API = (process.env.E2E_API_BASE ?? 'http://localhost:4000').replace(/\/$/, '');

async function main() {
  assertTestWritesAllowed('simulate-stripe-paid');
  const reference = process.argv[2];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!reference) throw new Error('usage: simulate-stripe-paid.ts <order reference>');
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');

  const order = await db
    .selectFrom('orders')
    .select(['id', 'total', 'provider_reference'])
    .where('reference', '=', reference)
    .executeTakeFirstOrThrow();
  if (!order.provider_reference) throw new Error(`${reference} has no payment intent yet`);

  const payload = JSON.stringify({
    id: `evt_sim_${Date.now()}`,
    object: 'event',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: order.provider_reference,
        object: 'payment_intent',
        amount: Number(order.total),
        amount_received: Number(order.total),
        currency: 'gbp',
        status: 'succeeded',
        metadata: { order_id: order.id },
      },
    },
  });
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  const res = await fetch(`${API}/webhooks/stripe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': header },
    body: payload,
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`webhook refused: ${res.status} ${body}`);
  console.log(`[simulate-stripe-paid] ${reference}: ${res.status} ${body}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
