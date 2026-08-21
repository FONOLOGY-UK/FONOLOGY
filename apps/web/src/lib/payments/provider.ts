/**
 * Which payment provider an order went through.
 *
 * WHAT USED TO BE HERE
 * A `PAYMENT_PROVIDERS` map whose `pay()` methods were mocks — they waited
 * 1.4 seconds and resolved `{ ok: true }` with a random reference. The
 * checkout called one, and only created the order afterwards, using a total
 * the browser had worked out for itself.
 *
 * All of that is gone. Real card payment now runs through Stripe Elements
 * against a client secret the server issues from a stored order total
 * (components/storefront/checkout/stripe-payment.tsx). The mock was deleted
 * rather than left in place unused, deliberately: a function named `pay()`
 * that always succeeds is a live hazard once real money is involved, and the
 * next person to wire something up should not find one lying about.
 *
 * The two values below still matter — they are exactly the values the
 * database's `orders.payment_provider` CHECK constraint permits (0005/0030),
 * and the checkout store persists one of them.
 *
 * `clearpay` is representable but NOT currently offered: it is a toggle on a
 * verified Stripe account, and it is still an open question with the client
 * (HANDOVER-PROJECT.md section 8, question 1). When it is switched on it
 * appears inside the Payment Element on its own, with no code change here.
 */
export type PaymentMethodId = 'stripe' | 'clearpay';
