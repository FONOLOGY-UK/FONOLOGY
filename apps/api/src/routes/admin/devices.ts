import type { Kysely } from 'kysely';
import type { DB } from '../../db/types.js';
import { db, isDbError, toDbError } from '../../lib/db.js';
import { isUuid } from '../../lib/uuid.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { deviceInputBodySchema } from '../../schemas.js';
import { createRouter } from '../../lib/router.js';

export const adminDevicesRouter = createRouter();
const router = adminDevicesRouter;

/* ---------------------------------------------------------------------- */
/* Device models — Repair + Sell-In dropdowns, and each device's repair prices */
/* ---------------------------------------------------------------------- */
// The public GET /repair/devices lists active devices only, so switching one off here removes it
// from both customer-facing flows at once. Soft-delete only: a device on a past booking, job or
// sell request never disappears from that record.
//
// Since 0109 a device carries its own repair price list, typed by hand: one
// price per repair per sub-type, or one flat price for a Diagnosis-only repair. A blank is "not
// offered on this device". The old price multiplier is gone. The price list is saved WITH the
// device, in one transaction, so a device never exists with half its prices.

type Executor = Kysely<DB>;

function toApiDevice(row: { id: string; name: string; brand: string; is_active: boolean }) {
  return { id: row.id, name: row.name, brand: row.brand, isActive: row.is_active };
}

async function pricesOf(deviceId: string, executor: Executor = db) {
  const rows = await executor
    .selectFrom('device_repair_prices')
    .select(['repair_type_id', 'sub_type_id', 'price'])
    .where('device_id', '=', deviceId)
    .execute();
  return rows.map((r) => ({
    repairTypeId: r.repair_type_id,
    subTypeId: r.sub_type_id,
    price: r.price,
  }));
}

/**
 * Replaces a device's price list with `prices` (values, never references — a list copied from
 * another device is that device's own from then on). Refuses a price for a sub-type on a
 * Diagnosis-only repair, or a flat price on a standard one, so the list always means one thing.
 */
async function savePrices(
  trx: Executor,
  deviceId: string,
  prices: { repairTypeId: string; subTypeId: string | null; price: number }[],
) {
  const repairIds = [...new Set(prices.map((p) => p.repairTypeId))];
  const repairs = repairIds.length
    ? await trx
        .selectFrom('repair_types')
        .select(['id', 'name', 'diagnosis_only'])
        .where('id', 'in', repairIds)
        .execute()
    : [];
  const byId = new Map(repairs.map((r) => [r.id, r]));
  const seen = new Set<string>();
  for (const p of prices) {
    const repair = byId.get(p.repairTypeId);
    if (!repair)
      throw new PriceError('One of those repairs no longer exists. Reload and try again.');
    if (repair.diagnosis_only && p.subTypeId) {
      throw new PriceError(`${repair.name} is diagnosis only — it takes one flat price.`);
    }
    if (!repair.diagnosis_only && !p.subTypeId) {
      throw new PriceError(`${repair.name} is priced per sub-type, not with one flat price.`);
    }
    const key = `${p.repairTypeId}:${p.subTypeId ?? ''}`;
    if (seen.has(key)) throw new PriceError(`${repair.name} has the same price entered twice.`);
    seen.add(key);
  }

  await trx.deleteFrom('device_repair_prices').where('device_id', '=', deviceId).execute();
  if (prices.length > 0) {
    await trx
      .insertInto('device_repair_prices')
      .values(
        prices.map((p) => ({
          device_id: deviceId,
          repair_type_id: p.repairTypeId,
          sub_type_id: p.subTypeId,
          price: p.price,
        })),
      )
      .execute();
  }
}

class PriceError extends Error {}

function failure(err: unknown): { status: number; error: string } {
  if (err instanceof PriceError) return { status: 400, error: err.message };
  if (isDbError(err)) {
    const e = toDbError(err);
    if (e.code === '23505' && e.constraint === 'devices_name_key') {
      return { status: 409, error: 'There is already a device with that name.' };
    }
    return { status: 400, error: e.message };
  }
  throw err;
}

router.get('/devices', requireStaff, requirePermission('inventory.manage'), async (_req, res) => {
  const rows = await db.selectFrom('devices').selectAll().orderBy('name').execute();
  return res.json(rows.map(toApiDevice));
});

/** One device's price list (the edit form, and "Duplicate pricing from existing device"). */
router.get(
  '/devices/:id/prices',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Device not found.' });
    return res.json(await pricesOf(req.params.id));
  },
);

router.post('/devices', requireStaff, requirePermission('inventory.manage'), async (req, res) => {
  const parsed = deviceInputBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;
  try {
    const row = await db.transaction().execute(async (trx) => {
      const created = await trx
        .insertInto('devices')
        .values({ name: body.name, brand: body.brand, is_active: body.isActive })
        .returningAll()
        .executeTakeFirstOrThrow();
      if (body.prices) await savePrices(trx, created.id, body.prices);
      return created;
    });
    return res.status(201).json(toApiDevice(row));
  } catch (err) {
    const f = failure(err);
    return res.status(f.status).json({ error: f.error });
  }
});

router.put(
  '/devices/:id',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = deviceInputBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Device not found.' });
    try {
      const row = await db.transaction().execute(async (trx) => {
        const updated = await trx
          .updateTable('devices')
          .set({ name: body.name, brand: body.brand, is_active: body.isActive })
          .where('id', '=', req.params.id!)
          .returningAll()
          .executeTakeFirst();
        if (updated && body.prices) await savePrices(trx, updated.id, body.prices);
        return updated;
      });
      if (!row) return res.status(404).json({ error: 'Device not found.' });
      return res.json(toApiDevice(row));
    } catch (err) {
      const f = failure(err);
      return res.status(f.status).json({ error: f.error });
    }
  },
);

router.delete(
  '/devices/:id',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Device not found.' });
    const row = await db
      .updateTable('devices')
      .set({ is_active: false })
      .where('id', '=', req.params.id)
      .returning('id')
      .executeTakeFirst();
    if (!row) return res.status(404).json({ error: 'Device not found.' });
    return res.status(204).end();
  },
);
