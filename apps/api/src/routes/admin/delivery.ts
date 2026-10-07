import { attempt, db } from '../../lib/db.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import {
  deliveryPrefixBodySchema,
  deliveryRateBodySchema,
  deliveryThresholdBodySchema,
} from '../../schemas.js';
import { createRouter } from '../../lib/router.js';
import type { Request, Response } from 'express';

export const adminDeliveryRouter = createRouter();
const router = adminDeliveryRouter;

/* ---------------------------------------------------------------------- */
/* Delivery — rates per zone, the remote postcode list, free-delivery bar  */
/* ---------------------------------------------------------------------- */
// All of it is rows (0005, 0102) read by delivery_quote(), so a price or a postcode changes
// here without a deploy, and the checkout and the charge move together. Every shop sells
// through the one website, so these are site-wide: anyone with settings.manage can look,
// only the owner changes them — the same rule as the shared half of /admin/settings.

function ownerOnly(req: Request, res: Response): boolean {
  if (req.user!.staffRole === 'owner') return true;
  res.status(403).json({ error: 'Only the owner can change delivery settings.' });
  return false;
}

async function loadDelivery() {
  const [settings, zones, rates, prefixes] = await Promise.all([
    db.selectFrom('shop_settings').select('free_delivery_threshold').executeTakeFirst(),
    db
      .selectFrom('delivery_zones')
      .select(['id', 'code', 'label'])
      .orderBy('code', 'desc')
      .execute(),
    db
      .selectFrom('delivery_rates')
      .select(['id', 'zone_id', 'method', 'price', 'available'])
      .where('method', '<>', 'collect')
      .orderBy('method')
      .execute(),
    db
      .selectFrom('delivery_postcode_prefixes')
      .select(['prefix', 'zone_id'])
      .orderBy('prefix')
      .execute(),
  ]);
  return {
    freeDeliveryThreshold: settings?.free_delivery_threshold ?? null,
    zones: zones.map((z) => ({
      id: z.id,
      code: z.code,
      label: z.label,
      rates: rates
        .filter((r) => r.zone_id === z.id)
        .map((r) => ({
          id: r.id,
          method: r.method === 'next_day' ? 'next-day' : r.method,
          price: r.price,
          available: r.available,
        })),
    })),
    prefixes: prefixes.map((p) => ({ prefix: p.prefix, zoneId: p.zone_id })),
  };
}

router.get('/delivery', requireStaff, requirePermission('settings.manage'), async (_req, res) => {
  const { data, error } = await attempt(loadDelivery);
  if (error) return res.status(500).json({ error: 'Could not load delivery settings.' });
  return res.json(data);
});

router.patch(
  '/delivery/threshold',
  requireStaff,
  requirePermission('settings.manage'),
  async (req, res) => {
    if (!ownerOnly(req, res)) return;
    const parsed = deliveryThresholdBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

    const { error } = await attempt(() =>
      db
        .updateTable('shop_settings')
        .set({ free_delivery_threshold: parsed.data.freeDeliveryThreshold })
        .where('singleton', '=', true)
        .execute(),
    );
    if (error) return res.status(400).json({ error: error.message });
    return res.json(await loadDelivery());
  },
);

router.put(
  '/delivery/rates/:id',
  requireStaff,
  requirePermission('settings.manage'),
  async (req, res) => {
    if (!ownerOnly(req, res)) return;
    const parsed = deliveryRateBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

    const { data: row, error } = await attempt(() =>
      db
        .updateTable('delivery_rates')
        .set({ price: parsed.data.price, available: parsed.data.available })
        .where('id', '=', req.params.id ?? '')
        // Collect is always free and always offered — it isn't a delivery rate to edit.
        .where('method', '<>', 'collect')
        .returning('id')
        .executeTakeFirst(),
    );
    if (error) return res.status(400).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Rate not found.' });
    return res.json(await loadDelivery());
  },
);

router.post(
  '/delivery/prefixes',
  requireStaff,
  requirePermission('settings.manage'),
  async (req, res) => {
    if (!ownerOnly(req, res)) return;
    const parsed = deliveryPrefixBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

    const { error } = await attempt(() =>
      db
        .insertInto('delivery_postcode_prefixes')
        .values({ prefix: parsed.data.prefix, zone_id: parsed.data.zoneId })
        .onConflict((oc) => oc.column('prefix').doUpdateSet({ zone_id: parsed.data.zoneId }))
        .execute(),
    );
    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json(await loadDelivery());
  },
);

router.delete(
  '/delivery/prefixes/:prefix',
  requireStaff,
  requirePermission('settings.manage'),
  async (req, res) => {
    if (!ownerOnly(req, res)) return;
    const { data: row, error } = await attempt(() =>
      db
        .deleteFrom('delivery_postcode_prefixes')
        .where('prefix', '=', (req.params.prefix ?? '').toUpperCase())
        .returning('prefix')
        .executeTakeFirst(),
    );
    if (error) return res.status(400).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Postcode not found.' });
    return res.json(await loadDelivery());
  },
);
