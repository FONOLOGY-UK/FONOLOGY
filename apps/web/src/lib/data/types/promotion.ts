import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common';
import { moneySchema } from './pricing';

/**
 * Promotions: tiered deals, IN-STORE / WALK-IN ONLY. The storefront never reads this; online prices
 * are always the product's listed price. A deliberate business rule, not a gap.
 *
 * A tier is entered as a total ("2 for £10"). Its per-item rate applies from that quantity up until a
 * bigger tier takes over: with 2 for £10 and 4 for £16, 3 cost £15 and 5 cost £20.
 */

export const promoTierSchema = z.object({
  minQty: z.number().int().min(2, 'A deal starts at 2 or more'),
  /** What minQty of these cost together, in pence. 0 is allowed. */
  totalPrice: moneySchema.nonnegative('A tier price cannot be negative'),
});
export type PromoTier = z.infer<typeof promoTierSchema>;

/** One running offer as the till prices with it. Same shape as PromoRule in lib/promo-pricing.ts. */
export const promotionSchema = z.object({
  groupId: idSchema,
  mixMatch: z.boolean(),
  productId: idSchema.nullable(),
  categories: z.array(z.object({ id: idSchema, depth: z.number().int() })),
  createdAt: z.string(),
  tiers: z.array(promoTierSchema),
});
export type Promotion = z.infer<typeof promotionSchema>;

/** One offer as the shop thinks of it, however many products and categories it covers. */
export const promotionGroupSchema = z.object({
  groupId: idSchema,
  name: z.string(),
  productIds: z.array(idSchema),
  /** Whole categories it covers, with whatever is under them. */
  categoryIds: z.array(idSchema),
  /** Everything it covers counts towards the quantity together. */
  mixMatch: z.boolean(),
  /** The underlying row ids. Read-only; the group is the handle. */
  promotionIds: z.array(idSchema),
  /** The shops this offer runs in (multi-shop). */
  shopIds: z.array(idSchema).optional(),
  /** On a save: shops that don't stock one of the products, so the offer doesn't apply there. */
  skipped: z.array(z.object({ shopId: idSchema, productId: idSchema })).optional(),
  tiers: z.array(promoTierSchema),
  active: z.boolean(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type PromotionGroup = z.infer<typeof promotionGroupSchema>;

/**
 * What the screen sends to save an offer. `groupId` absent = create, present = replace it wholesale.
 * Tiers are REPLACED, never merged, so removing one here actually removes it.
 */
export const promotionGroupInputSchema = z.object({
  groupId: idSchema.optional(),
  label: z.string().trim().min(2, 'Name the promotion'),
  productIds: z.array(idSchema),
  categoryIds: z.array(idSchema).optional(),
  mixMatch: z.boolean().optional(),
  /** Where it runs. Absent = the caller's own shop. */
  shopIds: z.array(idSchema).min(1).optional(),
  tiers: z.array(promoTierSchema).min(1, 'Add at least one tier'),
  active: z.boolean(),
});
export type PromotionGroupInput = z.infer<typeof promotionGroupInputSchema>;
