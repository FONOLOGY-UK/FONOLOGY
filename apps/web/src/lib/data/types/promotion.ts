import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common';
import { moneySchema } from './pricing';

/**
 * Promotions — tiered bulk pricing (item 7, Promotions module).
 *
 * IN-STORE / WALK-IN ONLY, per the brief: these price breaks are applied at
 * the counter (POS, item 8). The storefront NEVER reads this table — online
 * prices are always the product's listed price. This is a deliberate business
 * rule, not a gap.
 */

export const promoTierSchema = z.object({
  /** "Buy this many or more…" */
  minQty: z.number().int().min(2, 'Bulk pricing starts at 2+'),
  /**
   * "…and each one costs this" (pence).
   *
   * Non-negative, not positive: 0p is a real offer (buy-two-get-one-free
   * prices the third at nothing) and `promo_tiers.unit_price` allows it.
   * Negative would be the shop paying the customer to take stock away.
   */
  unitPrice: moneySchema.nonnegative('A tier price cannot be negative'),
});
export type PromoTier = z.infer<typeof promoTierSchema>;

export const promotionInputSchema = z.object({
  name: z.string().trim().min(2, 'Name the promotion'),
  /**
   * The catalogue products this applies to. A promotion can cover MANY
   * products so the counter doesn't need one promotion per SKU — e.g. one
   * "Any 2 screen protectors at £12 each" across the whole glass range.
   *
   * The tier quantity is per-product, not a mixed basket: buying 2 of the
   * SAME covered product hits the tier. Mixing 1+1 across two covered
   * products does NOT — that is a basket/bundle rule and is a separate
   * feature (flagged in NOTES.md as an open question).
   */
  productIds: z.array(idSchema).min(1, 'Pick at least one product'),
  tiers: z.array(promoTierSchema).min(1, 'Add at least one tier'),
  active: z.boolean(),
});
export type PromotionInput = z.infer<typeof promotionInputSchema>;

export const promotionSchema = promotionInputSchema.extend({
  id: idSchema,
  createdAt: isoDateTimeSchema,
});
export type Promotion = z.infer<typeof promotionSchema>;

/* ---- promotion groups (the admin screen's model) --------------------------- */

/**
 * One offer as the shop thinks of it.
 *
 * The database stores one `promotions` row per product; rows written together
 * share a `group_id`. That is the right shape for the till (a per-product
 * price lookup) and the wrong shape for the admin screen, where "2+ of any
 * screen protector at £12" is ONE offer covering six products, not six
 * offers. This type is that single offer; `groupId` is the identity.
 *
 * Tiers still apply per product — buying 2 of the SAME covered product hits
 * the tier. Mixing one of each does not, and there is deliberately no way to
 * express a mixed-basket offer here, because the till doesn't implement one.
 */
export const promotionGroupSchema = z.object({
  groupId: idSchema,
  name: z.string(),
  productIds: z.array(idSchema),
  /** The underlying per-product row ids. Read-only; the group is the handle. */
  promotionIds: z.array(idSchema),
  tiers: z.array(promoTierSchema),
  active: z.boolean(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type PromotionGroup = z.infer<typeof promotionGroupSchema>;

/**
 * What the screen sends to save an offer. `groupId` absent = create, present
 * = replace that offer wholesale.
 *
 * Tiers are REPLACED, never merged: the list sent is the list that ends up
 * stored, so removing a tier here actually removes it. A merge would make
 * removal impossible to express.
 */
export const promotionGroupInputSchema = z.object({
  groupId: idSchema.optional(),
  label: z.string().trim().min(2, 'Name the promotion'),
  productIds: z.array(idSchema).min(1, 'Pick at least one product'),
  tiers: z.array(promoTierSchema).min(1, 'Add at least one tier'),
  active: z.boolean(),
});
export type PromotionGroupInput = z.infer<typeof promotionGroupInputSchema>;

/** Unit price for a quantity under a promotion (best matching tier, if any). */
export function promoUnitPrice(promo: Promotion, quantity: number): number | null {
  const eligible = promo.tiers
    .filter((t) => quantity >= t.minQty)
    .sort((a, b) => b.minQty - a.minQty);
  return eligible[0]?.unitPrice ?? null;
}

/** The active promotion covering a product, if any. */
export function promotionFor(
  promotions: Promotion[] | undefined,
  productId: string,
): Promotion | undefined {
  return promotions?.find((p) => p.active && p.productIds.includes(productId));
}
