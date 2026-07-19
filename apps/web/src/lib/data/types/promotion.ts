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
  /** "…and each one costs this" (pence). */
  unitPrice: moneySchema.positive('Enter the unit price'),
});
export type PromoTier = z.infer<typeof promoTierSchema>;

export const promotionInputSchema = z.object({
  name: z.string().trim().min(2, 'Name the promotion'),
  /** The catalogue product this applies to. */
  productId: idSchema,
  tiers: z.array(promoTierSchema).min(1, 'Add at least one tier'),
  active: z.boolean(),
});
export type PromotionInput = z.infer<typeof promotionInputSchema>;

export const promotionSchema = promotionInputSchema.extend({
  id: idSchema,
  createdAt: isoDateTimeSchema,
});
export type Promotion = z.infer<typeof promotionSchema>;

/** Unit price for a quantity under a promotion (best matching tier, if any). */
export function promoUnitPrice(promo: Promotion, quantity: number): number | null {
  const eligible = promo.tiers
    .filter((t) => quantity >= t.minQty)
    .sort((a, b) => b.minQty - a.minQty);
  return eligible[0]?.unitPrice ?? null;
}
