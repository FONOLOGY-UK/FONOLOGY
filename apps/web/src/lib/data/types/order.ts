import { z } from 'zod';
import { emailSchema, idSchema } from './common';
import { moneySchema } from './pricing';
import { productKindSchema } from './product';

/**
 * Shop orders (accessories). The cart itself lives in client state (Zustand);
 * this domain covers the persisted order created at checkout.
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

export const fulfilmentSchema = z.enum(['collect', 'deliver']);
export type Fulfilment = z.infer<typeof fulfilmentSchema>;

/** Payload submitted at checkout. */
export const orderInputSchema = z
  .object({
    lines: z.array(cartLineSchema).min(1, 'Your bag is empty'),
    name: z.string().trim().min(2, 'Please enter your name'),
    email: emailSchema,
    fulfilment: fulfilmentSchema,
    address: z.string().optional(),
  })
  .refine((v) => v.fulfilment !== 'deliver' || (v.address && v.address.trim().length > 0), {
    message: 'Enter a delivery address',
    path: ['address'],
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
  fulfilment: fulfilmentSchema,
  address: z.string().nullable(),
  /** Sum of line totals, in pence. NO VAT (HARD RULE #3). */
  subtotal: moneySchema,
  /** Delivery fee in pence (0 for collect). */
  deliveryFee: moneySchema,
  /** subtotal + deliveryFee. */
  total: moneySchema,
  status: orderStatusSchema,
  createdAt: z.string(),
});
export type Order = z.infer<typeof orderSchema>;
