import { z } from 'zod';
import { attempt, db } from '../../lib/db.js';
import { isUuid } from '../../lib/uuid.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { createRouter } from '../../lib/router.js';

export const adminShopsRouter = createRouter();
const router = adminShopsRouter;

/* ---------------------------------------------------------------------- */
/* Shops — owner only                                                       */
/* ---------------------------------------------------------------------- */
// A new shop is data, not code: adding one is an insert here. Its stock starts empty (it pulls
// products from the master list as it trades), its staff are assigned from the Staff screen, and
// its hours, receipt text, float and card limits are set in Settings with that shop selected.

const shopFields = {
  name: z.string().trim().min(2, 'Name the shop').max(80),
  // No code: the database assigns F01, F02 … on insert and refuses any change to it (0106).
  address: z.string().trim().max(300).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().email('Enter a valid email').nullable().optional().or(z.literal('')),
  sortOrder: z.number().int().min(0).max(1000).optional(),
};

const createBody = z.object(shopFields);
const updateBody = z.object({
  ...Object.fromEntries(Object.entries(shopFields).map(([k, v]) => [k, v.optional()])),
  isActive: z.boolean().optional(),
} as { [K in keyof typeof shopFields]: z.ZodOptional<(typeof shopFields)[K]> } & {
  isActive: z.ZodOptional<z.ZodBoolean>;
});

function toApiShop(row: {
  id: string;
  code: string;
  name: string;
  sort_order: number;
  is_fulfilment_hub: boolean;
  is_active: boolean;
  address: string | null;
  phone: string | null;
  email: string | null;
}) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    sortOrder: row.sort_order,
    isHub: row.is_fulfilment_hub,
    isActive: row.is_active,
    address: row.address,
    phone: row.phone,
    email: row.email,
  };
}

const COLUMNS = [
  'id',
  'code',
  'name',
  'sort_order',
  'is_fulfilment_hub',
  'is_active',
  'address',
  'phone',
  'email',
] as const;

/** Every shop including closed ones, with its details — the Shops screen. */
router.get('/shops', requireStaff, requirePermission('settings.manage'), async (req, res) => {
  if (req.user!.staffRole !== 'owner') {
    return res.status(403).json({ error: 'Only the owner manages shops.' });
  }
  const rows = await db
    .selectFrom('shops')
    .select([...COLUMNS])
    .orderBy('sort_order')
    .orderBy('created_at')
    .execute();
  return res.json(rows.map(toApiShop));
});

router.post('/shops', requireStaff, requirePermission('settings.manage'), async (req, res) => {
  if (req.user!.staffRole !== 'owner') {
    return res.status(403).json({ error: 'Only the owner manages shops.' });
  }
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  const last = await db
    .selectFrom('shops')
    .select((eb) => eb.fn.max('sort_order').as('m'))
    .executeTakeFirst();

  const { data: row, error } = await attempt(() =>
    db
      .insertInto('shops')
      .values({
        name: body.name,
        address: body.address ?? null,
        phone: body.phone ?? null,
        email: body.email || null,
        // New shops trade after the ones that exist; stock is taken from lower numbers first.
        sort_order: body.sortOrder ?? (last?.m ?? 0) + 1,
      })
      .returning([...COLUMNS])
      .executeTakeFirstOrThrow(),
  );
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  return res.status(201).json(toApiShop(row));
});

router.put('/shops/:id', requireStaff, requirePermission('settings.manage'), async (req, res) => {
  if (req.user!.staffRole !== 'owner') {
    return res.status(403).json({ error: 'Only the owner manages shops.' });
  }
  const id = req.params.id ?? '';
  if (!isUuid(id)) return res.status(404).json({ error: 'Shop not found.' });
  const parsed = updateBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  const existing = await db
    .selectFrom('shops')
    .select(['id', 'is_fulfilment_hub'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!existing) return res.status(404).json({ error: 'Shop not found.' });

  // The hub takes the website, online repairs and trade-ins; closing it would orphan all three.
  if (body.isActive === false && existing.is_fulfilment_hub) {
    return res.status(409).json({
      error:
        'This is the shop that fulfils online orders, repairs and trade-ins — it cannot be closed.',
    });
  }
  // A closed shop must not strand its people: they would have no till to work at.
  if (body.isActive === false) {
    const staff = await db
      .selectFrom('staff')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('shop_id', '=', id)
      .where('is_active', '=', true)
      .executeTakeFirstOrThrow();
    if (Number(staff.n) > 0) {
      return res.status(409).json({
        error: `${staff.n} active staff still work here. Move or deactivate them first.`,
      });
    }
  }

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.address !== undefined) patch.address = body.address;
  if (body.phone !== undefined) patch.phone = body.phone;
  if (body.email !== undefined) patch.email = body.email || null;
  if (body.sortOrder !== undefined) patch.sort_order = body.sortOrder;
  if (body.isActive !== undefined) patch.is_active = body.isActive;

  const { data: row, error } = await attempt(() =>
    Object.keys(patch).length === 0
      ? db
          .selectFrom('shops')
          .select([...COLUMNS])
          .where('id', '=', id)
          .executeTakeFirstOrThrow()
      : db
          .updateTable('shops')
          .set(patch)
          .where('id', '=', id)
          .returning([...COLUMNS])
          .executeTakeFirstOrThrow(),
  );
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  return res.json(toApiShop(row));
});
