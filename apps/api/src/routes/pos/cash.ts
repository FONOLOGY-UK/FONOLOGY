import { attempt, db } from '../../lib/db.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { staffNamesFor } from '../../lib/staffNames.js';
import { cashEntryInputBodySchema } from '../../schemas.js';
import { mapCashKindIn, mapCashKindOut } from './helpers.js';
import { createRouter } from '../../lib/router.js';

export const posCashRouter = createRouter();
const router = posCashRouter;

/* ---------------------------------------------------------------------- */
/* Cash drawer                                                              */
/* ---------------------------------------------------------------------- */

router.post('/cash', requireStaff, requirePermission('cash.manage'), async (req, res) => {
  const parsed = cashEntryInputBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  const { data: row, error } = await attempt(() =>
    db
      .insertInto('cash_entries')
      // trading_day is deliberately omitted — the column default (shop_day(now()))
      // is what the schema itself specifies for "today", exactly matching
      // "use shop_day() for the trading day".
      .values({
        kind: mapCashKindIn(body.kind),
        amount: body.amount,
        note: body.note,
        staff_id: req.user!.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),
  );

  if (error) {
    // The schema's own unique index catches a second float-open for the
    // same trading day — surfaced cleanly, not re-derived here.
    if (error.code === '23505') {
      return res
        .status(409)
        .json({ error: 'An opening float has already been recorded for today.' });
    }
    return res.status(500).json({ error: 'Could not record the cash entry.' });
  }

  return res.status(201).json({
    id: row.id,
    date: row.trading_day,
    kind: mapCashKindOut(row.kind),
    amount: row.amount,
    note: row.note,
    staffId: row.staff_id,
    staffName: req.user!.name ?? null,
    at: row.created_at,
  });
});

router.get('/cash', requireStaff, requirePermission('cash.manage'), async (_req, res) => {
  const rows = await db
    .selectFrom('cash_entries')
    .selectAll()
    .orderBy('created_at', 'desc')
    .execute();
  const names = await staffNamesFor(rows.map((r) => r.staff_id));
  return res.json(
    rows.map((row) => ({
      id: row.id,
      date: row.trading_day,
      kind: mapCashKindOut(row.kind),
      amount: row.amount,
      note: row.note,
      staffId: row.staff_id,
      staffName: names.get(row.staff_id) ?? null,
      at: row.created_at,
    })),
  );
});
