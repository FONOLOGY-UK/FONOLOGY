import { attempt, db, rpc, withActor } from '../../lib/db.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { stockAdjustBodySchema, stockReceiveBodySchema } from '../../schemas.js';
import { createRouter } from '../../lib/router.js';
import { readShop } from '../../lib/shopScope.js';
import { adminVariationById } from '../../lib/variations.js';
import { productById, toAdminProduct } from './products.js';

/** Retire / restore a product, adjust its stock, find it by barcode, the low-stock list. */
export const adminProductStockRouter = createRouter();
const router = adminProductStockRouter;

/** A variation product's own stock is never counted (0107): stock moves per variation. */
const VARIATIONS_ONLY = {
  error: 'This product has variations — change the stock on each variation instead.',
};

/**
 * "delete" — DEACTIVATES, never hard-deletes. A product with real sale/order
 * history cannot be deleted at all (stock_movements is ON DELETE RESTRICT),
 * and even one with none shouldn't silently vanish from an owner-managed
 * catalogue.
 */
router.delete(
  '/products/:id',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const { data: row, error } = await attempt(() =>
      withActor(req.user!.id, (trx) =>
        trx
          .updateTable('products')
          .set({ is_active: false })
          .where('id', '=', req.params.id ?? '')
          .returning('id')
          .executeTakeFirst(),
      ),
    );
    if (error) return res.status(400).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Product not found.' });
    return res.status(204).end();
  },
);

/**
 * Round 4 #BUG-10: the other half of "delete". Before this, nothing
 * anywhere ever set `is_active` back to true — PUT /products/:id doesn't
 * touch it (see the comment on that handler), and DELETE is idempotent, so
 * clicking it again on an already-retired product is a no-op, not an
 * undo. A dedicated endpoint, mirroring DELETE's own shape, rather than
 * folding `isActive` into the general edit schema — restoring is a
 * deliberate, singular action, not a field a staff member should be able to
 * flip while editing something else.
 */
router.post(
  '/products/:id/restore',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const { data: row, error } = await attempt(() =>
      withActor(req.user!.id, (trx) =>
        trx
          .updateTable('products')
          .set({ is_active: true })
          .where('id', '=', req.params.id ?? '')
          .returningAll()
          .executeTakeFirst(),
      ),
    );
    if (error) return res.status(400).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Product not found.' });
    return res.json(await toAdminProduct(row));
  },
);

/** Quick +/- adjustment from the inventory table — maps to a 'correction' movement, the one kind the schema leaves unsigned. */
router.post(
  '/products/:id/stock',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = stockAdjustBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const delta = parsed.data.delta;
    if (delta === 0) return res.status(400).json({ error: 'Adjustment cannot be zero.' });
    if ((await productById(req.params.id))?.has_variants)
      return res.status(400).json(VARIATIONS_ONLY);

    const { error } = await attempt(() =>
      delta > 0
        ? rpc('stock_receive', {
            p_product_id: req.params.id,
            p_qty: delta,
            p_unit_cost: null,
            p_kind: 'correction',
            p_reason: 'Quick adjustment from the inventory table',
            p_staff_id: req.user!.id,
          })
        : rpc('stock_consume', {
            p_product_id: req.params.id,
            p_qty: -delta,
            p_kind: 'correction',
            p_reason: 'Quick adjustment from the inventory table',
            p_staff_id: req.user!.id,
          }),
    );
    if (error) return res.status(409).json({ error: error.message });

    const row = await productById(req.params.id);
    return res.json(await toAdminProduct(row!));
  },
);

/** Real stock receipt — updates the weighted-average cost via the schema's own trigger. */
router.post(
  '/products/:id/receive',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = stockReceiveBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    if ((await productById(req.params.id))?.has_variants)
      return res.status(400).json(VARIATIONS_ONLY);

    const { error } = await attempt(() =>
      rpc('stock_receive', {
        p_product_id: req.params.id,
        p_qty: parsed.data.quantity,
        p_unit_cost: parsed.data.unitCost,
        p_kind: 'receipt',
        p_staff_id: req.user!.id,
      }),
    );
    if (error) return res.status(409).json({ error: error.message });

    const row = await productById(req.params.id);
    return res.json(await toAdminProduct(row!));
  },
);

/**
 * Round 5 Phase 4 #16: a variant's barcode uniquely resolves to that exact
 * variant, checked first — a scan should never need a picker. Falls back
 * to the plain product barcode exactly as before. The response is still
 * `toAdminProduct(product)` either way (the till already knows how to add
 * a plain product); a variant match adds a `matchedVariant` field on top
 * carrying that variation (its own price and stock), which is what the
 * till uses to add THAT variant to the ticket rather than the parent.
 */
router.get(
  '/products/barcode/:code',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const code = req.params.code ?? '';
    const shopId = readShop(req);
    const variantRow = await db
      .selectFrom('product_variants')
      .select(['id', 'product_id'])
      .where('barcode', '=', code)
      .where('is_active', '=', true)
      .where('removed_at', 'is', null)
      .$if(!!shopId, (qb) => qb.where('shop_id', '=', shopId!))
      .executeTakeFirst();

    if (variantRow) {
      const product = await productById(variantRow.product_id);
      if (!product) return res.json(null);
      return res.json({
        ...(await toAdminProduct(product)),
        matchedVariant: await adminVariationById(variantRow.id),
      });
    }

    const row = await db
      .selectFrom('products')
      .selectAll()
      .where('barcode', '=', code)
      .$if(!!shopId, (qb) => qb.where('shop_id', '=', shopId!))
      .executeTakeFirst();
    if (!row) return res.json(null);
    return res.json(await toAdminProduct(row));
  },
);

router.get(
  '/products/low-stock',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const shopId = readShop(req);
    const data = await db
      .selectFrom('low_stock_products')
      .selectAll()
      .$if(!!shopId, (qb) => qb.where('shop_id', '=', shopId!))
      .execute();
    return res.json(
      data.map((r) => ({
        id: r.id,
        name: r.name,
        category: r.category,
        stockQty: r.stock_qty,
        lowStockThreshold: r.low_stock_threshold,
      })),
    );
  },
);
