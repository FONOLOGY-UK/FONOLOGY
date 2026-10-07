import { z } from 'zod';
import { idSchema } from './common';

/**
 * Shops (multi-shop). `GET /shops` gives staff the summary; the owner's Shops screen reads the
 * fuller admin shape.
 */
export const shopSummarySchema = z.object({
  id: idSchema,
  /** F01, F02 … assigned by the database, never changed or reused. Starts every number the shop issues (F02-SAL-061026001). */
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
  address: z.string().trim().nullable().optional(),
  phone: z.string().trim().nullable().optional(),
  email: z.string().trim().email('Enter a valid email').or(z.literal('')).nullable().optional(),
  isActive: z.boolean().optional(),
});
export type AdminShopInput = z.infer<typeof adminShopInputSchema>;

/**
 * A product on the master list, as the picker sees it: the product itself, and whether the
 * caller's shop already holds a copy. Never another shop's price, cost or stock.
 */
export const masterProductSchema = z.object({
  id: idSchema,
  slug: z.string(),
  name: z.string(),
  sub: z.string(),
  barcode: z.string().nullable(),
  image: z.string().nullable(),
  /** How many shops stock it. */
  shopCount: z.number().int(),
  inMyShop: z.boolean(),
  myProductId: idSchema.nullable(),
});
export type MasterProduct = z.infer<typeof masterProductSchema>;

/** One shop's (or the combined) headline figures for a date range. Money in pence; margin 0–1. */
const comparisonFiguresSchema = z.object({
  revenue: z.number(),
  cost: z.number(),
  profit: z.number(),
  margin: z.number(),
  sales: z.number().int(),
  avgSale: z.number(),
  byTender: z.array(z.object({ tender: z.string(), total: z.number(), count: z.number() })),
});

/** `GET /reports/analytics/compare`: every open shop side by side, plus the combined total. */
export const shopComparisonSchema = z.object({
  range: z.object({ from: z.string(), to: z.string() }),
  combined: comparisonFiguresSchema,
  shops: z.array(
    comparisonFiguresSchema.extend({
      shopId: idSchema,
      code: z.string(),
      name: z.string(),
      isHub: z.boolean(),
      /** False for a closed shop that still traded in the range. */
      isActive: z.boolean(),
    }),
  ),
});
export type ShopComparison = z.infer<typeof shopComparisonSchema>;
