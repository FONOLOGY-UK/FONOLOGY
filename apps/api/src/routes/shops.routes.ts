import { db } from '../lib/db.js';
import { requireStaff } from '../middleware/auth.js';
import { createRouter } from '../lib/router.js';
import { seesAllShops } from '../lib/shopScope.js';

export const shopsRouter = createRouter();

/**
 * The shops a signed-in member of staff can see: owners and managers every open shop (for the
 * shop switcher and the side-by-side report), everyone else only their own (so the till can say
 * which shop it is). Nothing here is sensitive — names, codes and the public address — but it is
 * not public: the list of shops is for staff.
 *
 * Creating and editing shops is `/admin/shops` (owner only, behind the PIN-switch block).
 */
shopsRouter.get('/', requireStaff, async (req, res) => {
  const rows = await db
    .selectFrom('shops')
    .select(['id', 'code', 'name', 'sort_order', 'is_fulfilment_hub', 'is_active'])
    .where('is_active', '=', true)
    .$if(!seesAllShops(req), (qb) => qb.where('id', '=', req.user!.shopId ?? ''))
    .orderBy('sort_order')
    .orderBy('created_at')
    .execute();
  return res.json(
    rows.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      sortOrder: s.sort_order,
      isHub: s.is_fulfilment_hub,
      isActive: s.is_active,
    })),
  );
});
