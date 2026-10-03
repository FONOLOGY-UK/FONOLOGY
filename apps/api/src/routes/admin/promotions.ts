import type { Request } from 'express';
import { attempt, db, rpc } from '../../lib/db.js';
import { isUuid } from '../../lib/uuid.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { formatTierPriceError } from '../../lib/friendlyDbErrors.js';
import { promotionGroupBodySchema } from '../../schemas.js';
import { createRouter } from '../../lib/router.js';
import { canRead, canWrite, readShop, writeShop } from '../../lib/shopScope.js';

export const adminPromotionsRouter = createRouter();
const router = adminPromotionsRouter;

/* ---------------------------------------------------------------------- */
/* Promotions — till-only, same-product bulk tiers                          */
/* ---------------------------------------------------------------------- */

/**
 * Every promotion, with its tiers — in TWO queries total, not two per row.
 *
 * Same fix as `listApiPromotionGroups()` below, applied to this flat
 * endpoint: the per-row version fetched `promo_tiers` once per promotion, so
 * a shop with N active promotions issued N+1 queries for one till page load.
 * Fetch every row's tiers in a single `.in(...)` and group them in memory
 * instead — one definition of "batch these" duplicated on purpose (a shared
 * helper here would need to reconcile this function's flat one-row-per-
 * promotion shape with that one's grouped-by-group_id shape, which is more
 * indirection than the four lines below are worth).
 */
/** Every tier for these promotions, in one query, grouped by promotion. */
async function tiersFor(promotionIds: string[]) {
  const tiersByPromotion = new Map<string, { minQty: number; unitPrice: number }[]>();
  if (promotionIds.length === 0) return tiersByPromotion;
  const tierRows = await db
    .selectFrom('promo_tiers')
    .select(['promotion_id', 'min_qty', 'unit_price'])
    .where('promotion_id', 'in', promotionIds)
    .orderBy('min_qty')
    .execute();
  for (const t of tierRows) {
    const list = tiersByPromotion.get(t.promotion_id) ?? [];
    list.push({ minQty: t.min_qty, unitPrice: t.unit_price });
    tiersByPromotion.set(t.promotion_id, list);
  }
  return tiersByPromotion;
}

async function toApiPromotions(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return [];
  const tiersByPromotion = await tiersFor(rows.map((r) => r.id as string));

  return rows.map((row) => ({
    id: row.id,
    name: row.label ?? '',
    productIds: [row.product_id], // schema: one promotion row is scoped to one product
    tiers: tiersByPromotion.get(row.id as string) ?? [],
    active: row.is_active,
    createdAt: row.created_at,
  }));
}

/**
 * Gated on `pos.operate`, deliberately NOT `promotions.manage` — this route's
 * own section header says it: promotions are till-only, so every till
 * operator needs to read the current tiers to price a sale correctly, not
 * just whoever can create/edit them. `promotions.manage` still gates every
 * write (POST /promotions/bulk, the group routes below) — an employee can
 * see prices, not set them.
 *
 * Root cause of the "till doesn't apply promotions" report: this route used
 * to require `promotions.manage`, which the DB's default_permissions() (see
 * 0002_identity.sql) only grants to the owner role. Every non-owner till
 * operator got a 403 from usePromotions(), so `priceFor()` in pos-view.tsx
 * never saw a tier to apply — not a pricing bug, an authorization one.
 */
router.get('/promotions', requireStaff, requirePermission('pos.operate'), async (req, res) => {
  // A promotion runs in the shop of the product it prices.
  const shopId = readShop(req);
  const data = await db
    .selectFrom('promotions')
    .innerJoin('products', 'products.id', 'promotions.product_id')
    .selectAll('promotions')
    .$if(!!shopId, (qb) => qb.where('products.shop_id', '=', shopId!))
    .orderBy('promotions.created_at', 'desc')
    .execute();
  return res.json(await toApiPromotions(data));
});

