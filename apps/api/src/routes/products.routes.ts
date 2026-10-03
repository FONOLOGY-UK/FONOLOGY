import { z } from 'zod';
import { attempt, db, rpc } from '../lib/db.js';
import { isUuid } from '../lib/uuid.js';
import { artForCategory, DEFAULT_TILE, filterValidImageUrls } from '../lib/productMapping.js';

import { cachePublicGets } from '../middleware/cache.js';
import { createRouter } from '../lib/router.js';

export const productsRouter = createRouter();
export const categoriesRouter = createRouter();

/**
 * Every customer-facing product query selects EXACTLY this column list —
 * never `stock_qty`, never `cost_price`. Not "strip it from the response
 * later": those columns are never fetched into this code path at all, so
 * there is no value to accidentally leak.
 *
 * `category` (the enum) is frozen as of migration 0045 — category_id is the
 * source of truth now, embedded here via the FK to categories so the
 * customer-facing shape can keep returning a plain slug string (`category`)
 * without any code elsewhere having to change: URLs, the shop's filter
 * query param, and this response's own `category` field all stay slugs.
 */
function customerProducts() {
  return db
    .selectFrom('products')
    .leftJoin('categories', 'categories.id', 'products.category_id')
    .select([
      'products.id',
      'products.slug',
      'products.name',
      'products.sub',
      'products.description',
      'products.category_id',
      'categories.slug as category_slug',
      'products.kind',
      'products.price',
      'products.created_at',
      'products.tag',
      'products.compatibility',
      'products.has_variants',
    ]);
}

const listQuerySchema = z.object({
  category: z.string().optional(),
  search: z.string().optional(),
  sort: z.enum(['featured', 'price-asc', 'price-desc']).optional(),
});

interface ProductRow {
  id: string;
  slug: string;
  name: string;
  sub: string | null;
  description: string | null;
  category_id: string;
  category_slug: string | null;
  kind: string;
  price: number;
  created_at: string;
  tag: string | null;
  compatibility: string | null;
  has_variants: boolean;
}

/**
 * Stock status via the schema's own `stock_status_for()` — never re-derived
 * here, so the three-state rule (never a count) stays enforced in exactly one
 * place. Used for a SINGLE product; lists go through
 * `stock_status_for_many()` below, which delegates to this same function.
 */
async function stockStatusFor(
  productId: string,
): Promise<'in-stock' | 'out-of-stock' | 'restocking'> {
  return rpc<'in-stock' | 'out-of-stock' | 'restocking'>('stock_status_for', {
    p_product_id: productId,
  });
}

async function imagesFor(productId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('product_images')
    .select('url')
    .where('product_id', '=', productId)
    .orderBy('position', 'asc')
    .execute();
  return rows.map((row) => row.url);
}

type StockStatus = 'in-stock' | 'out-of-stock' | 'restocking';

interface CustomerVariant {
  id: string;
  options: Record<string, string>;
  priceAdjustment: number;
  stockStatus: StockStatus;
}

/** Shapes one row once its stock status and images are already in hand. */
function buildCustomerProduct(
  row: ProductRow,
  stockStatus: StockStatus,
  images: string[],
  variants?: CustomerVariant[],
) {
  // Defensive only — category_id is NOT NULL with an ON DELETE RESTRICT FK
  // (0045), so a row with no matching category should never actually occur.
  const category = row.category_slug ?? '';
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    sub: row.sub ?? '',
    category,
    kind: row.kind,
    price: row.price,
    stockStatus,
    // Round 5 #17: real columns now (0054_product_badge_compat_buyin.sql) —
    // this used to hardcode both to null regardless of what was saved.
    tag: row.tag ?? null,
    compatibility: row.compatibility ?? null,
    description: row.description ?? '',
    highlights: [] as string[],
    specs: [] as { label: string; value: string }[],
    // BUG-01, belt and braces — see filterValidImageUrls's own comment. The
    // write side (productInputBodySchema) is the real fix; this is what
    // stops one bad row (any way it got there) from failing the whole
    // customer-facing list's parse, product-by-product, not all-or-nothing.
    images: filterValidImageUrls(images),
    art: artForCategory(category),
    tile: DEFAULT_TILE,
    // Round 5 Phase 4 #16: sent on every response (list and single) — the
    // grid card needs this cheap flag even without the full variants
    // payload, so a "quick add" never adds the parent at its meaningless
    // base price with nothing picked.
    hasVariants: row.has_variants,
    // Only ever present on the single-product read (the PDP, where a
    // picker is actually shown) — omitted from the list/card response,
    // which has no use for it. Never cost/exact stock, same customer-facing
    // rule as the parent: three-state status, no numbers.
    variants,
  };
}

