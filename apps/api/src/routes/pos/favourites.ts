import { attempt, db } from '../../lib/db.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { createRouter } from '../../lib/router.js';
import { isUuid } from '../../lib/uuid.js';

export const posFavouritesRouter = createRouter();
const router = posFavouritesRouter;

/* ---------------------------------------------------------------------- */
/* Pinned favourite products (Round 5 Phase 2 #3)                           */
/* ---------------------------------------------------------------------- */
// Per-account, not shared — every route below is scoped to the caller's
// OWN staff_id (`req.user!.id`), never one supplied by the request. There
// is no route here that reads or writes anyone else's favourites. Gated on
// `pos.operate` — anyone who can use the till can pin products to it,
// nothing narrower.

/**
 * A pin belongs to one place: a category, or "All products". The place is the `category` query value;
 * absent means All products. A value that is not an id is treated the same way as absent, so a junk
 * value can never read or write another place's pins. Pins made in the old folders stay in the table
 * and are simply never read.
 */
function pinScope(req: { query: Record<string, unknown> }): string | null {
  const c = req.query.category;
  return typeof c === 'string' && isUuid(c) ? c : null;
}

router.get('/favourites', requireStaff, requirePermission('pos.operate'), async (req, res) => {
  const categoryId = pinScope(req);
  const { data, error } = await attempt(() =>
    db
      .selectFrom('staff_favourite_products')
      .select('product_id')
      .where('staff_id', '=', req.user!.id)
      .where('folder_id', 'is', null)
      .$if(categoryId === null, (qb) => qb.where('category_id', 'is', null))
      .$if(categoryId !== null, (qb) => qb.where('category_id', '=', categoryId!))
      .execute(),
  );
  if (error) return res.status(500).json({ error: 'Could not load favourites.' });
  return res.json(data.map((r) => r.product_id));
});

router.post(
  '/favourites/:productId',
  requireStaff,
  requirePermission('pos.operate'),
  async (req, res) => {
    const categoryId = pinScope(req);
    const { error } = await attempt(() =>
      db
        .insertInto('staff_favourite_products')
        .values({
          staff_id: req.user!.id,
          product_id: req.params.productId ?? '',
          category_id: categoryId,
        })
        .execute(),
    );
    // Idempotent: tapping an already-pinned product's star again must not surface a duplicate error.
    if (error && !/duplicate key|unique/i.test(error.message)) {
      return res.status(400).json({ error: 'Could not pin that product.' });
    }
    return res.status(204).end();
  },
);

/* ---------------------------------------------------------------------- */
/* The till's folders: the category tree (client changes v2, section 4)     */
/* ---------------------------------------------------------------------- */
// Gated pos.operate, not inventory.manage: anyone at the till browses by category.
router.get('/categories', requireStaff, requirePermission('pos.operate'), async (_req, res) => {
  const rows = await db
    .selectFrom('categories')
    .select(['id', 'label', 'parent_id'])
    .orderBy('label')
    .execute();
  return res.json(rows.map((c) => ({ id: c.id, label: c.label, parentId: c.parent_id })));
});

router.delete(
  '/favourites/:productId',
  requireStaff,
  requirePermission('pos.operate'),
  async (req, res) => {
    const categoryId = pinScope(req);
    const { error } = await attempt(() =>
      db
        .deleteFrom('staff_favourite_products')
        .where('staff_id', '=', req.user!.id)
        .where('product_id', '=', req.params.productId ?? '')
        .where('folder_id', 'is', null)
        .$if(categoryId === null, (qb) => qb.where('category_id', 'is', null))
        .$if(categoryId !== null, (qb) => qb.where('category_id', '=', categoryId!))
        .execute(),
    );
    if (error) return res.status(500).json({ error: 'Could not unpin that product.' });
    return res.status(204).end();
  },
);
