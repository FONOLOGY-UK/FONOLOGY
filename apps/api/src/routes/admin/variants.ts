import { attempt, db, rpc } from '../../lib/db.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import {
  variantInputBodySchema,
  stockAdjustBodySchema,
  stockReceiveBodySchema,
} from '../../schemas.js';
import { createRouter } from '../../lib/router.js';
import {
  barcodeTakenMessage,
  productById,
  toAdminProduct,
  toAdminVariant,
  variantById,
} from './products.js';

export const adminVariantsRouter = createRouter();
const router = adminVariantsRouter;

/* ---------------------------------------------------------------------- */
/* Product variants (Round 5 Phase 4 #16, trimmed v1)                       */
/* ---------------------------------------------------------------------- */
// Same shape as the devices/repair-types blocks above: gated on
// inventory.manage, list/create/update/soft-delete. Nested under the
// product because a variant has no independent existence — unlike devices
// or repair types, it can never be listed or edited without its parent in
// view. stock_qty/costPrice move ONLY through stock_receive/stock_consume
// (the variant-aware branch added in 0060), never a plain UPDATE — same
// discipline the parent product already has for its own stock/cost.

router.get(
  '/products/:id/variants',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const { data, error } = await attempt(() =>
      db
        .selectFrom('product_variants')
        .selectAll()
        .where('product_id', '=', req.params.id ?? '')
        .orderBy('created_at')
        .execute(),
    );
    if (error) return res.status(500).json({ error: 'Could not load variants.' });
    return res.json(data.map(toAdminVariant));
  },
);

router.post(
  '/products/:id/variants',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = variantInputBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    // product_variants_require_flag (0060) would reject this anyway, but a
    // 400 with a readable message beats a raw trigger exception surfacing
    // in the admin UI.
    const productId = req.params.id ?? '';
    const product = await productById(productId);
    if (!product) return res.status(404).json({ error: 'Product not found.' });
    if (!product.has_variants) {
      return res
        .status(400)
        .json({ error: 'Turn on variants for this product before adding one.' });
    }

    // stock_qty is never set directly on create here either — same rule as
    // a plain product (see POST /products above). A variant is created at
    // zero stock and stocked up through the receive endpoint below.
    const { data: row, error } = await attempt(() =>
      db
        .insertInto('product_variants')
        .values({
          product_id: productId,
          options: JSON.stringify(body.options),
          sku: body.sku,
          barcode: body.barcode || null,
          price_adjustment: body.priceAdjustment,
          cost_price: 0,
          stock_qty: 0,
          low_stock_alert: body.lowStockAlert,
          low_stock_threshold: body.lowStockThreshold,
          is_active: body.isActive,
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    if (error) {
      const taken = await barcodeTakenMessage(error, body.barcode);
      return res.status(taken ? 409 : 400).json({ error: taken ?? error.message });
    }

    if (body.stockQty > 0) {
      await rpc('stock_receive', {
        p_product_id: productId,
        p_qty: body.stockQty,
        p_unit_cost: body.costPrice,
        p_kind: 'receipt',
        p_staff_id: req.user!.id,
        p_variant_id: row.id,
      }).catch(() => undefined);
    }

    const fresh = await variantById(row.id);
    return res.status(201).json(toAdminVariant(fresh!));
  },
);

/** Client decision #15 (post-launch): same unlock as the parent product's
 * own PUT handler above, applied to a variant's stock/cost — see that
 * route's comment for the full reasoning. */
router.put(
  '/products/:id/variants/:variantId',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = variantInputBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    const productId = req.params.id ?? '';
    const variantId = req.params.variantId ?? '';
    const existing = await variantById(variantId);
    if (!existing || existing.product_id !== productId) {
      return res.status(404).json({ error: 'Variant not found.' });
    }

    const { data: row, error } = await attempt(() =>
      db
        .updateTable('product_variants')
        .set({
          options: JSON.stringify(body.options),
          sku: body.sku,
          barcode: body.barcode || null,
          price_adjustment: body.priceAdjustment,
          low_stock_alert: body.lowStockAlert,
          low_stock_threshold: body.lowStockThreshold,
          is_active: body.isActive,
        })
        .where('id', '=', variantId)
        .where('product_id', '=', productId)
        .returning('id')
        .executeTakeFirst(),
    );
    if (error) {
      const taken = await barcodeTakenMessage(error, body.barcode);
      return res.status(taken ? 409 : 400).json({ error: taken ?? error.message });
    }
    if (!row) return res.status(404).json({ error: 'Variant not found.' });

    const delta = body.stockQty - existing.stock_qty;
    if (delta > 0) {
      await rpc('stock_receive', {
        p_product_id: productId,
        p_qty: delta,
        p_unit_cost: body.costPrice,
        p_kind: 'receipt',
        p_staff_id: req.user!.id,
        p_variant_id: variantId,
      }).catch(() => undefined);
    } else if (delta < 0) {
      await rpc('stock_consume', {
        p_product_id: productId,
        p_qty: -delta,
        p_kind: 'correction',
        p_staff_id: req.user!.id,
        p_reason: 'Stock count corrected from the product edit screen',
        p_variant_id: variantId,
      }).catch(() => undefined);
    }
    await db
      .updateTable('product_variants')
      .set({ cost_price: body.costPrice })
      .where('id', '=', variantId)
      .execute()
      .catch(() => undefined);

    const fresh = await variantById(variantId);
    return res.json(toAdminVariant(fresh!));
  },
);

router.delete(
  '/products/:id/variants/:variantId',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    // Soft-delete, same as a product (stock_movements is ON DELETE RESTRICT
    // regardless — a variant with real sale/order history could never be
    // hard-deleted anyway).
    const { data: row, error } = await attempt(() =>
      db
        .updateTable('product_variants')
        .set({ is_active: false })
        .where('id', '=', req.params.variantId ?? '')
        .where('product_id', '=', req.params.id ?? '')
        .returning('id')
        .executeTakeFirst(),
    );
    if (error) return res.status(400).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Variant not found.' });
    return res.status(204).end();
  },
);