/**
 * One product, on its own — two (or three, for a has_variants product)
 * round trips is fine for a single row. Variants are fetched here, not in
 * the batched list path below, because only the PDP shows a picker — the
 * shop grid's card shows one price and one status regardless.
 */
async function toCustomerProduct(row: ProductRow) {
  const [stockStatus, images] = await Promise.all([stockStatusFor(row.id), imagesFor(row.id)]);

  if (!row.has_variants) {
    return buildCustomerProduct(row, stockStatus, images);
  }

  const variantRows = await db
    .selectFrom('product_variants')
    .select(['id', 'options', 'price_adjustment'])
    .where('product_id', '=', row.id)
    .where('is_active', '=', true)
    .execute();

  const variants: CustomerVariant[] = await Promise.all(
    variantRows.map(async (v) => ({
      id: v.id,
      options: v.options as Record<string, string>,
      priceAdjustment: v.price_adjustment,
      stockStatus: await rpc<StockStatus>('stock_status_for', {
        p_product_id: row.id,
        p_variant_id: v.id,
      }),
    })),
  );

  return buildCustomerProduct(row, stockStatus, images, variants);
}

/**
 * Many products, in TWO round trips rather than two per product.
 *
 * The per-row version above, mapped over the catalogue, meant 2N concurrent
 * requests to the database for one storefront page load — 88 at 44 products.
 * Beyond being wasteful, it made the endpoint fragile in a way that mattered:
 * a single one of those 88 failing rejected the whole `Promise.all` and took
 * the request down with it, which is exactly what happened under ordinary
 * network latency.
 *
 * The stock rule is still the database's: `stock_status_for_many` (0025)
 * delegates to the same `stock_status_for()` used above, so there remains one
 * definition of what "restocking" means.
 */
