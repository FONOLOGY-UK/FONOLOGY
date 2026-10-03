import { z } from 'zod';
import { attempt, db, rpc, sql } from '../../lib/db.js';
import { isUuid } from '../../lib/uuid.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { createRouter } from '../../lib/router.js';
import { readShop, writeShop } from '../../lib/shopScope.js';
import { productForRequest, toAdminProduct } from './products.js';

export const adminMasterRouter = createRouter();
const router = adminMasterRouter;

/* ---------------------------------------------------------------------- */
/* The master list (0099)                                                   */
/* ---------------------------------------------------------------------- */
// A master product links the copies of one product that different shops stock. Any member of
// staff with inventory.manage may put a product on it, pull one into their shop, and set their
// own shop's price; what they see of OTHER shops is only the product itself — name, photo,
// barcode — never another shop's price, cost or stock.

const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  barcode: z.string().trim().max(64).optional(),
});

/**
 * The picker for "Add Product from Master List". `inMyShop` / `myProductId` say whether the
 * caller's shop already holds a copy (it can hold only one). `?barcode=` finds the masters a
 * scanned box already belongs to, so a duplicate is linked rather than created.
 */
router.get('/master', requireStaff, requirePermission('inventory.manage'), async (req, res) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const { search, barcode } = parsed.data;
  const shopId = readShop(req) ?? req.user!.shopId ?? null;
  const like = search ? `%${search.replace(/[%_]/g, '')}%` : null;

  const { data, error } = await attempt(async () => {
    const result = await sql<{
      id: string;
      slug: string;
      name: string;
      sub: string | null;
      barcode: string | null;
      image: string | null;
      my_product_id: string | null;
      shop_count: number;
    }>`
      select m.id, m.slug, rep.name, rep.sub, rep.barcode,
             (select url from product_images where product_id = rep.id order by position limit 1) as image,
             mine.id as my_product_id,
             (select count(*)::int from products c where c.master_product_id = m.id) as shop_count
        from master_products m
        join lateral (
          select p.* from products p join shops s on s.id = p.shop_id
           where p.master_product_id = m.id
           order by p.is_active desc, s.sort_order, p.created_at
           limit 1
        ) rep on true
        left join products mine
               on mine.master_product_id = m.id and mine.shop_id = ${shopId}::uuid
       where (${like}::text is null or rep.name ilike ${like} or coalesce(rep.sub, '') ilike ${like})
         and (${barcode ?? null}::text is null
              or exists (select 1 from products b
                          where b.master_product_id = m.id and b.barcode = ${barcode ?? null}))
       order by rep.name
       limit 100
    `.execute(db);
    return result.rows;
  });
  if (error) return res.status(500).json({ error: 'Could not load the master list.' });

  return res.json(
    data.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      sub: r.sub ?? '',
      barcode: r.barcode,
      image: r.image,
      shopCount: r.shop_count,
      inMyShop: r.my_product_id !== null,
      myProductId: r.my_product_id,
    })),
  );
});

/** "Add Product from Master List": copy a master product into the caller's shop. */
router.post(
  '/master/:id/copy',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const masterId = req.params.id ?? '';
    if (!isUuid(masterId)) return res.status(404).json({ error: 'Master product not found.' });
    const shopId = await writeShop(req, res);
    if (!shopId) return;

    const { data: productId, error } = await attempt(() =>
      rpc<string>('copy_master_to_shop', {
        p_master_id: masterId,
        p_shop_id: shopId,
        p_staff_id: req.user!.id,
      }),
    );
    if (error) {
      const taken = /already has a copy/.test(error.message);
      return res.status(taken ? 409 : 404).json({ error: error.message });
    }
    const row = await db
      .selectFrom('products')
      .selectAll()
      .where('id', '=', productId)
      .executeTakeFirstOrThrow();
    return res.status(201).json(await toAdminProduct(row));
  },
);

const linkBody = z.object({ masterProductId: z.string().uuid().optional() });

/**
 * Put an existing product on the master list: as a new master of its own (no body), or linked
 * to a master it duplicates (`masterProductId`) — which merges the two shops' copies into one
 * website listing.
 */
router.post(
  '/products/:id/master',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = linkBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const product = await productForRequest(req, req.params.id, true);
    if (!product) return res.status(404).json({ error: 'Product not found.' });

    const { error } = await attempt(() =>
      parsed.data.masterProductId
        ? rpc('link_product_to_master', {
            p_product_id: product.id,
            p_master_id: parsed.data.masterProductId,
          })
        : rpc('create_master_for_product', { p_product_id: product.id }),
    );
    if (error) return res.status(409).json({ error: error.message });

    const fresh = await db
      .selectFrom('products')
      .selectAll()
      .where('id', '=', product.id)
      .executeTakeFirstOrThrow();
    return res.json(await toAdminProduct(fresh));
  },
);

/** Take a product off the master list: it stays on the till and leaves the website. */
router.delete(
  '/products/:id/master',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const product = await productForRequest(req, req.params.id, true);
    if (!product) return res.status(404).json({ error: 'Product not found.' });
    const { error } = await attempt(() =>
      rpc('unlink_product_from_master', { p_product_id: product.id }),
    );
    if (error) return res.status(409).json({ error: error.message });
    const fresh = await db
      .selectFrom('products')
      .selectAll()
      .where('id', '=', product.id)
      .executeTakeFirstOrThrow();
    return res.json(await toAdminProduct(fresh));
  },
);
