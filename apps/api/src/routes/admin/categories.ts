import { attempt, db } from '../../lib/db.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { categoryInputBodySchema } from '../../schemas.js';
import { createRouter } from '../../lib/router.js';
import { deletedCount } from './helpers.js';

export const adminCategoriesRouter = createRouter();
const router = adminCategoriesRouter;

/* ---------------------------------------------------------------------- */
/* Categories — real CRUD, unlike products/suppliers (FEATURE-05, 0045)     */
/* ---------------------------------------------------------------------- */

function toApiCategory(row: Record<string, unknown>) {
  return {
    id: row.id,
    label: row.label,
    slug: row.slug,
    parentId: row.parent_id,
    // Client decision #14 (post-launch): Vape/Number Plates/Mobiles. Lets
    // the admin UI grey out rename/delete before the request even reaches
    // the server-side trigger that actually enforces it.
    isProtected: row.is_protected,
    createdAt: row.created_at,
  };
}

router.get(
  '/categories',
  requireStaff,
  requirePermission('inventory.manage'),
  async (_req, res) => {
    const { data, error } = await attempt(() =>
      db.selectFrom('categories').selectAll().orderBy('label').execute(),
    );
    if (error) return res.status(500).json({ error: 'Could not load categories.' });
    return res.json(data.map(toApiCategory));
  },
);

router.post(
  '/categories',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = categoryInputBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;
    // Same slugify as a product's own slug in POST /products just above —
    // deliberately never caller-supplied.
    const slug = body.label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    const { data: row, error } = await attempt(() =>
      db
        .insertInto('categories')
        .values({ label: body.label, slug, parent_id: body.parentId ?? null })
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
    if (error) {
      // categories.slug is UNIQUE — two labels that slugify the same
      // ("Vaping" / "vaping!") collide here, told honestly rather than as a
      // generic 400.
      if (error.code === '23505') {
        return res.status(409).json({ error: 'A category with this name already exists.' });
      }
      return res.status(400).json({ error: error.message });
    }
    return res.status(201).json(toApiCategory(row));
  },
);

router.put(
  '/categories/:id',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = categoryInputBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    // slug is deliberately never touched here — see categoryInputBodySchema's
    // comment. Only the display label and the parent can change.
    const patch: { label: string; parent_id?: string | null } = { label: body.label };
    if (body.parentId !== undefined) patch.parent_id = body.parentId;

    const { data: row, error } = await attempt(() =>
      db
        .updateTable('categories')
        .set(patch)
        .where('id', '=', req.params.id ?? '')
        .returningAll()
        .executeTakeFirst(),
    );
    if (error) return res.status(400).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Category not found.' });
    return res.json(toApiCategory(row));
  },
);

/**
 * Real delete, unlike products/suppliers above — categories.id has no
 * history to preserve the way a sold product or a fulfilled order does.
 * ON DELETE RESTRICT (0045) on both products.category_id and
 * categories.parent_id means this simply fails, honestly, while anything
 * still depends on the category — never a silent cascade.
 */
router.delete(
  '/categories/:id',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const { data: deleted, error } = await attempt(() =>
      db
        .deleteFrom('categories')
        .where('id', '=', req.params.id ?? '')
        .execute(),
    );
    if (error) {
      if (error.code === '23503') {
        return res.status(409).json({
          error: 'This category still has products or subcategories under it — move them first.',
        });
      }
      return res.status(400).json({ error: error.message });
    }
    if (!deletedCount(deleted)) return res.status(404).json({ error: 'Category not found.' });
    return res.status(204).end();
  },
);
