import { db, sql } from './db.js';
import type { PromoRule } from './promoPricing.js';

/** Every offer running right now in `shopId`, ready for priceBasket (lib/promoPricing.ts). */
export async function loadPromoRules(shopId: string | null): Promise<PromoRule[]> {
  if (!shopId) return [];
  const rows = await db
    .selectFrom('promotions')
    .innerJoin('promotion_shops', 'promotion_shops.promotion_id', 'promotions.id')
    .select([
      'promotions.id',
      'promotions.group_id',
      'promotions.product_id',
      'promotions.category_id',
      'promotions.mix_match',
      'promotions.created_at',
    ])
    .where('promotion_shops.shop_id', '=', shopId)
    .where('promotions.is_active', '=', true)
    .where((eb) =>
      eb.or([
        eb('promotions.starts_at', 'is', null),
        eb('promotions.starts_at', '<=', sql<string>`now()`),
      ]),
    )
    .where((eb) =>
      eb.or([
        eb('promotions.ends_at', 'is', null),
        eb('promotions.ends_at', '>', sql<string>`now()`),
      ]),
    )
    .execute();
  if (rows.length === 0) return [];

  const tierRows = await db
    .selectFrom('promo_tiers')
    .select([
      'promotion_id',
      'min_qty',
      sql<number>`coalesce(total_price, unit_price * min_qty)`.as('total_price'),
    ])
    .where(
      'promotion_id',
      'in',
      rows.map((r) => r.id),
    )
    .execute();

  const childrenOf = new Map<string, string[]>();
  if (rows.some((r) => r.category_id)) {
    const categories = await db.selectFrom('categories').select(['id', 'parent_id']).execute();
    for (const c of categories) {
      if (!c.parent_id) continue;
      childrenOf.set(c.parent_id, [...(childrenOf.get(c.parent_id) ?? []), c.id]);
    }
  }
  const reach = (root: string) => {
    const found: { id: string; depth: number }[] = [];
    const walk = (id: string, depth: number) => {
      found.push({ id, depth });
      for (const child of childrenOf.get(id) ?? []) walk(child, depth + 1);
    };
    walk(root, 0);
    return found;
  };

  return rows.map((r) => ({
    groupId: r.group_id,
    mixMatch: r.mix_match,
    productId: r.product_id,
    categories: r.category_id ? reach(r.category_id) : [],
    createdAt: String(r.created_at),
    tiers: tierRows
      .filter((t) => t.promotion_id === r.id)
      .map((t) => ({ minQty: t.min_qty, totalPrice: Number(t.total_price) })),
  }));
}