async function toCustomerProducts(rows: ProductRow[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [statuses, images] = await Promise.all([
    rpc<{ product_id: string; status: StockStatus }[]>(
      'stock_status_for_many',
      { p_product_ids: ids },
      { returnsSet: true },
    ),
    db
      .selectFrom('product_images')
      .select(['product_id', 'url'])
      .where('product_id', 'in', ids)
      .orderBy('position', 'asc')
      .execute(),
  ]);

  const statusById = new Map<string, StockStatus>();
  for (const row of statuses) {
    statusById.set(row.product_id, row.status);
  }

  const imagesById = new Map<string, string[]>();
  for (const row of images) {
    const list = imagesById.get(row.product_id) ?? [];
    list.push(row.url);
    imagesById.set(row.product_id, list);
  }

  return rows.map((row) =>
    buildCustomerProduct(
      row,
      // A product with no row back from the function isn't visible stock, so
      // fall back to the safe answer rather than claiming it's available.
      statusById.get(row.id) ?? 'out-of-stock',
      imagesById.get(row.id) ?? [],
    ),
  );
}

productsRouter.get('/', async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const { category, search, sort } = parsed.data;

  // Round 5 #9: `search` used to be plain `ilike '%term%'` on name/sub —
  // substring only, so a plural or a mistyped letter missed entirely.
  // `search_products()` (0055_product_search.sql) does the fuzzy matching
  // and hands back ranked ids; this stays a two-step fetch (rank the ids,
  // then select+filter the real rows) rather than trying to chain the
  // business-rule filters (is_active, in_store_only, category) directly
  // onto the RPC result, because the RPC's own ORDER BY relevance isn't
  // something PostgREST guarantees survives an outer filter/embed — a
  // second explicit query is one extra round trip, and at this catalog's
  // size that's free.
  let searchRankById: Map<string, number> | null = null;
  if (search) {
    const { data: ranked, error: searchError } = await attempt(() =>
      rpc<{ id: string; rank: number }[]>(
        'search_products',
        { p_term: search },
        { returnsSet: true },
      ),
    );
    if (searchError) return res.status(500).json({ error: 'Could not load products.' });
    searchRankById = new Map(ranked.map((r) => [r.id, r.rank]));
    // No matches at all — skip the rest of the query, same as an unknown
    // category slug below.
    if (searchRankById.size === 0) return res.json([]);
  }

  let query = customerProducts()
    .where('products.is_active', '=', true)
    // Sellable at the till, absent from the customer-facing catalogue (0044,
    // FEATURE-06) — admin/POS reads never apply this filter, only these two
    // customer-facing routes do.
    .where('products.in_store_only', '=', false);

  if (category && category !== 'all') {
    // `category` here is a slug (the customer-facing/URL contract, unchanged
    // by FEATURE-05) — resolve it to the real id first, since the underlying
    // column is category_id now.
    const { data: cat, error: catError } = await attempt(() =>
      db.selectFrom('categories').select('id').where('slug', '=', category).executeTakeFirst(),
    );
    if (catError) return res.status(500).json({ error: 'Could not load products.' });
    // An unknown slug matches nothing — same behaviour as before, when an
    // unrecognised enum value would have matched zero rows too.
    if (!cat) return res.json([]);
    query = query.where('products.category_id', '=', cat.id);
  }
  if (searchRankById) {
    query = query.where('products.id', 'in', [...searchRankById.keys()]);
  }

  if (sort === 'price-asc') query = query.orderBy('products.price', 'asc');
  else if (sort === 'price-desc') query = query.orderBy('products.price', 'desc');
  // A search with no explicit sort ranks by relevance (below, after the
  // fetch) rather than creation order — closer to what someone searching
  // actually wants. No search and no explicit sort keeps the old default.
  else if (!searchRankById) query = query.orderBy('products.created_at', 'asc');

  const { data, error } = await attempt(() => query.execute());
  if (error) return res.status(500).json({ error: 'Could not load products.' });

  // Relevance order, applied here rather than trusted from the RPC/embed
  // chain — see the comment above. No-op when a search wasn't the active
  // sort (searchRankById is null, or an explicit price sort already ran).
  const rows: ProductRow[] = data;
  if (searchRankById && sort !== 'price-asc' && sort !== 'price-desc') {
    const rankById = searchRankById;
    rows.sort((a, b) => (rankById.get(b.id) ?? 0) - (rankById.get(a.id) ?? 0));
  }

  return res.json(await toCustomerProducts(rows));
});

/**
 * The storefront's category filter. Used to be top-level only (parent_id is
 * null) — Round 5 #10 lifts that: every category, top-level and sub, comes
 * back now, so the shop's filter UI can surface a category's children as a
 * secondary row once picked, instead of subcategories being admin-only
 * organisation invisible to customers. `id` stays the SLUG, not
 * categories.id — the customer-facing/URL contract (GET
 * /products?category=..., the shop's own query state) was already a slug
 * and stays one. `parentId` is the parent's SLUG too (not its uuid), so the
 * frontend never needs a second lookup to build the hierarchy; top-level
 * rows carry `parentId: null`.
 */