/**
 * Adjust a variant's stock — same three operations as a plain product
 * (stockAdjustBodySchema/stockReceiveBodySchema/stockWriteOffBodySchema,
 * reused as-is). See the matching /products/:id/stock|receive|write-off
 * routes below for the product-level equivalents this mirrors.
 */
router.post(
  '/products/:id/variants/:variantId/stock',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = stockAdjustBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const delta = parsed.data.delta;
    if (delta === 0) return res.status(400).json({ error: 'Nothing to adjust.' });

    const rpcName = delta > 0 ? 'stock_receive' : 'stock_consume';
    const params =
      delta > 0
        ? {
            p_product_id: req.params.id,
            p_qty: delta,
            p_unit_cost: null,
            p_kind: 'correction',
            p_staff_id: req.user!.id,
            p_reason: 'Manual stocktake adjustment',
            p_variant_id: req.params.variantId,
          }
        : {
            p_product_id: req.params.id,
            p_qty: -delta,
            p_kind: 'correction',
            p_staff_id: req.user!.id,
            p_reason: 'Manual stocktake adjustment',
            p_variant_id: req.params.variantId,
          };
    const { error } = await attempt(() => rpc(rpcName, params));
    if (error) return res.status(400).json({ error: error.message });

    const row = await variantById(req.params.variantId);
    return res.json(toAdminVariant(row!));
  },
);

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
      db
        .updateTable('products')
        .set({ is_active: false })
        .where('id', '=', req.params.id ?? '')
        .returning('id')
        .executeTakeFirst(),
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
      db
        .updateTable('products')
        .set({ is_active: true })
        .where('id', '=', req.params.id ?? '')
        .returningAll()
        .executeTakeFirst(),
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
 * carrying that variant's own effective price/stock/sku, which is what the
 * till uses to add THAT variant to the ticket rather than the parent.
 */
router.get(
  '/products/barcode/:code',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const code = req.params.code ?? '';
    const variantRow = await db
      .selectFrom('product_variants')
      .selectAll()
      .where('barcode', '=', code)
      .where('is_active', '=', true)
      .executeTakeFirst();

    if (variantRow) {
      const product = await productById(variantRow.product_id);
      if (!product) return res.json(null);
      return res.json({
        ...(await toAdminProduct(product)),
        matchedVariant: toAdminVariant(variantRow),
      });
    }

    const row = await db
      .selectFrom('products')
      .selectAll()
      .where('barcode', '=', code)
      .executeTakeFirst();
    if (!row) return res.json(null);
    return res.json(await toAdminProduct(row));
  },
);

router.get(
  '/products/low-stock',
  requireStaff,
  requirePermission('inventory.manage'),
  async (_req, res) => {
    const data = await db.selectFrom('low_stock_products').selectAll().execute();
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
