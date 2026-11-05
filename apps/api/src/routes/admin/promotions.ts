import type { Request } from 'express';
import { attempt, db, rpc, sql } from '../../lib/db.js';
import { isUuid } from '../../lib/uuid.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { formatTierPriceError } from '../../lib/friendlyDbErrors.js';
import { loadPromoRules } from '../../lib/promotions.js';
import { promotionGroupBodySchema } from '../../schemas.js';
import { createRouter } from '../../lib/router.js';
import { canRead, canWrite, readShop, tillShop, writeShop } from '../../lib/shopScope.js';

export const adminPromotionsRouter = createRouter();
const router = adminPromotionsRouter;

/* ---------------------------------------------------------------------- */
/* Promotions — till-only. One offer is the rows sharing a group_id: one    */
/* per product and one per category it covers (0022, 0126).                 */
/* ---------------------------------------------------------------------- */

interface TierOut {
  minQty: number;
  totalPrice: number;
  unitPrice: number;
}

/** Every tier for these rows, in one query, grouped by row. */
async function tiersFor(promotionIds: string[]) {
  const byPromotion = new Map<string, TierOut[]>();
  if (promotionIds.length === 0) return byPromotion;
  const rows = await db
    .selectFrom('promo_tiers')
    .select([
      'promotion_id',
      'min_qty',
      'unit_price',
      sql<number>`coalesce(total_price, unit_price * min_qty)`.as('total_price'),
    ])
    .where('promotion_id', 'in', promotionIds)
    .orderBy('min_qty')
    .execute();
  for (const t of rows) {
    const list = byPromotion.get(t.promotion_id) ?? [];
    list.push({ minQty: t.min_qty, totalPrice: Number(t.total_price), unitPrice: t.unit_price });
    byPromotion.set(t.promotion_id, list);
  }
  return byPromotion;
}

/**
 * The offers running at the caller's till, for pricing the ticket on screen. Gated on `pos.operate`,
 * deliberately NOT `promotions.manage`: every till operator has to price a sale correctly, and
 * `promotions.manage` still gates every write. An employee can see prices, not set them.
 */
router.get('/promotions', requireStaff, requirePermission('pos.operate'), async (req, res) => {
  return res.json(await loadPromoRules(tillShop(req)));
});

const groupColumns = [
  'id',
  'group_id',
  'product_id',
  'category_id',
  'label',
  'is_active',
  'mix_match',
  'starts_at',
  'ends_at',
  'created_at',
] as const;

/** Which shops each of these rows runs in. */
async function shopsFor(promotionIds: string[]) {
  const byPromotion = new Map<string, string[]>();
  if (promotionIds.length === 0) return byPromotion;
  const rows = await db
    .selectFrom('promotion_shops')
    .select(['promotion_id', 'shop_id'])
    .where('promotion_id', 'in', promotionIds)
    .execute();
  for (const r of rows) {
    byPromotion.set(r.promotion_id, [...(byPromotion.get(r.promotion_id) ?? []), r.shop_id]);
  }
  return byPromotion;
}

type GroupRow = {
  id: string;
  group_id: string;
  product_id: string | null;
  category_id: string | null;
  label: string | null;
  is_active: boolean;
  mix_match: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
};

function toApiGroup(rows: GroupRow[], shopIds: string[], tiers: TierOut[]) {
  const head = rows[0]!;
  return {
    groupId: head.group_id,
    name: head.label ?? '',
    productIds: rows.flatMap((r) => (r.product_id ? [r.product_id] : [])),
    categoryIds: rows.flatMap((r) => (r.category_id ? [r.category_id] : [])),
    mixMatch: head.mix_match,
    promotionIds: rows.map((r) => r.id),
    shopIds,
    tiers,
    active: head.is_active,
    startsAt: head.starts_at,
    endsAt: head.ends_at,
    createdAt: head.created_at,
  };
}

/**
 * Every offer, one per group — the admin screen's list. An offer is listed with the rows of the
 * shop being viewed, but says which shops it runs in across every shop the caller can see or change
 * (so an owner on one shop still sees the ticks).
 */
