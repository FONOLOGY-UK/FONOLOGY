import { attempt, db } from '../../lib/db.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { deviceInputBodySchema } from '../../schemas.js';
import { createRouter } from '../../lib/router.js';

export const adminDevicesRouter = createRouter();
const router = adminDevicesRouter;

/* ---------------------------------------------------------------------- */
/* Device models — Repair + Sell-In dropdowns (Round 4 #FEAT-01)            */
/* ---------------------------------------------------------------------- */
// `devices` (0006_repairs.sql) already existed and already fed both flows
// through the same public GET /repair/devices (is_active=true only, so
// deactivating one here removes it from both customer-facing dropdowns
// immediately — no separate wiring per flow). Gated on inventory.manage,
// not a new permission — this is catalogue upkeep, same tier as
// categories. Soft-delete only, matching every other catalogue entity in
// this app: a device referenced by a real historical booking or sell
// request never disappears from that record, it just stops being offered
// for a NEW one.

function toApiDevice(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    priceMultiplier: Number(row.price_multiplier),
    isActive: row.is_active,
  };
}

router.get('/devices', requireStaff, requirePermission('inventory.manage'), async (_req, res) => {
  const { data, error } = await attempt(() =>
    db.selectFrom('devices').selectAll().orderBy('name').execute(),
  );
  if (error) return res.status(500).json({ error: 'Could not load devices.' });
  return res.json(data.map(toApiDevice));
});

router.post('/devices', requireStaff, requirePermission('inventory.manage'), async (req, res) => {
  const parsed = deviceInputBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  const { data: row, error } = await attempt(() =>
    db
      .insertInto('devices')
      .values({
        name: body.name,
        brand: body.brand,
        price_multiplier: body.priceMultiplier,
        is_active: body.isActive,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),
  );
  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json(toApiDevice(row));
});

router.put(
  '/devices/:id',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = deviceInputBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    const { data: row, error } = await attempt(() =>
      db
        .updateTable('devices')
        .set({
          name: body.name,
          brand: body.brand,
          price_multiplier: body.priceMultiplier,
          is_active: body.isActive,
        })
        .where('id', '=', req.params.id ?? '')
        .returningAll()
        .executeTakeFirst(),
    );
    if (error) return res.status(400).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Device not found.' });
    return res.json(toApiDevice(row));
  },
);

router.delete(
  '/devices/:id',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const { data: row, error } = await attempt(() =>
      db
        .updateTable('devices')
        .set({ is_active: false })
        .where('id', '=', req.params.id ?? '')
        .returning('id')
        .executeTakeFirst(),
    );
    if (error) return res.status(400).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Device not found.' });
    return res.status(204).end();
  },
);
