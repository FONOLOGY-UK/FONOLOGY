import { z } from 'zod';
import { emailSchema, idSchema, ukPhoneSchema, ukPostcodeSchema } from './common';
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

/** UK-only delivery methods (6.3). Rates live in `@/lib/config`. */
export const deliveryMethodSchema = z.enum(['collect', 'standard', 'next-day', 'remote']);
export type DeliveryMethod = z.infer<typeof deliveryMethodSchema>;

export const paymentMethodSchema = z.enum(['stripe', 'clearpay']);

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
