import { attempt, db, rpc, withActor } from '../../lib/db.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import {
  goodsInLinkBodySchema,
  goodsInProductBodySchema,
  stockIntakeBodySchema,
} from '../../schemas.js';
import { createRouter } from '../../lib/router.js';
import { tillShop } from '../../lib/shopScope.js';
import { listIntakes } from '../../lib/inventoryLogs.js';
import { BarcodeMintError, mintBarcode } from '../../lib/barcodes.js';
import { isUuid } from '../../lib/uuid.js';
import { barcodeTakenMessage, productById, toAdminProduct } from '../admin/products.js';

export const posStockIntakesRouter = createRouter();
const router = posStockIntakesRouter;

/* ---------------------------------------------------------------------- */
/* Goods in — booking a supplier delivery in at the till (0103, 0108, 0123)  */
/* ---------------------------------------------------------------------- */
// Under /pos, not /admin: a PIN-switched till session may write here (blockPosOnlySession
// refuses /admin writes). The shop is the person's own — record_goods_in_v2() and
// link_goods_in_barcode() take it from the session's staff id, never from the request.
//
// Since 0123 (client changes, Oct 2026 #8) a product line adds its quantity to stock again, a
// barcode scanned that nothing had is registered on the product it turns out to be, and a barcode
// whose product isn't known yet waits in the "to link" list until someone links it (the stock is
// received then). Costs per item and the delivery's price may be typed without costs.view; they
// are never sent back to someone without it (listIntakes).

/** The first barcode a delivery names, for the "already on …" message when one clashes. */
function barcodesIn(lines: { type: string; barcode?: string; registerBarcode?: string }[]) {
  return lines.map((l) => l.registerBarcode ?? l.barcode).filter((b): b is string => !!b);
}

router.post(
  '/stock-intakes',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = stockIntakeBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    const { data: intakeId, error } = await attempt(() =>
      rpc<string>('record_goods_in_v2', {
        p_staff_id: req.user!.id,
        p_lines: body.lines.map((l) =>
          l.type === 'product'
            ? {
                type: 'product',
                product_id: l.productId,
                variant_id: l.variantId ?? null,
                qty: l.qty,
                unit_cost: l.unitCost ?? null,
                register_barcode: l.registerBarcode ?? null,
              }
            : l.type === 'barcode'
              ? {
                  type: 'barcode',
                  barcode: l.barcode,
                  name: l.name ?? null,
                  qty: l.qty,
                  unit_cost: l.unitCost ?? null,
                }
              : { type: 'item', name: l.name, qty: l.qty },
        ),
        p_price: body.price ?? null,
        p_supplier_name: body.supplierName ?? null,
        p_supplier_ref: body.supplierRef ?? null,
        p_notes: body.notes ?? null,
      }),
    );
    if (error) {
      const shopId = tillShop(req);
      if (error.code === '23505' && shopId) {
        for (const barcode of barcodesIn(body.lines)) {
          const taken = await barcodeTakenMessage(error, barcode, shopId);
          if (taken) return res.status(409).json({ error: taken });
        }
      }
      return res.status(400).json({ error: error.message });
    }

    const { items } = await listIntakes(
      req,
      { shopId: null, from: null, to: null, search: '', id: intakeId },
      { limit: 1, offset: 0 },
    );
    const made = items.find((i) => i.id === intakeId);
    if (!made)
      return res.status(500).json({ error: 'The delivery was booked but could not be read back.' });
    return res.status(201).json(made);
  },
);

/** The till's own recent deliveries, newest first. */
router.get(
  '/stock-intakes',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const shopId = tillShop(req);
    if (!shopId) return res.json([]);
    const { items } = await listIntakes(
      req,
      { shopId, from: null, to: null, search: '' },
      { limit: 15, offset: 0 },
    );
    return res.json(items);
  },
);

/**
 * The quick "new product" form on Goods in: just enough to book it in now — name, category,
 * selling price and a barcode (the one on the box, or a fresh shop one). It is a till-only product
 * in the person's own shop with no stock and no cost yet; photos, a description and putting it on
 * the website happen later in Inventory. The quantity arrives with the delivery.
 */
