import { attempt, db, rpc } from '../../lib/db.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { saleLineCostBodySchema } from '../../schemas.js';
import { createRouter } from '../../lib/router.js';

export const posMiscLinesRouter = createRouter();
const router = posMiscLinesRouter;

/* ---------------------------------------------------------------------- */
/* Misc lines still waiting for a cost price (change request item 10)       */
/* ---------------------------------------------------------------------- */

/**
 * Every misc line rung through without a cost price, oldest first.
 *
 * The doc asks for these to be "flagged/listed in a separate view so
 * staff/admin can input the missing cost price later, ensuring accurate P&L
 * reporting". It is a filtered query rather than a new table: the line
 * already exists, `cost_price_pending` already says which ones, and a
 * separate table would be a second place the same fact is recorded and a
 * second place it can go stale.
 *
 * Oldest first on purpose — this is a to-do list, and the oldest gap is the
 * one distorting reporting for longest and the hardest to remember.
 *
 * `costs.view`, not `pos.operate`. A cost price is margin data, and this
 * endpoint returns what the shop paid for things. The till operator who rang
 * the sale through does not necessarily get to see that.
 */
router.get('/misc-lines', requireStaff, requirePermission('costs.view'), async (_req, res) => {
  const { data, error } = await attempt(() =>
    db
      .selectFrom('sale_lines')
      .leftJoin('sales', 'sales.id', 'sale_lines.sale_id')
      .select([
        'sale_lines.id',
        'sale_lines.name',
        'sale_lines.quantity',
        'sale_lines.unit_price',
        'sale_lines.line_total',
        'sale_lines.created_at',
        'sales.id as sale_id',
        'sales.reference as sale_reference',
      ])
      .where('sale_lines.cost_price_pending', '=', true)
      .orderBy('sale_lines.created_at', 'asc')
      .limit(200)
      .execute(),
  );

  if (error) return res.status(500).json({ error: 'Could not load the missing cost prices.' });

  return res.json(
    data.map((row) => ({
      id: row.id,
      name: row.name,
      quantity: row.quantity,
      unitPrice: row.unit_price,
      lineTotal: row.line_total,
      soldAt: row.created_at,
      saleId: row.sale_id ?? null,
      saleReference: row.sale_reference ?? null,
    })),
  );
});

/**
 * Record the cost of one of those lines.
 *
 * Goes through set_sale_line_cost() rather than updating the row directly,
 * because `sales.cost` is a STORED total: writing the line alone would leave
 * every profit figure for that day wrong forever, which would make this
 * feature damage the reporting it exists to protect. The function moves both,
 * re-derives `below_cost`, and refuses a line that is not actually pending —
 * so a real recorded cost cannot be quietly rewritten through this path.
 */
router.post(
  '/misc-lines/:id/cost',
  requireStaff,
  requirePermission('costs.view'),
  async (req, res) => {
    const parsed = saleLineCostBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

    const { error } = await attempt(() =>
      rpc('set_sale_line_cost', {
        p_line_id: req.params.id,
        p_cost: parsed.data.costPrice,
        p_staff_id: req.user!.id,
      }),
    );
    if (error) return res.status(409).json({ error: error.message });
    return res.status(204).end();
  },
);
