import type { Kysely } from 'kysely';
import type { DB } from '../../db/types.js';
import { db, isDbError, sql, toDbError } from '../../lib/db.js';
import { isUuid } from '../../lib/uuid.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { repairSubTypeBodySchema, repairTypeInputBodySchema } from '../../schemas.js';
import { createRouter } from '../../lib/router.js';

export const adminRepairTypesRouter = createRouter();
const router = adminRepairTypesRouter;

/* ---------------------------------------------------------------------- */
/* Repair types and sub-types — definitions only (0109)  */
/* ---------------------------------------------------------------------- */
// A repair type is a definition: name, description, time estimate, the sub-types it comes in,
// and a "Diagnosis only" flag. It carries no price — prices are typed per device on Device
// Models. Soft-delete only (is_active), so a repair on a past booking or job keeps its name.
//
// Sub-types (Original, OEM, Copy by default) are a shop-wide list the admin manages here.
// Deleting one is a soft delete (removed_at): it stops being offered anywhere at once, while past
// jobs and requests that used it still read correctly.

type Executor = Kysely<DB>;

async function adminRepairTypes(executor: Executor = db, id?: string) {
  const rows = await executor
    .selectFrom('repair_types')
    .selectAll()
    .$if(!!id, (qb) => qb.where('id', '=', id!))
    .orderBy('name')
    .execute();
  const links = rows.length
    ? await executor
        .selectFrom('repair_type_sub_types as l')
        .innerJoin('repair_sub_types as st', 'st.id', 'l.sub_type_id')
        .select(['l.repair_type_id', 'l.sub_type_id'])
        .where(
          'l.repair_type_id',
          'in',
          rows.map((r) => r.id),
        )
        .where('st.removed_at', 'is', null)
        .orderBy('st.sort_order')
        .execute()
    : [];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    desc: r.description ?? '',
    time: r.estimate_label ?? '',
    isActive: r.is_active,
    diagnosisOnly: r.diagnosis_only,
    subTypeIds: links.filter((l) => l.repair_type_id === r.id).map((l) => l.sub_type_id),
  }));
}

/** Saves which sub-types a repair comes in. A Diagnosis-only repair comes in none. */
async function saveLinks(
  trx: Executor,
  repairTypeId: string,
  diagnosisOnly: boolean,
  ids: string[],
) {
  await trx
    .deleteFrom('repair_type_sub_types')
    .where('repair_type_id', '=', repairTypeId)
    .execute();
  const wanted = diagnosisOnly ? [] : [...new Set(ids)];
  if (wanted.length === 0) return;
  const live = await trx
    .selectFrom('repair_sub_types')
    .select('id')
    .where('id', 'in', wanted)
    .where('removed_at', 'is', null)
    .execute();
  if (live.length !== wanted.length) {
    throw new BadRequest('One of those sub-types has been deleted. Reload and try again.');
  }
  await trx
    .insertInto('repair_type_sub_types')
    .values(wanted.map((sub_type_id) => ({ repair_type_id: repairTypeId, sub_type_id })))
    .execute();
}

class BadRequest extends Error {}

function failure(err: unknown, what: string): { status: number; error: string } {
  if (err instanceof BadRequest) return { status: 400, error: err.message };
  if (isDbError(err)) {
    const e = toDbError(err);
    if (e.code === '23505')
      return { status: 409, error: `There is already a ${what} with that name.` };
    return { status: 400, error: e.message };
  }
  throw err;
}

router.get(
  '/repair-types',
  requireStaff,
  requirePermission('inventory.manage'),
  async (_req, res) => res.json(await adminRepairTypes()),
);

