import { attempt, db } from '../../lib/db.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { repairTypeInputBodySchema } from '../../schemas.js';
import { createRouter } from '../../lib/router.js';

export const adminRepairTypesRouter = createRouter();
const router = adminRepairTypesRouter;

/* ---------------------------------------------------------------------- */
/* Repair types — problems & part-quality pricing (Round 5 #33)             */
/* ---------------------------------------------------------------------- */
// `repair_types` (0006_repairs.sql) already existed with real pricing
// columns (base_price_original/oem/copy) and already fed the customer-facing
// GET /repair/types — this is the first admin write path for it. Exact same
// shape as the devices block above: gated on inventory.manage (catalogue
// upkeep, same tier as devices/categories), soft-delete only (a repair
// referenced by a real historical booking keeps its name on that record
// either way; deactivating just stops it being offered for a NEW one).

function toAdminRepairType(row: Record<string, unknown>) {
  const original = row.base_price_original as number | null;
  return {
    id: row.id,
    name: row.name,
    desc: (row.description as string | null) ?? '',
    time: (row.estimate_label as string | null) ?? '',
    isActive: row.is_active,
    base:
      original === null
        ? null
        : { original, oem: row.base_price_oem as number, copy: row.base_price_copy as number },
  };
}

router.get(
  '/repair-types',
  requireStaff,
  requirePermission('inventory.manage'),
  async (_req, res) => {
    const { data, error } = await attempt(() =>
      db.selectFrom('repair_types').selectAll().orderBy('name').execute(),
    );
    if (error) return res.status(500).json({ error: 'Could not load repair types.' });
    return res.json(data.map(toAdminRepairType));
  },
);

router.post(
  '/repair-types',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = repairTypeInputBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    const { data: row, error } = await attempt(() =>
      db
        .insertInto('repair_types')
        .values({
          name: body.name,
          description: body.desc || null,
          estimate_label: body.time || null,
          is_active: body.isActive,
          base_price_original: body.base?.original ?? null,
          base_price_oem: body.base?.oem ?? null,
          base_price_copy: body.base?.copy ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json(toAdminRepairType(row));
  },
);

router.put(
  '/repair-types/:id',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = repairTypeInputBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    const { data: row, error } = await attempt(() =>
      db
        .updateTable('repair_types')
        .set({
          name: body.name,
          description: body.desc || null,
          estimate_label: body.time || null,
          is_active: body.isActive,
          base_price_original: body.base?.original ?? null,
          base_price_oem: body.base?.oem ?? null,
          base_price_copy: body.base?.copy ?? null,
        })
        .where('id', '=', req.params.id ?? '')
        .returningAll()
        .executeTakeFirst(),
    );
    if (error) return res.status(400).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Repair type not found.' });
    return res.json(toAdminRepairType(row));
  },
);

router.delete(
  '/repair-types/:id',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const { data: row, error } = await attempt(() =>
      db
        .updateTable('repair_types')
        .set({ is_active: false })
        .where('id', '=', req.params.id ?? '')
        .returning('id')
        .executeTakeFirst(),
    );
    if (error) return res.status(400).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Repair type not found.' });
    return res.status(204).end();
  },
);
