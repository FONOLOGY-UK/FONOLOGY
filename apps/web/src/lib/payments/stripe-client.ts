import { loadStripe, type Stripe } from '@stripe/stripe-js';

/**
 * ONE Stripe.js instance for the whole storefront.
 *
 * Stripe.js is a remote script and `loadStripe` injects it. It used to be
 * called at module scope inside the checkout's payment step, which was correct
 * as long as checkout was the only place that needed Stripe. It no longer is:
 * the buy-now-pay-later messaging on the product page and in the bag drawer
 * needs an `<Elements>` provider too, and a second `loadStripe` call means a
 * second promise and a second Elements group for the same publishable key.
 *
 * Null when the key is absent, so an unconfigured environment (and every
 * server render) fails soft rather than throwing on import. Every consumer
 * must handle null by rendering nothing payment-related.
 */
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

export const stripePromise: Promise<Stripe | null> | null = publishableKey
  ? loadStripe(publishableKey)
  : null;
