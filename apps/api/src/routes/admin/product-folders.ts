import { attempt, db, rpc } from '../../lib/db.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { productFolderInputBodySchema } from '../../schemas.js';
import { createRouter } from '../../lib/router.js';
import { deletedCount } from './helpers.js';

export const adminProductFoldersRouter = createRouter();
const router = adminProductFoldersRouter;

/* ---------------------------------------------------------------------- */
/* Product folders — POS favourite folders (batch 3)                        */
/* ---------------------------------------------------------------------- */
// Admin-managed, shop-wide groupings of products for the till grid — see
// 0080's own comment for why this is a new table rather than reusing
// categories. Full CRUD here, gated inventory.manage same as every other
// catalogue-organising route in this file; the till's own read-only view
// is GET /pos/folders (pos.routes.ts), gated pos.operate instead.

/** One query for every folder's product ids, grouped in JS — cheaper than
 * a per-folder round trip, and this list is never long enough for the
 * grouping itself to matter. */
async function productIdsByFolder(): Promise<Map<string, string[]>> {
  const data = await db
    .selectFrom('product_folder_items')
    .select(['folder_id', 'product_id'])
    .orderBy('sort_order')
    .execute();
  const map = new Map<string, string[]>();
  for (const row of data) {
    const list = map.get(row.folder_id) ?? [];
    list.push(row.product_id);
    map.set(row.folder_id, list);
  }
  return map;
}

function folderById(id: string) {
  return db
    .selectFrom('product_folders')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
}

function toApiProductFolder(row: Record<string, unknown>, productIds: string[]) {
  return {
    id: row.id,
    label: row.label,
    sortOrder: row.sort_order,
    productIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

router.get(
  '/product-folders',
  requireStaff,
  requirePermission('inventory.manage'),
  async (_req, res) => {
    const { data, error } = await attempt(() =>
      db.selectFrom('product_folders').selectAll().orderBy('sort_order').orderBy('label').execute(),
    );
    if (error) return res.status(500).json({ error: 'Could not load folders.' });
    const itemsByFolder = await productIdsByFolder();
    return res.json(data.map((row) => toApiProductFolder(row, itemsByFolder.get(row.id) ?? [])));
  },
);

/**
 * Both create and edit go through upsert_product_folder() (0080) — folder
 * plus its whole item list in one transaction, the same reason
 * upsert_promotion_group() exists: two independent REST writes here is not
 * a transaction, and a bad product id landing on the second one would
 * otherwise leave the folder created but pointing at nothing, or pointing
 * at half its old list and half its new one on an edit. One RPC call,
 * either it all lands or none of it does.
 */
router.post(
  '/product-folders',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = productFolderInputBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    const { data: folderId, error } = await attempt(() =>
      rpc<string>('upsert_product_folder', {
        p_label: body.label,
        p_product_ids: body.productIds,
        p_sort_order: body.sortOrder ?? 0,
      }),
    );
    if (error) return res.status(400).json({ error: error.message });

    const row = await folderById(folderId);
    return res.status(201).json(toApiProductFolder(row, body.productIds));
  },
);

router.put(
  '/product-folders/:id',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = productFolderInputBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    const { data: folderId, error } = await attempt(() =>
      rpc<string>('upsert_product_folder', {
        p_label: body.label,
        p_product_ids: body.productIds,
        p_folder_id: req.params.id,
        p_sort_order: body.sortOrder ?? 0,
      }),
    );
    // upsert_product_folder raises 'Folder % not found' when p_folder_id
    // doesn't resolve — surfaced as a 404 rather than the RPC's own 400,
    // matching every other edit route in this file.
    if (error) {
      if (error.message.includes('not found')) {
        return res.status(404).json({ error: 'Folder not found.' });
      }
      return res.status(400).json({ error: error.message });
    }

    const row = await folderById(folderId);
    return res.json(toApiProductFolder(row, body.productIds));
  },
);

/** Real delete — product_folder_items cascades (0080, on delete cascade),
 * and a folder has no sale history or anything else worth preserving. */
router.delete(
  '/product-folders/:id',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const { data: deleted, error } = await attempt(() =>
      db
        .deleteFrom('product_folders')
        .where('id', '=', req.params.id ?? '')
        .execute(),
    );
    if (error) return res.status(400).json({ error: error.message });
    if (!deletedCount(deleted)) return res.status(404).json({ error: 'Folder not found.' });
    return res.status(204).end();
  },
);
