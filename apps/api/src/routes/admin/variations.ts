import type { Response } from 'express';
import { isDbError, toDbError, withActor } from '../../lib/db.js';
import { isUuid } from '../../lib/uuid.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { createRouter } from '../../lib/router.js';
import { canSeeCosts } from '../../lib/costs.js';
import { revalidateProductPage } from '../../lib/revalidate.js';
import {
  editVariations,
  loadAdminVariations,
  removeAllVariations,
  saveStructure,
  setDefaultVariation,
  VariationError,
} from '../../lib/variations.js';
import {
  variationBulkBodySchema,
  variationPatchBodySchema,
  variationStructureBodySchema,
} from '../../schemas.js';
import { barcodeTakenMessage, productById } from './products.js';

/**
 * Product variations (0107 — the rebuild). Every write is one transaction: the old feature's
 * saves failed half-way without saying so, which is what the rebuild exists to end. Shop access
 * to /products/:id is checked once in admin.routes.ts.
 */
export const adminVariationsRouter = createRouter();
const router = adminVariationsRouter;

const guard = [requireStaff, requirePermission('inventory.manage')] as const;

/** Answers a failed variation write in words staff can act on. */
async function fail(res: Response, err: unknown, barcode?: string | null, shopId?: string) {
  if (err instanceof VariationError) return res.status(err.status).json({ error: err.message });
  if (isDbError(err)) {
    const e = toDbError(err);
    const taken = shopId ? await barcodeTakenMessage(e, barcode, shopId) : null;
    return res.status(taken ? 409 : 400).json({ error: taken ?? e.message });
  }
  throw err;
}

async function refreshStorefront(productId: string) {
  const product = await productById(productId);
  if (product) revalidateProductPage(product.slug);
}

router.get('/products/:id/variations', ...guard, async (req, res) => {
  const product = await productById(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  return res.json(await loadAdminVariations(product.id));
});

/**
 * Save the option structure and bring the variations in line: generate them the first time,
 * add the new combinations after a value or option is added, delete the ones whose value was
 * removed. `dryRun` answers "what would this do" first, so the admin confirms a count.
 */
router.post('/products/:id/variations/structure', ...guard, async (req, res) => {
  const parsed = variationStructureBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const product = await productById(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found.' });

  try {
    const plan = await withActor(req.user!.id, (trx) =>
      saveStructure(trx, product.id, parsed.data, req.user!.id),
    );
    if (parsed.data.dryRun) {
      return res.json({
        preview: {
          create: plan.create.length,
          remove: plan.remove.length,
          total: plan.total,
          needsAssignment: plan.needsAssignment,
          needsStartValues: plan.needsStartValues,
          needsNewDefault: plan.needsNewDefault,
          defaultCandidates: plan.defaultCandidates,
          parentStockCleared: plan.parentStockCleared,
        },
      });
    }
    await refreshStorefront(product.id);
    return res.json(await loadAdminVariations(product.id));
  } catch (err) {
    return fail(res, err);
  }
});

/** Turn variations off (spec §3.1): every variation is deleted; the product is plain again. */
router.delete('/products/:id/variations', ...guard, async (req, res) => {
  const product = await productById(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  try {
    await withActor(req.user!.id, (trx) => removeAllVariations(trx, product.id));
  } catch (err) {
    return fail(res, err);
  }
  await refreshStorefront(product.id);
  return res.status(204).end();
});

/** Apply the same change to many variations at once (spec §6.3). */
router.post('/products/:id/variations/bulk', ...guard, async (req, res) => {
  const parsed = variationBulkBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const product = await productById(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  try {
    await withActor(req.user!.id, (trx) =>
      editVariations(trx, product.id, parsed.data.variantIds, parsed.data.set, {
        staffId: req.user!.id,
        canSeeCosts: canSeeCosts(req),
      }),
    );
  } catch (err) {
    return fail(res, err);
  }
  await refreshStorefront(product.id);
  return res.json(await loadAdminVariations(product.id));
});

router.patch('/products/:id/variations/:variantId', ...guard, async (req, res) => {
  const parsed = variationPatchBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const product = await productById(req.params.id);
  if (!product || !isUuid(req.params.variantId)) {
    return res.status(404).json({ error: 'Variation not found.' });
  }
  try {
    await withActor(req.user!.id, (trx) =>
      editVariations(trx, product.id, [req.params.variantId!], parsed.data, {
        staffId: req.user!.id,
        canSeeCosts: canSeeCosts(req),
      }),
    );
  } catch (err) {
    return fail(res, err, parsed.data.barcode, product.shop_id);
  }
  await refreshStorefront(product.id);
  return res.json(await loadAdminVariations(product.id));
});

router.post('/products/:id/variations/:variantId/default', ...guard, async (req, res) => {
  const product = await productById(req.params.id);
  if (!product || !isUuid(req.params.variantId)) {
    return res.status(404).json({ error: 'Variation not found.' });
  }
  try {
    await withActor(req.user!.id, (trx) =>
      setDefaultVariation(trx, product.id, req.params.variantId!),
    );
  } catch (err) {
    return fail(res, err);
  }
  await refreshStorefront(product.id);
  return res.json(await loadAdminVariations(product.id));
});