router.post(
  '/goods-in/products',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = goodsInProductBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;
    const shopId = tillShop(req);
    if (!shopId) {
      return res.status(400).json({ error: 'Your account is not assigned to a shop.' });
    }

    let barcode = body.barcode ?? null;
    if (!barcode && body.generateBarcode) {
      try {
        barcode = await mintBarcode();
      } catch (err) {
        if (err instanceof BarcodeMintError) return res.status(503).json({ error: err.message });
        throw err;
      }
    }

    const slug = body.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const { data, error } = await attempt(() =>
      withActor(req.user!.id, async (trx) => {
        const created = await trx
          .insertInto('products')
          .values({
            slug: `${slug}-${Date.now().toString(36)}`,
            shop_id: shopId,
            name: body.name,
            category_id: body.categoryId,
            price: body.price,
            cost_price: 0,
            stock_qty: 0,
            barcode,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        // Every product joins the master list on insert (0099); a quick Goods in product stays
        // till-only, off the website, until someone completes it in Inventory.
        await rpc('unlink_product_from_master', { p_product_id: created.id }, { executor: trx });
        return created;
      }),
    );
    if (error) {
      const taken = await barcodeTakenMessage(error, barcode, shopId);
      if (taken) return res.status(409).json({ error: taken });
      if (error.code === '23503') return res.status(400).json({ error: 'Choose a category.' });
      return res.status(500).json({ error: 'Could not create the product.' });
    }
    const row = await productById(data.id);
    return res.status(201).json(await toAdminProduct(row!));
  },
);

/* ---- The "to link" list --------------------------------------------------- */

/** Barcodes from deliveries waiting for their product, in the person's own shop. */
router.get(
  '/goods-in/to-link',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const shopId = tillShop(req);
    if (!shopId) return res.json([]);
    const rows = await db
      .selectFrom('goods_in_barcodes as g')
      .innerJoin('stock_intakes as i', 'i.id', 'g.intake_id')
      .innerJoin('staff as s', 's.id', 'g.created_by')
      .select([
        'g.id',
        'g.barcode',
        'g.item_name',
        'g.qty',
        'g.created_at',
        'i.reference',
        'i.supplier_name',
        's.name as staff_name',
      ])
      .where('g.shop_id', '=', shopId)
      .where('g.status', '=', 'to_link')
      .orderBy('g.created_at', 'desc')
      .limit(200)
      .execute();
    return res.json(
      rows.map((r) => ({
        id: r.id,
        barcode: r.barcode,
        name: r.item_name,
        qty: r.qty,
        createdAt: r.created_at,
        intakeReference: r.reference,
        supplierName: r.supplier_name,
        staffName: r.staff_name,
      })),
    );
  },
);

/** Link a waiting barcode to its product: the barcode is registered on it and the stock received. */
router.post(
  '/goods-in/to-link/:id/link',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const id = req.params.id ?? '';
    if (!isUuid(id)) return res.status(404).json({ error: 'That barcode is not waiting.' });
    const parsed = goodsInLinkBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

    const waiting = await db
      .selectFrom('goods_in_barcodes')
      .select('barcode')
      .where('id', '=', id)
      .executeTakeFirst();
    const { error } = await attempt(() =>
      rpc('link_goods_in_barcode', {
        p_staff_id: req.user!.id,
        p_id: id,
        p_product_id: parsed.data.productId,
        p_variant_id: parsed.data.variantId ?? null,
      }),
    );
    if (error) {
      const shopId = tillShop(req);
      const taken =
        shopId && waiting ? await barcodeTakenMessage(error, waiting.barcode, shopId) : null;
      return res.status(taken ? 409 : 400).json({ error: taken ?? error.message });
    }
    return res.status(204).end();
  },
);

/** Scanned by mistake: take it off the list. Nothing was received, so nothing else changes. */
router.post(
  '/goods-in/to-link/:id/dismiss',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const id = req.params.id ?? '';
    const shopId = tillShop(req);
    if (!isUuid(id) || !shopId)
      return res.status(404).json({ error: 'That barcode is not waiting.' });
    const result = await db
      .updateTable('goods_in_barcodes')
      .set({
        status: 'dismissed',
        dismissed_by: req.user!.id,
        dismissed_at: new Date().toISOString(),
      })
      .where('id', '=', id)
      .where('shop_id', '=', shopId)
      .where('status', '=', 'to_link')
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) {
      return res.status(404).json({ error: 'That barcode is not waiting.' });
    }
    return res.status(204).end();
  },
);
