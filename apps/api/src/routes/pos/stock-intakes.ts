import { attempt, rpc } from '../../lib/db.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { stockIntakeBodySchema } from '../../schemas.js';
import { createRouter } from '../../lib/router.js';
import { tillShop } from '../../lib/shopScope.js';
import { listIntakes } from '../../lib/inventoryLogs.js';

export const posStockIntakesRouter = createRouter();
const router = posStockIntakesRouter;

/* ---------------------------------------------------------------------- */
/* Goods in — booking a supplier delivery in at the till (0103, Log A)      */
/* ---------------------------------------------------------------------- */
// Under /pos, not /admin: a PIN-switched till session may write here (blockPosOnlySession
// refuses /admin writes). The shop is the person's own, taken by record_stock_intake() from
// the session's staff id — never from the request. A cost may be entered without costs.view;
// it is never sent back to someone without it (listIntakes).

router.post(
  '/stock-intakes',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const parsed = stockIntakeBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;

    const { data: intakeId, error } = await attempt(() =>
      rpc<string>('record_stock_intake', {
        p_staff_id: req.user!.id,
        p_lines: body.lines.map((l) => ({
          product_id: l.productId,
          variant_id: l.variantId ?? null,
          qty: l.qty,
          unit_cost: l.unitCost ?? null,
        })),
        p_supplier_name: body.supplierName ?? null,
        p_supplier_ref: body.supplierRef ?? null,
        p_notes: body.notes ?? null,
      }),
    );
    if (error) return res.status(400).json({ error: error.message });

    const { items } = await listIntakes(
      req,
      { shopId: null, from: null, to: null, search: '', id: intakeId },
      { limit: 1, offset: 0 },
    );
    const made = items.find((i) => i.id === intakeId);
    if (!made)
      return res.status(500).json({ error: 'The delivery was booked but could not be read back.' });
    return res.status(201).json(made);
  },
);

/** The till's own recent deliveries, newest first. */
router.get(
  '/stock-intakes',
  requireStaff,
  requirePermission('inventory.manage'),
  async (req, res) => {
    const shopId = tillShop(req);
    if (!shopId) return res.json([]);
    const { items } = await listIntakes(
      req,
      { shopId, from: null, to: null, search: '' },
      { limit: 15, offset: 0 },
    );
    return res.json(items);
  },
);
