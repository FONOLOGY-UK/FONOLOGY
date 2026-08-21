import Stripe from 'stripe';
import { config } from '../config.js';

/**
 * The Stripe client, constructed on first use rather than at import time.
 *
 * WHY LAZY
 * This module is imported by orders.routes.ts, which is imported by server.ts.
 * A top-level `new Stripe(config.stripeSecretKey!)` would therefore run during
 * module resolution, and an environment with no Stripe key would fail to boot
 * the entire API — the till, the jobs board, every repair in the shop — over
 * an online-payment feature the counter never touches. The shop must open
 * whether or not the website can take card payments.
 *
 * So the key is checked at the moment someone actually tries to take a
 * payment, and the failure is a 503 on one endpoint with a message naming the
 * missing variable, instead of a process that exits before it listens.
 *
 * ON THE API VERSION
 * `apiVersion` is deliberately NOT passed. The SDK carries its own pinned
 * version (22.5.0 pins 2026-07-29.dahlia) and its TypeScript types are
 * generated against exactly that one, so hand-writing a different dated string
 * here would put the types and the wire format out of step — the types would
 * describe one API version while the requests asked for another.
 *
 * This is still a pin, just a stronger one: the version is pinned by the
 * `stripe` entry in package.json, so moving it is a dependency bump that shows
 * up in a diff and a lockfile, rather than a string edit nobody reviews.
 */

let client: Stripe | null = null;

export class StripeNotConfiguredError extends Error {
  constructor(missing: string) {
    super(
      `${missing} is not set. Online card payment is unavailable until it is. ` +
        `Set it in apps/api/.env.local (local) or the deployment's env source.`,
    );
    this.name = 'StripeNotConfiguredError';
  }
}

export function isStripeConfigured(): boolean {
  return Boolean(config.stripeSecretKey);
}

export function getStripe(): Stripe {
  if (!config.stripeSecretKey) throw new StripeNotConfiguredError('STRIPE_SECRET_KEY');
  if (!client) {
    client = new Stripe(config.stripeSecretKey, {
      // Named so the shop is identifiable in Stripe's own request logs when
      // someone is trying to work out which system made a call.
      appInfo: { name: 'Fonology', url: 'https://fonology.co.uk' },
      // Two retries on network-level failure. Stripe's SDK only retries
      // requests it knows are safe to repeat, and PaymentIntent creation is
      // sent with an idempotency key (see the route), so a retry cannot
      // create a second intent for the same order.
      maxNetworkRetries: 2,
    });
  }
  return client;
}

/**
 * Verify a webhook body actually came from Stripe.
 *
 * `raw` MUST be the exact bytes Stripe sent. A parsed-and-restringified body
 * will not verify: JSON.stringify does not guarantee key order or whitespace,
 * and the signature is over the original byte sequence. That is the whole
 * reason server.ts mounts express.raw() on the webhook path BEFORE the global
 * express.json(), and it is the single easiest thing to break here — if
 * signature verification starts failing for no apparent reason, check that the
 * body arriving at this function is still a Buffer.
 */
export function verifyWebhookSignature(raw: Buffer, signature: string): Stripe.Event {
  if (!config.stripeWebhookSecret) throw new StripeNotConfiguredError('STRIPE_WEBHOOK_SECRET');
  // Throws Stripe.errors.StripeSignatureVerificationError on a bad signature,
  // a body that has been altered in transit, or a timestamp outside the
  // tolerance window (replay protection). The caller turns that into a 400 and
  // never reads the payload.
  return getStripe().webhooks.constructEvent(raw, signature, config.stripeWebhookSecret);
}
