import { z } from 'zod';
import { idSchema } from './common';

/**
 * Shops (multi-shop). `GET /shops` gives staff the summary; the owner's Shops screen reads the
 * fuller admin shape.
 */
export const shopSummarySchema = z.object({
  id: idSchema,
  /** Prefixes this shop's receipt, job, refund and payout numbers (S2-FNL-10421). */
  code: z.string(),
  name: z.string(),
  /** Online stock is taken from lower numbers first. */
  sortOrder: z.number().int(),
  /** The shop that fulfils online orders, repairs and trade-ins. */
  isHub: z.boolean(),
  isActive: z.boolean(),
});
export type ShopSummary = z.infer<typeof shopSummarySchema>;

export const adminShopSchema = shopSummarySchema.extend({
  address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
});
export type AdminShop = z.infer<typeof adminShopSchema>;

export const adminShopInputSchema = z.object({
  name: z.string().trim().min(2, 'Name the shop'),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,6}$/, 'The code is 1–6 letters or digits'),
  address: z.string().trim().nullable().optional(),
  phone: z.string().trim().nullable().optional(),
  email: z.string().trim().email('Enter a valid email').or(z.literal('')).nullable().optional(),
  isActive: z.boolean().optional(),
});
export type AdminShopInput = z.infer<typeof adminShopInputSchema>;
