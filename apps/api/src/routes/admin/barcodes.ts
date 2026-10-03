import { BarcodeMintError, mintBarcode } from '../../lib/barcodes.js';
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
