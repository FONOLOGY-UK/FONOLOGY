import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { artForCategory, DEFAULT_TILE } from '../lib/productMapping.js';

import { createRouter } from '../lib/router.js';

export const productsRouter = createRouter();
export const categoriesRouter = createRouter();

/**
 * Every customer-facing product query selects EXACTLY this column list —
 * never `stock_qty`, never `cost_price`. Not "strip it from the response
 * later": those columns are never fetched into this code path at all, so
 * there is no value to accidentally leak.
 */
const CUSTOMER_PRODUCT_COLUMNS =
  'id, slug, name, sub, description, category, kind, price, created_at';

const CATEGORIES = [
  { id: 'all', label: 'Everything' },
  { id: 'cases', label: 'Cases' },
  { id: 'power', label: 'Power' },
  { id: 'audio', label: 'Audio' },
  { id: 'protection', label: 'Protection' },
  { id: 'mounts', label: 'Mounts' },
  { id: 'vape', label: 'Vaping' },
  { id: 'plates', label: 'Number plates' },
];

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
  category: string;
  kind: string;
  price: number;
  created_at: string;
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
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    sub: row.sub ?? '',
    category: row.category,
    kind: row.kind,
    price: row.price,
    stockStatus,
    tag: null,
    compatibility: null,
    description: row.description ?? '',
    highlights: [] as string[],
    specs: [] as { label: string; value: string }[],
    images,
    art: artForCategory(row.category),
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

  let query = supabaseAdmin.from('products').select(CUSTOMER_PRODUCT_COLUMNS).eq('is_active', true);

  if (category && category !== 'all') {
    query = query.eq('category', category);
  }
  if (search) {
    // Search across name and sub only — matches what products_search_idx
    // indexes (name, sub). ILIKE rather than the tsvector GIN index
    // directly: supabase-js's query builder has no clean way to hit a
    // functional (expression) index without a raw RPC, and at this
    // catalog's size the difference isn't worth the extra function. Same
    // two fields, same intent — worth revisiting if the catalog grows.
    const term = search.replace(/[%_]/g, '');
    query = query.or(`name.ilike.%${term}%,sub.ilike.%${term}%`);
  }

  if (sort === 'price-asc') query = query.order('price', { ascending: true });
  else if (sort === 'price-desc') query = query.order('price', { ascending: false });
  else query = query.order('created_at', { ascending: true }); // 'featured' / default — insertion order, closest DB analogue to the mock's fixed array order

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'Could not load products.' });

  return res.json(await toCustomerProducts(data));
});

categoriesRouter.get('/', (_req, res) => {
  res.json(CATEGORIES);
});

productsRouter.get('/:slug', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('products')
    .select(CUSTOMER_PRODUCT_COLUMNS)
    .eq('slug', req.params.slug)
    .eq('is_active', true)
    .maybeSingle();

  if (error) return res.status(500).json({ error: 'Could not load product.' });
  if (!data) return res.json(null);

  return res.json(await toCustomerProduct(data));
});
