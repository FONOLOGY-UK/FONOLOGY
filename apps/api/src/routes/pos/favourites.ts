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
 * A pin belongs to one place: a favourite folder, or "All products" (VPS report FON-006). The place
 * is the `folder` query value; absent means All products. A value that is not a folder id is treated
 * the same way as absent, so a junk value can never read or write another place's pins.
 */
function pinScope(req: { query: Record<string, unknown> }): string | null {
  const f = req.query.folder;
  return typeof f === 'string' && isUuid(f) ? f : null;
}

router.get('/favourites', requireStaff, requirePermission('pos.operate'), async (req, res) => {
  const folderId = pinScope(req);
  const { data, error } = await attempt(() =>
    db
      .selectFrom('staff_favourite_products')
      .select('product_id')
      .where('staff_id', '=', req.user!.id)
      .$if(folderId === null, (qb) => qb.where('folder_id', 'is', null))
      .$if(folderId !== null, (qb) => qb.where('folder_id', '=', folderId!))
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
    const folderId = pinScope(req);
    const { error } = await attempt(() =>
      db
        .insertInto('staff_favourite_products')
        .values({
          staff_id: req.user!.id,
          product_id: req.params.productId ?? '',
          folder_id: folderId,
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
/* Favourite folders — shop-wide, read-only from here (batch 3)             */
/* ---------------------------------------------------------------------- */
// Global, not per-staff — unlike the personal pins above. Created/edited
// in the admin dashboard (/admin/product-folders, inventory.manage); this
// is the till's own view of them, gated pos.operate same as everything
// else on this screen. Every standard till-operator permission template
// already bundles pos.operate with inventory.manage (permissions.config.ts),
// so this is never a narrower read than the product list the grid already
// needs to render at all.
router.get('/folders', requireStaff, requirePermission('pos.operate'), async (_req, res) => {
  const { data: folders, error } = await attempt(() =>
    db.selectFrom('product_folders').selectAll().orderBy('sort_order').orderBy('label').execute(),
  );
  if (error) return res.status(500).json({ error: 'Could not load folders.' });

  const items = await db
    .selectFrom('product_folder_items')
    .select(['folder_id', 'product_id'])
    .orderBy('sort_order')
    .execute();
  const itemsByFolder = new Map<string, string[]>();
  for (const row of items) {
    const list = itemsByFolder.get(row.folder_id) ?? [];
    list.push(row.product_id);
    itemsByFolder.set(row.folder_id, list);
  }

  return res.json(
    folders.map((f) => ({
      id: f.id,
      label: f.label,
      sortOrder: f.sort_order,
      productIds: itemsByFolder.get(f.id) ?? [],
    })),
  );
});

router.delete(
  '/favourites/:productId',
  requireStaff,
  requirePermission('pos.operate'),
  async (req, res) => {
    const folderId = pinScope(req);
    const { error } = await attempt(() =>
      db
        .deleteFrom('staff_favourite_products')
        .where('staff_id', '=', req.user!.id)
        .where('product_id', '=', req.params.productId ?? '')
        .$if(folderId === null, (qb) => qb.where('folder_id', 'is', null))
        .$if(folderId !== null, (qb) => qb.where('folder_id', '=', folderId!))
        .execute(),
    );
    if (error) return res.status(500).json({ error: 'Could not unpin that product.' });
    return res.status(204).end();
  },
);
