import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { artForCategory, DEFAULT_TILE, filterValidImageUrls } from '../lib/productMapping.js';

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
const CUSTOMER_PRODUCT_COLUMNS =
  'id, slug, name, sub, description, category_id, categories(slug), kind, price, created_at, tag, compatibility';

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
  // supabase-js embeds a to-one FK relationship as a single object (never an
  // array) — categories.id <- products.category_id is exactly that shape.
  categories: { slug: string } | null;
  kind: string;
  price: number;
  created_at: string;
  tag: string | null;
  compatibility: string | null;
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
  const { data, error } = await supabaseAdmin.rpc('stock_status_for', { p_product_id: productId });
  if (error) throw error;
  return data as 'in-stock' | 'out-of-stock' | 'restocking';
}

async function imagesFor(productId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('product_images')
    .select('url')
    .eq('product_id', productId)
    .order('position', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => row.url as string);
}

type StockStatus = 'in-stock' | 'out-of-stock' | 'restocking';

/** Shapes one row once its stock status and images are already in hand. */
function buildCustomerProduct(row: ProductRow, stockStatus: StockStatus, images: string[]) {
  // Defensive only — category_id is NOT NULL with an ON DELETE RESTRICT FK
  // (0045), so a row with no matching category should never actually occur.
  const category = row.categories?.slug ?? '';
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
  };
}

/** One product, on its own — two round trips is fine for a single row. */
async function toCustomerProduct(row: ProductRow) {
  const [stockStatus, images] = await Promise.all([stockStatusFor(row.id), imagesFor(row.id)]);
  return buildCustomerProduct(row, stockStatus, images);
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

  const [statusResult, imageResult] = await Promise.all([
    supabaseAdmin.rpc('stock_status_for_many', { p_product_ids: ids }),
    supabaseAdmin
      .from('product_images')
      .select('product_id, url')
      .in('product_id', ids)
      .order('position', { ascending: true }),
  ]);
  if (statusResult.error) throw statusResult.error;
  if (imageResult.error) throw imageResult.error;

  const statusById = new Map<string, StockStatus>();
  for (const row of (statusResult.data ?? []) as { product_id: string; status: StockStatus }[]) {
    statusById.set(row.product_id, row.status);
  }

  const imagesById = new Map<string, string[]>();
  for (const row of (imageResult.data ?? []) as { product_id: string; url: string }[]) {
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
    const { data: ranked, error: searchError } = await supabaseAdmin.rpc('search_products', {
      p_term: search,
    });
    if (searchError) return res.status(500).json({ error: 'Could not load products.' });
    // supabaseAdmin.rpc() has no generated Database types (lib/supabase.ts),
    // same gap the customer-products embed comment above already explains —
    // an explicit cast here, not a call directly on the untyped result.
    const rankedRows = (ranked ?? []) as unknown as Array<{ id: string; rank: number }>;
    searchRankById = new Map(rankedRows.map((r) => [r.id, r.rank]));
    // No matches at all — skip the rest of the query, same as an unknown
    // category slug below.
    if (searchRankById.size === 0) return res.json([]);
  }

  let query = supabaseAdmin
    .from('products')
    .select(CUSTOMER_PRODUCT_COLUMNS)
    .eq('is_active', true)
    // Sellable at the till, absent from the customer-facing catalogue (0044,
    // FEATURE-06) — admin/POS reads never apply this filter, only these two
    // customer-facing routes do.
    .eq('in_store_only', false);

  if (category && category !== 'all') {
    // `category` here is a slug (the customer-facing/URL contract, unchanged
    // by FEATURE-05) — resolve it to the real id first, since the underlying
    // column is category_id now. Supabase-js has no clean way to filter a
    // parent row by a column on its embedded relation, only the embedded
    // rows themselves, so this can't be a single query with a nested .eq().
    const { data: cat, error: catError } = await supabaseAdmin
      .from('categories')
      .select('id')
      .eq('slug', category)
      .maybeSingle();
    if (catError) return res.status(500).json({ error: 'Could not load products.' });
    // An unknown slug matches nothing — same behaviour as before, when an
    // unrecognised enum value would have matched zero rows too.
    if (!cat) return res.json([]);
    query = query.eq('category_id', cat.id);
  }
  if (searchRankById) {
    query = query.in('id', [...searchRankById.keys()]);
  }

  if (sort === 'price-asc') query = query.order('price', { ascending: true });
  else if (sort === 'price-desc') query = query.order('price', { ascending: false });
  // A search with no explicit sort ranks by relevance (below, after the
  // fetch) rather than creation order — closer to what someone searching
  // actually wants. No search and no explicit sort keeps the old default.
  else if (!searchRankById) query = query.order('created_at', { ascending: true });

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'Could not load products.' });

  // Relevance order, applied here rather than trusted from the RPC/embed
  // chain — see the comment above. No-op when a search wasn't the active
  // sort (searchRankById is null, or an explicit price sort already ran).
  const rows = (data ?? []) as unknown as ProductRow[];
  if (searchRankById && sort !== 'price-asc' && sort !== 'price-desc') {
    const rankById = searchRankById;
    rows.sort((a, b) => (rankById.get(b.id) ?? 0) - (rankById.get(a.id) ?? 0));
  }

  // This client has no generated Database types (see lib/supabase.ts), so
  // supabase-js's select-string type parser can't see that category_id -> 1
  // categories.id is a to-one embed and infers `categories` as an array —
  // PostgREST itself still returns a single object at runtime. Same gap
  // sell.routes.ts's `device:devices(name)` embed sidesteps with its own
  // manual cast.
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
categoriesRouter.get('/', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('categories')
    .select('id, slug, label, parent_id')
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: 'Could not load categories.' });

  const rows = data ?? [];
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
productsRouter.get('/:id/availability', async (req, res) => {
  const quantity = Number(req.query.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) {
    return res.status(400).json({ error: 'quantity must be a positive integer.' });
  }
  const { data } = await supabaseAdmin
    .from('products')
    .select('stock_qty, is_active, in_store_only')
    .eq('id', req.params.id)
    .maybeSingle();

  const available = Boolean(
    data && data.is_active && !data.in_store_only && data.stock_qty >= quantity,
  );
  return res.json({ available });
});

productsRouter.get('/:slug', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('products')
    .select(CUSTOMER_PRODUCT_COLUMNS)
    .eq('slug', req.params.slug)
    .eq('is_active', true)
    .eq('in_store_only', false)
    .maybeSingle();

  if (error) return res.status(500).json({ error: 'Could not load product.' });
  if (!data) return res.json(null);

  // See the matching cast + comment in productsRouter.get('/') just above.
  return res.json(await toCustomerProduct(data as unknown as ProductRow));
});