/**
 * Every promotion, grouped — the admin screen's list.
 *
 * The flat GET above stays because the till needs it: one row per product is
 * exactly the shape a per-product price lookup wants. This one answers the
 * other question ("what offers has the shop set up?"), where a range covering
 * six products is one offer, not six.
 *
 * Two queries total, not two per group: the rows come back in one pass and the
 * tiers for every group head in a second.
 */
async function listApiPromotionGroups(shopId: string | null, req: Request) {
  const allRows = await db
    .selectFrom('promotions')
    .innerJoin('products', 'products.id', 'promotions.product_id')
    .select([
      'promotions.id',
      'promotions.group_id',
      'promotions.product_id',
      'promotions.label',
      'promotions.is_active',
      'promotions.starts_at',
      'promotions.ends_at',
      'promotions.created_at',
      'products.shop_id',
    ])
    .orderBy('promotions.created_at', 'desc')
    .execute();

  // An offer is listed with the products of the shop being viewed, but says which shops it runs
  // in across every shop the caller can see or change (so an owner on one shop still sees the ticks).
  const reach = (id: string) => canRead(req, id) || canWrite(req, id);
  const shopsByGroup = new Map<string, Set<string>>();
  for (const r of allRows) {
    if (!reach(r.shop_id)) continue;
    const set = shopsByGroup.get(r.group_id) ?? new Set<string>();
    set.add(r.shop_id);
    shopsByGroup.set(r.group_id, set);
  }
  const rows = allRows.filter((r) => !shopId || r.shop_id === shopId);

  // Preserve first-seen order (created_at desc) while collecting each group.
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.group_id;
    const existing = groups.get(key);
    if (existing) existing.push(row);
    else groups.set(key, [row]);
  }

  // Every row in a group carries the same label/active/window, so one row per
  // group answers for it — and only that row's tiers need reading.
  const heads = [...groups.values()].map((g) => g[0]!);
  const tiersByPromotion = await tiersFor(heads.map((h) => h.id));

  return heads.map((head) => {
    const rowsInGroup = groups.get(head.group_id)!;
    return {
      groupId: head.group_id,
      name: head.label ?? '',
      productIds: rowsInGroup.map((r) => r.product_id),
      promotionIds: rowsInGroup.map((r) => r.id),
      // The shops this offer runs in (among those the caller can see).
      shopIds: [...(shopsByGroup.get(head.group_id) ?? [])],
      tiers: tiersByPromotion.get(head.id) ?? [],
      active: head.is_active,
      startsAt: head.starts_at,
      endsAt: head.ends_at,
      createdAt: head.created_at,
    };
  });
}

router.get(
  '/promotions/groups',
  requireStaff,
  requirePermission('promotions.manage'),
  async (req, res) => {
    return res.json(await listApiPromotionGroups(readShop(req), req));
  },
);

/** May this caller see (or, with write, change) the promotion group? Judged by the shop of its products. */
async function groupVisible(req: Request, groupId: string, write: boolean): Promise<boolean> {
  if (!isUuid(groupId)) return false;
  const rows = await db
    .selectFrom('promotions')
    .innerJoin('products', 'products.id', 'promotions.product_id')
    .select('products.shop_id')
    .where('promotions.group_id', '=', groupId)
    .execute();
  if (rows.length === 0) return true; // nothing there: the caller's own 404 / create path handles it
  // An offer running in several shops: seen by anyone who can see one of them, but changed or
  // removed only by someone who can change every one.
  return write
    ? rows.every((r) => canWrite(req, r.shop_id))
    : rows.some((r) => canRead(req, r.shop_id));
}

/**
 * One promotion as the admin screen thinks of it: the rows sharing a
 * `group_id`, collapsed back into a single object with a product list.
 */
