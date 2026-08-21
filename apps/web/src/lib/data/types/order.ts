import { z } from 'zod';
import { emailSchema, idSchema, isoDateSchema, ukPhoneSchema, ukPostcodeSchema } from './common';
import { moneySchema } from './pricing';
import { productKindSchema } from './product';

/**
 * Shop orders (accessories + number plates). The cart lives in client state
 * (Zustand); this domain covers the persisted order created at checkout (6.3).
 */

export const cartLineSchema = z.object({
  productId: idSchema,
  name: z.string(),
  sub: z.string(),
  slug: z.string(),
  /** Product kind — lets checkout detect number plates (ID verification step). */
  kind: productKindSchema,
  /** Unit price in pence at time of adding. */
  unitPrice: moneySchema,
  quantity: z.number().int().positive(),
});
export type CartLine = z.infer<typeof cartLineSchema>;

/**
 * UK-only delivery SPEEDS (6.3) — the customer's choice; the zone (standard
 * vs remote) is derived from the postcode server-side, never a value here.
 * See delivery_quote() / 0021_delivery_quote.sql.
 */
export const deliveryMethodSchema = z.enum(['collect', 'standard', 'next-day']);
export type DeliveryMethod = z.infer<typeof deliveryMethodSchema>;

export const paymentMethodSchema = z.enum(['stripe', 'clearpay']);

/** What the server would actually charge for delivery — see delivery_quote(). */
export const deliveryQuoteInputSchema = z.object({
  lines: z.array(cartLineSchema).min(1),
  delivery: deliveryMethodSchema,
  postcode: z.string().optional(),
});
export type DeliveryQuoteInput = z.infer<typeof deliveryQuoteInputSchema>;

export const deliveryQuoteSchema = z.object({
  deliveryFee: moneySchema,
  /** null for collect (no zone); 'standard' or 'remote' otherwise. */
  zone: z.string().nullable(),
  /**
   * When the parcel leaves and when it should land. Both null for collect —
   * a collection has no dispatch.
   *
   * Server-computed (0026) from `shop_settings.next_day_cutoff_time` and the
   * shop's Europe/London clock, skipping weekends. Never derived here: the
   * customer is being shown a date the shop will be held to, and a browser
   * calculation would drift with the visitor's own timezone.
   */
  dispatchDate: isoDateSchema.nullable().optional(),
  arrivalDate: isoDateSchema.nullable().optional(),
  /** The cut-off itself, so the screen can explain the date rather than assert it. */
  cutoffTime: z.string().nullable().optional(),
  afterCutoff: z.boolean().optional(),
});
export type DeliveryQuote = z.infer<typeof deliveryQuoteSchema>;

/**
 * Number-plate verification (6.3). Files are handled by the backend; here we
 * only carry references. Admin-access only, deleted after 30 days.
 */
export const orderVerificationSchema = z.object({
  registrationDoc: z.string(), // filename / storage ref for V5C/V750 (or alt)
  licence: z.string(), // filename / storage ref for driving licence
});
export type OrderVerification = z.infer<typeof orderVerificationSchema>;

/** Payload submitted at checkout. Guest checkout — no account required (6.3). */
export const orderInputSchema = z
  .object({
    lines: z.array(cartLineSchema).min(1, 'Your bag is empty'),
    email: emailSchema,
    firstName: z.string().trim().min(1, 'Enter your first name'),
    lastName: z.string().trim().min(1, 'Enter your last name'),
    phone: ukPhoneSchema,
    delivery: deliveryMethodSchema,
    address: z.string().optional(),
    postcode: z.string().optional(),
    paymentMethod: paymentMethodSchema,
    promoCode: z.string().optional(),
    verification: orderVerificationSchema.nullable().optional(),
  })
  .refine((v) => v.delivery === 'collect' || (v.address && v.address.trim().length > 0), {
    message: 'Enter a delivery address',
    path: ['address'],
  })
  .refine((v) => v.delivery === 'collect' || ukPostcodeSchema.safeParse(v.postcode ?? '').success, {
    message: 'Enter a valid postcode',
    path: ['postcode'],
  });
export type OrderInput = z.infer<typeof orderInputSchema>;

export const orderStatusSchema = z.enum([
  'pending',
  'paid',
  'ready',
  'collected',
  'shipped',
  'cancelled',
]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export function orderStatusLabel(status: OrderStatus): string {
  switch (status) {
    case 'pending':
      return 'Awaiting payment';
    case 'paid':
      return 'Paid';
    case 'ready':
      return 'Ready to collect';
    case 'collected':
      return 'Collected';
    case 'shipped':
      return 'Shipped';
    case 'cancelled':
      return 'Cancelled';
  }
}

/**
 * Allowed forward moves for each status — the single source of truth for both
 * the admin action buttons and the adapter's transition guard. A `collect`
 * order ends at `collected`; a delivery order ends at `shipped`. The UI passes
 * the order's delivery method to narrow the choice sensibly.
 */
export const ORDER_STATUS_FLOW: Record<OrderStatus, OrderStatus[]> = {
  pending: ['paid', 'cancelled'],
  paid: ['ready', 'shipped', 'cancelled'],
  ready: ['collected', 'shipped', 'cancelled'],
  shipped: [],
  collected: [],
  cancelled: [],
};

export function nextOrderStatuses(status: OrderStatus, delivery?: DeliveryMethod): OrderStatus[] {
  const all = ORDER_STATUS_FLOW[status];
  if (!delivery) return all;
  // Collection orders don't get "shipped"; delivery orders don't get "collected".
  return all.filter((next) => {
    if (next === 'shipped') return delivery !== 'collect';
    if (next === 'collected') return delivery === 'collect';
    return true;
  });
}

export const orderSchema = z.object({
  id: idSchema,
  reference: z.string(), // "FNL-1234"
  lines: z.array(cartLineSchema),
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  delivery: deliveryMethodSchema,
  address: z.string().nullable(),
  postcode: z.string().nullable(),
  /** Sum of line totals, in pence. NO VAT (HARD RULE #3). */
  subtotal: moneySchema,
  /** Delivery fee in pence (0 for collect). */
  deliveryFee: moneySchema,
  /** Promo discount in pence (0 if none). */
  discount: moneySchema,
  /** subtotal + deliveryFee − discount. */
  total: moneySchema,
  status: orderStatusSchema,
  createdAt: z.string(),
});
export type Order = z.infer<typeof orderSchema>;

/**
 * What the server hands back when a customer starts paying for an order.
 *
 * `clientSecret` IS THE ONLY THING THAT DRIVES A REAL CHARGE, and it is
 * created server-side against a total read out of the database. `amount` here
 * is server-authored too, and exists so the UI can show what is about to be
 * taken — it is a value to DISPLAY, never a value to send anywhere.
 *
 * A NULL clientSecret is meaningful, not an error: it means this environment
 * has no payment provider wired up at all (the mock adapter). The checkout
 * treats that as "there is nothing to charge here" and completes the order
 * without a card step, which is what keeps the design prototype and QA
 * click-throughs working with NEXT_PUBLIC_DATA_SOURCE=mock. Against the real
 * API this field is always a string.
 */
export const paymentIntentSchema = z.object({
  clientSecret: z.string().nullable(),
  /** Integer pence, from the order row. NO VAT — the business isn't registered. */
  amount: moneySchema,
  currency: z.literal('gbp'),
  reference: z.string(),
});
export type PaymentIntentDetails = z.infer<typeof paymentIntentSchema>;