router.post(
  '/repair-types',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = repairTypeInputBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;
    try {
      const id = await db.transaction().execute(async (trx) => {
        const row = await trx
          .insertInto('repair_types')
          .values({
            name: body.name,
            description: body.desc || null,
            estimate_label: body.time || null,
            is_active: body.isActive,
            diagnosis_only: body.diagnosisOnly,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await saveLinks(trx, row.id, body.diagnosisOnly, body.subTypeIds);
        return row.id;
      });
      return res.status(201).json((await adminRepairTypes(db, id))[0]);
    } catch (err) {
      const f = failure(err, 'repair');
      return res.status(f.status).json({ error: f.error });
    }
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
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Repair type not found.' });
    const id = req.params.id;
    try {
      const found = await db.transaction().execute(async (trx) => {
        const row = await trx
          .updateTable('repair_types')
          .set({
            name: body.name,
            description: body.desc || null,
            estimate_label: body.time || null,
            is_active: body.isActive,
            diagnosis_only: body.diagnosisOnly,
          })
          .where('id', '=', id)
          .returning('id')
          .executeTakeFirst();
        if (!row) return false;
        await saveLinks(trx, id, body.diagnosisOnly, body.subTypeIds);
        // Switching between diagnosis-only and standard changes what a price means: the old
        // kind of price no longer applies, so it is cleared rather than left meaning something
        // else. (Per-device prices for a sub-type the repair no longer comes in are kept, and
        // simply not offered — ticking the sub-type again brings them back.)
        await trx
          .deleteFrom('device_repair_prices')
          .where('repair_type_id', '=', id)
          .where(
            body.diagnosisOnly
              ? sql<boolean>`sub_type_id is not null`
              : sql<boolean>`sub_type_id is null`,
          )
          .execute();
        return true;
      });
      if (!found) return res.status(404).json({ error: 'Repair type not found.' });
      return res.json((await adminRepairTypes(db, id))[0]);
    } catch (err) {
      const f = failure(err, 'repair');
      return res.status(f.status).json({ error: f.error });
    }
  },
);

router.delete(
  '/repair-types/:id',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Repair type not found.' });
    const row = await db
      .updateTable('repair_types')
      .set({ is_active: false })
      .where('id', '=', req.params.id)
      .returning('id')
      .executeTakeFirst();
    if (!row) return res.status(404).json({ error: 'Repair type not found.' });
    return res.status(204).end();
  },
);

/* ---- Sub-types --------------------------------------------------------------------------- */

function toApiSubType(r: {
  id: string;
  name: string;
  strap_line: string | null;
  warranty_label: string;
  sort_order: number;
}) {
  return {
    id: r.id,
    name: r.name,
    strap: r.strap_line ?? '',
    warranty: r.warranty_label,
    sortOrder: r.sort_order,
  };
}

router.get(
  '/repair-sub-types',
  requireStaff,
  requirePermission('inventory.manage'),
  async (_req, res) => {
    const rows = await db
      .selectFrom('repair_sub_types')
      .selectAll()
      .where('removed_at', 'is', null)
      .orderBy('sort_order')
      .orderBy('name')
      .execute();
    return res.json(rows.map(toApiSubType));
  },
);

router.post(
  '/repair-sub-types',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = repairSubTypeBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;
    try {
      const last = await db
        .selectFrom('repair_sub_types')
        .select((eb) => eb.fn.max('sort_order').as('max'))
        .executeTakeFirst();
      const row = await db
        .insertInto('repair_sub_types')
        .values({
          name: body.name,
          strap_line: body.strap || null,
          warranty_label: body.warranty ?? '',
          sort_order: body.sortOrder ?? Number(last?.max ?? 0) + 1,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return res.status(201).json(toApiSubType(row));
    } catch (err) {
      const f = failure(err, 'sub-type');
      return res.status(f.status).json({ error: f.error });
    }
  },
);

router.put(
  '/repair-sub-types/:id',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = repairSubTypeBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Sub-type not found.' });
    try {
      const row = await db
        .updateTable('repair_sub_types')
        .set({
          name: body.name,
          strap_line: body.strap || null,
          warranty_label: body.warranty ?? '',
          ...(body.sortOrder !== undefined ? { sort_order: body.sortOrder } : {}),
        })
        .where('id', '=', req.params.id)
        .where('removed_at', 'is', null)
        .returningAll()
        .executeTakeFirst();
      if (!row) return res.status(404).json({ error: 'Sub-type not found.' });
      return res.json(toApiSubType(row));
    } catch (err) {
      const f = failure(err, 'sub-type');
      return res.status(f.status).json({ error: f.error });
    }
  },
);

/**
 * Soft delete (the client's choice for C-3): the sub-type disappears from every repair and every
 * device's offer at once, and past jobs and requests that used it keep reading right. Its device
 * prices are kept but never offered again.
 */
router.delete(
  '/repair-sub-types/:id',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Sub-type not found.' });
    const row = await db
      .updateTable('repair_sub_types')
      .set({ removed_at: sql<string>`now()` })
      .where('id', '=', req.params.id)
      .where('removed_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    if (!row) return res.status(404).json({ error: 'Sub-type not found.' });
    return res.status(204).end();
  },
);
