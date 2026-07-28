import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { artForCategory, DEFAULT_TILE } from '../lib/productMapping.js';

export const productsRouter = Router();
export const categoriesRouter = Router();

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
 * Stock status via the schema's own `stock_status_for()` — never
 * re-derived here. One RPC call per row; fine at this catalog's size, and
 * keeps the three-state rule (never a count) enforced in exactly one place,
 * the database function, rather than duplicated in application code.
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

async function toCustomerProduct(row: ProductRow) {
  const [stockStatus, images] = await Promise.all([stockStatusFor(row.id), imagesFor(row.id)]);
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

  const products = await Promise.all((data as ProductRow[]).map(toCustomerProduct));
  return res.json(products);
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

  return res.json(await toCustomerProduct(data as ProductRow));
});