async function listApiPromotionGroups(shopId: string | null, req: Request) {
  const allRows = (await db
    .selectFrom('promotions')
    .select(groupColumns)
    .orderBy('created_at', 'desc')
    .execute()) as GroupRow[];
  const shops = await shopsFor(allRows.map((r) => r.id));
  const reach = (id: string) => canRead(req, id) || canWrite(req, id);

  const shopsByGroup = new Map<string, Set<string>>();
  for (const r of allRows) {
    const set = shopsByGroup.get(r.group_id) ?? new Set<string>();
    for (const s of shops.get(r.id) ?? []) if (reach(s)) set.add(s);
    shopsByGroup.set(r.group_id, set);
  }
  const rows = allRows.filter((r) => !shopId || (shops.get(r.id) ?? []).includes(shopId));

  const groups = new Map<string, GroupRow[]>();
  for (const row of rows) {
    const existing = groups.get(row.group_id);
    if (existing) existing.push(row);
    else groups.set(row.group_id, [row]);
  }

  // Every row in a group carries the same label, tiers and window, so one row answers for it.
  const tiers = await tiersFor([...groups.values()].map((g) => g[0]!.id));
  return [...groups.values()].map((g) =>
    toApiGroup(g, [...(shopsByGroup.get(g[0]!.group_id) ?? [])], tiers.get(g[0]!.id) ?? []),
  );
}

router.get(
  '/promotions/groups',
  requireStaff,
  requirePermission('promotions.manage'),
  async (req, res) => {
    return res.json(await listApiPromotionGroups(readShop(req), req));
  },
);

/** May this caller see (or, with write, change) the offer? Judged by the shops it runs in. */
async function groupVisible(req: Request, groupId: string, write: boolean): Promise<boolean> {
  if (!isUuid(groupId)) return false;
  const rows = await db
    .selectFrom('promotions')
    .innerJoin('promotion_shops', 'promotion_shops.promotion_id', 'promotions.id')
    .select('promotion_shops.shop_id')
    .where('promotions.group_id', '=', groupId)
    .execute();
  if (rows.length === 0) return true; // nothing there: the caller's own 404 / create path handles it
  // An offer running in several shops: seen by anyone who can see one of them, but changed or
  // removed only by someone who can change every one.
  return write
    ? rows.every((r) => canWrite(req, r.shop_id))
    : rows.some((r) => canRead(req, r.shop_id));
}

async function toApiPromotionGroup(groupId: string, req: Request) {
  if (!isUuid(groupId)) return null;
  const allRows = (await db
    .selectFrom('promotions')
    .select(groupColumns)
    .where('group_id', '=', groupId)
    .orderBy('created_at', 'asc')
    .execute()) as GroupRow[];
  const shops = await shopsFor(allRows.map((r) => r.id));
  const reach = (id: string) => canRead(req, id) || canWrite(req, id);
  const rows = allRows.filter((r) => (shops.get(r.id) ?? []).some(reach));
  const head = rows[0];
  if (!head) return null;
  const tiers = await tiersFor([head.id]);
  const shopIds = [...new Set(rows.flatMap((r) => shops.get(r.id) ?? []))].filter(reach);
  return toApiGroup(rows, shopIds, tiers.get(head.id) ?? []);
}

/**
 * Create or replace a whole offer in one transaction (save_promotion_offer, 0126), so a failure can
 * never leave a range half at bulk prices. `created_by` comes from the session, never the body.
 */
