/**
 * Which payment provider an order went through.
 *
 * Card payment runs through Stripe Elements against a client secret the server
 * issues from a stored order total (components/storefront/checkout/stripe-payment.tsx)
 * — never a total the browser worked out for itself.
 *
 * The two values below still matter — they are exactly the values the
 * database's `orders.payment_provider` CHECK constraint permits (0005/0030),
 * and the checkout store persists one of them.
 *
 * `clearpay` is representable but NOT currently offered: it is a toggle on a
 * verified Stripe account, and it is still an open question with the client. When it is switched on it
 * appears inside the Payment Element on its own, with no code change here.
 */
export type PaymentMethodId = 'stripe' | 'clearpay';
