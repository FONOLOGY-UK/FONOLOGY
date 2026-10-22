import { z } from 'zod';
import { BarcodeMintError, mintBarcode } from '../../lib/barcodes.js';
import { attempt, db, withActor } from '../../lib/db.js';
import { isUuid } from '../../lib/uuid.js';
import { barcodeTakenMessage, productForRequest } from './products.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { createRouter } from '../../lib/router.js';

export const adminBarcodesRouter = createRouter();
const router = adminBarcodesRouter;

/* ---------------------------------------------------------------------- */
/* Barcode minting (change request item 3)                                  */
/* ---------------------------------------------------------------------- */

/**
 * A fresh, unused barcode for a product or variant that arrived without one.
 *
 * SERVER-SIDE, not in the browser, and that is the whole reason this is an
 * endpoint rather than three lines of JavaScript: "unique, non-repeating" is
 * a claim about the database, and only the server can check it. A
 * browser-generated number would be unique in the sense of "random", which
 * is not the sense the doc means.
 *
 * POST rather than GET because it is not idempotent in spirit — each call is
 * meant to hand out a different number — and because a GET would be
 * cacheable by something in front of it, which is the one behaviour this
 * must never have.
 *
 * `inventory.manage`: whoever is pricing up stock is who sticks labels on it.
 */
router.post(
  '/barcodes/generate',
  requireStaff,
  requirePermission('inventory.manage'),
  async (_req, res) => {
    try {
      return res.json({ barcode: await mintBarcode() });
    } catch (err) {
      if (err instanceof BarcodeMintError) return res.status(503).json({ error: err.message });
      throw err;
    }
  },
);

/* ---------------------------------------------------------------------- */
/* Extra barcodes (client changes, Oct 2026 #8; 0122)                       */
/* ---------------------------------------------------------------------- */

const extraBarcodeBody = z.object({
  barcode: z.string().trim().min(1, 'Scan or type a barcode.').max(64, 'That barcode is too long.'),
  /** The variation it belongs to; omitted for a plain product. */
  variantId: z.string().uuid().optional(),
});

/**
 * Add another barcode to a product or one of its variations. It scans exactly like the main one.
 * The database refuses a barcode already used anywhere in the shop (main or extra), and the
 * message says where.
 */
router.post(
  '/products/:id/barcodes',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const product = await productForRequest(req, req.params.id, true);
    if (!product) return res.status(404).json({ error: 'Product not found.' });
    const parsed = extraBarcodeBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const { barcode, variantId } = parsed.data;

    if (variantId) {
      const variant = await db
        .selectFrom('product_variants')
        .select('id')
        .where('id', '=', variantId)
        .where('product_id', '=', product.id)
        .where('removed_at', 'is', null)
        .executeTakeFirst();
      if (!variant) return res.status(404).json({ error: 'Variation not found.' });
    } else if (product.has_variants) {
      // A variation product is a placeholder with no barcode of its own (0107).
      return res.status(400).json({ error: 'Add the barcode to one of its variations.' });
    }

    const { data, error } = await attempt(() =>
      withActor(req.user!.id, (trx) =>
        trx
          .insertInto('product_barcodes')
          .values({
            shop_id: product.shop_id,
            product_id: product.id,
            variant_id: variantId ?? null,
            barcode,
          })
          .returning(['id', 'barcode'])
          .executeTakeFirstOrThrow(),
      ),
    );
    if (error) {
      const taken = await barcodeTakenMessage(error, barcode, product.shop_id);
      return res.status(taken ? 409 : 500).json({ error: taken ?? 'Could not add that barcode.' });
    }
    return res.status(201).json(data);
  },
);

/** Remove an extra barcode. The main barcode is changed on the product or variation itself. */
router.delete(
  '/products/:id/barcodes/:barcodeId',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const product = await productForRequest(req, req.params.id, true);
    if (!product) return res.status(404).json({ error: 'Product not found.' });
    const barcodeId = req.params.barcodeId ?? '';
    if (!isUuid(barcodeId)) return res.status(404).json({ error: 'Barcode not found.' });
    const { data, error } = await attempt(() =>
      withActor(req.user!.id, (trx) =>
        trx
          .deleteFrom('product_barcodes')
          .where('id', '=', barcodeId)
          .where('product_id', '=', product.id)
          .executeTakeFirst(),
      ),
    );
    if (error) return res.status(500).json({ error: 'Could not remove that barcode.' });
    if (Number(data.numDeletedRows) === 0) {
      return res.status(404).json({ error: 'Barcode not found.' });
    }
    return res.status(204).end();
  },
);