router.post(
  '/promotions/bulk',
  requireStaff,
  requirePermission('promotions.manage'),
  async (req, res) => {
    const parsed = promotionGroupBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;
    const ownShop = await writeShop(req, res);
    if (!ownShop) return;
    if (body.groupId && !(await groupVisible(req, body.groupId, true))) {
      return res.status(404).json({ error: 'Promotion not found.' });
    }

    // Where the offer runs. Anyone may run one in their own shop; only the owner may name others.
    const targetShops = [...new Set(body.shopIds ?? [ownShop])];
    if (req.user!.staffRole !== 'owner' && targetShops.some((id) => id !== ownShop)) {
      return res.status(403).json({ error: 'Only the owner can run an offer in other shops.' });
    }
    const openShops = await db
      .selectFrom('shops')
      .select('id')
      .where('id', 'in', targetShops)
      .where('is_active', '=', true)
      .execute();
    if (openShops.length !== targetShops.length) {
      return res.status(400).json({ error: 'One of those shops does not exist or is closed.' });
    }

    // Each chosen shop prices its OWN copy of every product, found through the master list.
    const expanded = new Set<string>();
    const skipped: { shopId: string; productId: string }[] = [];
    if (body.productIds.length > 0) {
      const picked = await db
        .selectFrom('products')
        .select(['id', 'shop_id', 'master_product_id'])
        .where('id', 'in', body.productIds)
        .execute();
      if (picked.length !== new Set(body.productIds).size) {
        return res.status(400).json({ error: 'One of those products no longer exists.' });
      }
      const masters = [
        ...new Set(picked.map((p) => p.master_product_id).filter(Boolean)),
      ] as string[];
      const copies = masters.length
        ? await db
            .selectFrom('products')
            .select(['id', 'shop_id', 'master_product_id'])
            .where('master_product_id', 'in', masters)
            .where('shop_id', 'in', targetShops)
            .execute()
        : [];
      for (const shop of targetShops) {
        for (const p of picked) {
          const copy =
            p.shop_id === shop
              ? p.id
              : copies.find(
                  (c) => c.shop_id === shop && c.master_product_id === p.master_product_id,
                )?.id;
          if (copy) expanded.add(copy);
          else skipped.push({ shopId: shop, productId: p.id });
        }
      }
      if (expanded.size === 0 && body.categoryIds.length === 0) {
        return res
          .status(400)
          .json({ error: 'None of those products are stocked in the chosen shops.' });
      }
    }

    const { data: groupId, error } = await attempt(() =>
      rpc<string>('save_promotion_offer', {
        p_product_ids: [...expanded],
        p_category_ids: body.categoryIds,
        p_tiers: body.tiers,
        p_shop_ids: targetShops,
        p_group_id: body.groupId ?? null,
        p_label: body.label ?? null,
        p_active: body.active,
        p_mix_match: body.mixMatch,
        p_starts_at: body.startsAt ?? null,
        p_ends_at: body.endsAt ?? null,
        p_created_by: req.user!.id,
      }),
    );

    // Every guard in the function raises, so nothing was written, and each message is already plain
    // English except the negative-price one, which formatTierPriceError rewrites.
    if (error) {
      return res.status(400).json({ error: formatTierPriceError(error.message) ?? error.message });
    }

    const group = await toApiPromotionGroup(groupId, req);
    if (!group) return res.status(500).json({ error: 'Promotion did not save.' });
    return res.status(body.groupId ? 200 : 201).json({ ...group, skipped });
  },
);

/** One offer, by its group id. */
router.get(
  '/promotions/group/:groupId',
  requireStaff,
  requirePermission('promotions.manage'),
  async (req, res) => {
    const group = await toApiPromotionGroup(req.params.groupId ?? '', req);
    if (!group || !(await groupVisible(req, group.groupId, false))) {
      return res.status(404).json({ error: 'Promotion not found.' });
    }
    return res.json(group);
  },
);

/**
 * Removes a whole offer in one statement, so it can't stop part-way with some products still at the
 * offer price. `promo_tiers` and `promotion_shops` cascade.
 */
router.delete(
  '/promotions/group/:groupId',
  requireStaff,
  requirePermission('promotions.manage'),
  async (req, res) => {
    if (!(await groupVisible(req, req.params.groupId ?? '', true))) {
      return res.status(404).json({ error: 'Promotion not found.' });
    }
    const { data, error } = await attempt(() =>
      db
        .deleteFrom('promotions')
        .where('group_id', '=', req.params.groupId ?? '')
        .returning('id')
        .execute(),
    );
    if (error) return res.status(400).json({ error: error.message });
    if (data.length === 0) {
      return res.status(404).json({ error: 'Promotion not found.' });
    }
    return res.status(204).end();
  },
);