async function toApiPromotionGroup(groupId: string, req: Request) {
  if (!isUuid(groupId)) return null;
  const allRows = await db
    .selectFrom('promotions')
    .innerJoin('products', 'products.id', 'promotions.product_id')
    .select([
      'promotions.id',
      'promotions.product_id',
      'promotions.label',
      'promotions.is_active',
      'promotions.starts_at',
      'promotions.ends_at',
      'promotions.created_at',
      'products.shop_id',
    ])
    .where('promotions.group_id', '=', groupId)
    .orderBy('promotions.created_at', 'asc')
    .execute();
  // What the caller can see or change (an owner looking at one shop still sees the rest of an
  // offer they can edit).
  const rows = allRows.filter((r) => canRead(req, r.shop_id) || canWrite(req, r.shop_id));

  // Every row in a group carries the same label/active/window — the function
  // writes them together — so the first row answers for all of them.
  const head = rows[0];
  if (!head) return null;
  const tiers = await db
    .selectFrom('promo_tiers')
    .select(['min_qty', 'unit_price'])
    .where('promotion_id', '=', head.id)
    .orderBy('min_qty')
    .execute();

  return {
    groupId,
    name: head.label ?? '',
    productIds: rows.map((r) => r.product_id),
    promotionIds: rows.map((r) => r.id),
    shopIds: [...new Set(rows.map((r) => r.shop_id))],
    tiers: tiers.map((t) => ({ minQty: t.min_qty, unitPrice: t.unit_price })),
    active: head.is_active,
    startsAt: head.starts_at,
    endsAt: head.ends_at,
    createdAt: head.created_at,
  };
}

/**
 * Create or replace a whole promotion in one transaction.
 *
 * The per-row POST below still exists and still loops — but a loop of
 * independent inserts is not a transaction: a failure partway leaves earlier
 * products already live at bulk prices and later ones at shelf prices, on
 * real sales. `upsert_promotion_group()` (0022) does the whole edit inside
 * one function body, so it either all applies or none of it does.
 *
 * `created_by` comes from the session, never the body.
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
    const expanded = new Set<string>();
    const skipped: { shopId: string; productId: string }[] = [];
    for (const shop of targetShops) {
      for (const p of picked) {
        const copy =
          p.shop_id === shop
            ? p.id
            : copies.find((c) => c.shop_id === shop && c.master_product_id === p.master_product_id)
                ?.id;
        if (copy) expanded.add(copy);
        else skipped.push({ shopId: shop, productId: p.id });
      }
    }
    if (expanded.size === 0) {
      return res
        .status(400)
        .json({ error: 'None of those products are stocked in the chosen shops.' });
    }

    const { data: groupId, error } = await attempt(() =>
      rpc<string>('upsert_promotion_group', {
        p_shop_ids: targetShops,
        p_product_ids: [...expanded],
        p_tiers: body.tiers,
        p_group_id: body.groupId ?? null,
        p_label: body.label ?? null,
        p_active: body.active,
        p_starts_at: body.startsAt ?? null,
        p_ends_at: body.endsAt ?? null,
        p_created_by: req.user!.id,
      }),
    );

    // Every guard in the function raises, so nothing was written. Every
    // message except one is already plain English with nothing to reword
    // (no product, a duplicate, a missing product, a bad quantity, a
    // quantity clash) — passed through unchanged. The one exception is the
    // negative-tier-price guard, which echoes a raw pence value with no
    // currency symbol (batch 2 item C); formatTierPriceError rewrites only
    // that specific message and returns null for every other one, so
    // nothing else here is at risk of being overwritten with a wrong
    // canned sentence.
    if (error) {
      return res.status(400).json({ error: formatTierPriceError(error.message) ?? error.message });
    }

    const group = await toApiPromotionGroup(groupId, req);
    if (!group) return res.status(500).json({ error: 'Promotion did not save.' });
    return res.status(body.groupId ? 200 : 201).json({ ...group, skipped });
  },
);

/** One promotion, by its group id — the read side of the bulk endpoint. */
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
 * Removes a whole promotion — every product row sharing the group id.
 *
 * One statement, so it is all-or-nothing for the same reason the bulk upsert
 * is: deleting a group product-by-product could leave some products still
 * priced at the offer and others back at shelf price, mid-trade.
 * `promo_tiers` cascades from `promotions`.
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