categoriesRouter.get('/', cachePublicGets(60), async (_req, res) => {
  const { data: rows, error } = await attempt(() =>
    db
      .selectFrom('categories')
      .select(['id', 'slug', 'label', 'parent_id'])
      .orderBy('created_at', 'asc')
      .execute(),
  );
  if (error) return res.status(500).json({ error: 'Could not load categories.' });

  const slugById = new Map(rows.map((c) => [c.id, c.slug]));

  res.json([
    { id: 'all', label: 'Everything', parentId: null },
    ...rows.map((c) => ({
      id: c.slug,
      label: c.label,
      parentId: c.parent_id ? (slugById.get(c.parent_id) ?? null) : null,
    })),
  ]);
});

/**
 * Round 3 #4.1a: "can the bag actually hold this many" — checked before the
 * cart accepts a quantity, not only at final checkout where create_order()
 * already refuses an oversell (see the migrations README: "Overselling now
 * fails"). Deliberately a yes/no, never the real count — `stockStatus` on
 * the customer-facing product is already the three-state signal
 * (in-stock/out-of-stock/restocking) this shop shows publicly, and this
 * endpoint stays inside that same rule: it answers "is N available", not
 * "how many are left". Public, no auth — same as every other customer
 * catalogue read.
 */
/** The bag's own per-line ceiling, mirrored from product-detail's stepper. */
const MAX_BAG_QUANTITY = 10;

productsRouter.get('/:id/availability', async (req, res) => {
  const quantity = Number(req.query.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) {
    return res.status(400).json({ error: 'quantity must be a positive integer.' });
  }
  // Independent audit finding MED-01. Unbounded, this yes/no answer is a
  // stock ORACLE: binary-searching `quantity` returns the exact shelf count
  // of any product in a handful of requests, which is the number this route
  // deliberately refuses to return directly (see above) and that the
  // storefront's three-state stockStatus exists to avoid publishing.
  //
  // Capping at the bag's own ceiling (10 — product-detail's quantity
  // stepper) is what actually collapses that: the endpoint now answers only
  // questions the shopper's UI can genuinely ask, and the search space
  // reduces to what someone could learn anyway by putting 10 in a bag.
  //
  // NOT rate limited, deliberately. product-card fires this on every
  // add-to-bag, so a per-IP cap would start refusing ordinary shopping
  // (several items, one household, one address) long before it inconvenienced
  // a script — the wrong trade for a route whose worst case is now bounded.
  if (quantity > MAX_BAG_QUANTITY) {
    return res.status(400).json({ error: `quantity may not exceed ${MAX_BAG_QUANTITY}.` });
  }
  // Round 5 Phase 4 #16: a has_variants product's own stock_qty is frozen
  // and unused (0060) — "can the bag hold this many" has to check the named
  // VARIANT's stock, not the parent's, whenever one is given.
  const variantId = typeof req.query.variantId === 'string' ? req.query.variantId : undefined;

  // A malformed id is simply not available, as it was when the lookup failed.
  const productId = req.params.id ?? '';
  const data = isUuid(productId)
    ? await db
        .selectFrom('products')
        .select(['stock_qty', 'is_active', 'in_store_only'])
        .where('id', '=', productId)
        .executeTakeFirst()
    : undefined;
  if (!data || !data.is_active || data.in_store_only) return res.json({ available: false });

  if (variantId) {
    const variant = isUuid(variantId)
      ? await db
          .selectFrom('product_variants')
          .select(['stock_qty', 'is_active'])
          .where('id', '=', variantId)
          .where('product_id', '=', productId)
          .executeTakeFirst()
      : undefined;
    const available = Boolean(variant && variant.is_active && variant.stock_qty >= quantity);
    return res.json({ available });
  }

  return res.json({ available: data.stock_qty >= quantity });
});

productsRouter.get('/:slug', async (req, res) => {
  const { data, error } = await attempt(() =>
    customerProducts()
      .where('products.slug', '=', req.params.slug ?? '')
      .where('products.is_active', '=', true)
      .where('products.in_store_only', '=', false)
      .executeTakeFirst(),
  );

  if (error) return res.status(500).json({ error: 'Could not load product.' });
  if (!data) return res.json(null);

  return res.json(await toCustomerProduct(data));
});
