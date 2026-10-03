import { attempt, db } from '../../lib/db.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { staffNamesFor } from '../../lib/staffNames.js';
import { cashEntryInputBodySchema } from '../../schemas.js';
import { mapCashKindIn, mapCashKindOut } from './helpers.js';
import { createRouter } from '../../lib/router.js';
import { readShop, writeShop } from '../../lib/shopScope.js';
import { optionalPaging, pageWithTotals } from '../../lib/pagination.js';

export const posCashRouter = createRouter();
const router = posCashRouter;

/* ---------------------------------------------------------------------- */
/* Cash drawer                                                              */
/* ---------------------------------------------------------------------- */

router.post('/cash', requireStaff, requirePermission('cash.manage'), async (req, res) => {
  const parsed = cashEntryInputBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;
  const shopId = await writeShop(req, res);
  if (!shopId) return;

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
        shop_id: shopId,
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

router.get('/cash', requireStaff, requirePermission('cash.manage'), async (req, res) => {
  const shopId = readShop(req);
  const paging = optionalPaging(req);
  // `?date=YYYY-MM-DD` narrows to one trading day (the screen's "today" panel).
  const day =
    typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : null;
  // Paged requests may search the note.
  const term =
    paging && typeof req.query.search === 'string'
      ? req.query.search.replace(/[%_,]/g, '').trim()
      : '';
  const rows = await db
    .selectFrom('cash_entries')
    .selectAll()
    .$if(!!shopId, (qb) => qb.where('shop_id', '=', shopId!))
    .$if(!!day, (qb) => qb.where('trading_day', '=', day!))
    .$if(!!term, (qb) => qb.where('note', 'ilike', `%${term}%`))
    .orderBy('created_at', 'desc')
    .$if(!!paging, (qb) => qb.limit(paging!.limit).offset(paging!.offset))
    .execute();
  const names = await staffNamesFor(rows.map((r) => r.staff_id));
  const shaped = rows.map((row) => ({
    id: row.id,
    date: row.trading_day,
    kind: mapCashKindOut(row.kind),
    amount: row.amount,
    note: row.note,
    staffId: row.staff_id,
    staffName: names.get(row.staff_id) ?? null,
    at: row.created_at,
  }));
  if (!paging) return res.json(shaped);

  // Whole-list figures per kind, not just this page's.
  const sums = await db
    .selectFrom('cash_entries')
    .select((eb) => [
      'kind',
      eb.fn.sum<number>('amount').as('amount'),
      eb.fn.countAll<number>().as('count'),
    ])
    .$if(!!shopId, (qb) => qb.where('shop_id', '=', shopId!))
    .$if(!!day, (qb) => qb.where('trading_day', '=', day!))
    .$if(!!term, (qb) => qb.where('note', 'ilike', `%${term}%`))
    .groupBy('kind')
    .execute();
  const sumOf = (kind: string) => Number(sums.find((s) => s.kind === kind)?.amount ?? 0);
  return res.json(
    pageWithTotals(
      shaped,
      sums.reduce((n, s) => n + Number(s.count), 0),
      paging,
      {
        floatOpen: sumOf('float_open'),
        pettyIn: sumOf('petty_in'),
        pettyOut: sumOf('petty_out'),
      },
    ),
  );
});
