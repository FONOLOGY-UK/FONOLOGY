import { attempt, db, sql } from '../../lib/db.js';
import { formatPence } from '../../lib/money.js';
import { pettyCashDay, pettyCashSeparateFrom } from '../../lib/pettyCash.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { staffNamesFor } from '../../lib/staffNames.js';
import { cashEntryInputBodySchema, scheduledPettyCashBodySchema } from '../../schemas.js';
import { mapCashKindIn, mapCashKindOut, shopDayNow } from './helpers.js';
import { createRouter } from '../../lib/router.js';
import { readShop, writeShop } from '../../lib/shopScope.js';
import { isUuid } from '../../lib/uuid.js';
import { optionalPaging, pageWithTotals, UNPAGED_LIST_CAP } from '../../lib/pagination.js';

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
  const kind = mapCashKindIn(body.kind);
  const isPetty = kind === 'petty_in' || kind === 'petty_out';

  /** Refused before anything is written; the message is the response. */
  class PettyRefusal extends Error {}

  const insert = () =>
    attempt(() =>
      db.transaction().execute(async (trx) => {
        // Petty cash is its own pot (client changes Oct 2026 #7, 0121). One shop's petty entries are
        // taken one at a time, so two Petty Cash Outs at once cannot both spend the same money.
        if (isPetty) {
          await sql`select pg_advisory_xact_lock(hashtext(${`petty-cash:${shopId}`}))`.execute(trx);
          const today = await shopDayNow();
          const petty = await pettyCashDay(shopId, today, trx);
          if (petty) {
            const closed = await trx
              .selectFrom('day_close')
              .select('id')
              .where('shop_id', '=', shopId)
              .where('trading_day', '=', today)
              .executeTakeFirst();
            // The close already counted the tin; a slip after it would vanish from the next day.
            if (closed) throw new PettyRefusal('Today is closed. Record petty cash tomorrow.');
            if (kind === 'petty_out' && body.amount > petty.expected) {
              throw new PettyRefusal(
                `Petty cash only holds ${formatPence(petty.expected)}. Add money with Petty Cash In first.`,
              );
            }
          }
        }
        return (
          trx
            .insertInto('cash_entries')
            // trading_day is deliberately omitted — the column default (shop_day(now()))
            // is what the schema itself specifies for "today", exactly matching
            // "use shop_day() for the trading day".
            .values({
              kind,
              amount: body.amount,
              note: body.note,
              staff_id: req.user!.id,
              shop_id: shopId,
            })
            .returningAll()
            .executeTakeFirstOrThrow()
        );
      }),
    );

  let result: Awaited<ReturnType<typeof insert>>;
  try {
    result = await insert();
  } catch (e) {
    // attempt() hands back database errors and rethrows everything else, including a refusal.
    if (e instanceof PettyRefusal) return res.status(409).json({ error: e.message });
    throw e;
  }
  const { data: row, error } = result;

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

/**
 * Today's petty cash for the caller's shop (client changes Oct 2026 #7, 0121): what the tin opened
 * with, today's in and out, and the balance now. `separate: false` before the cut-over day.
 */
router.get('/petty-cash', requireStaff, requirePermission('cash.manage'), async (req, res) => {
  const shopId = readShop(req) ?? req.user!.shopId ?? null;
  if (!shopId) return res.status(400).json({ error: 'Choose a shop to see its petty cash.' });
  const today = await shopDayNow();
  const [petty, separateFrom] = await Promise.all([
    pettyCashDay(shopId, today),
    pettyCashSeparateFrom(),
  ]);
  if (!petty) return res.json({ separate: false, separateFrom, date: today });
  return res.json({
    separate: true,
    separateFrom,
    date: today,
    weekStart: petty.weekStart,
    opening: petty.opening,
    cashIn: petty.cashIn,
    cashOut: petty.cashOut,
    balance: petty.expected,
  });
});

router.get('/cash', requireStaff, requirePermission('cash.manage'), async (req, res) => {
  const shopId = readShop(req);
  const paging = optionalPaging(req);
  const dayParam = (name: string) => {
    const value = req.query[name];
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  };
  // Other days' cash is for the Admin panel only: a till session and counter staff get today.
  const seesHistory = !req.user!.posOnly && req.user!.permissions?.includes('reports.view');
  const today = seesHistory ? null : await shopDayNow();
  const from = today ?? dayParam('date') ?? dayParam('from');
  // Entries booked ahead aren't part of any history until their day arrives.
  const to = today ?? dayParam('date') ?? dayParam('to') ?? (await shopDayNow());
  // Paged requests may search the note.
  const term =
    paging && typeof req.query.search === 'string'
      ? req.query.search.replace(/[%_,]/g, '').trim()
      : '';
  const rows = await db
    .selectFrom('cash_entries')
    .selectAll()
    .$if(!!shopId, (qb) => qb.where('shop_id', '=', shopId!))
    .$if(!!from, (qb) => qb.where('trading_day', '>=', from!))
    .$if(!!to, (qb) => qb.where('trading_day', '<=', to))
    .$if(!!term, (qb) => qb.where('note', 'ilike', `%${term}%`))
    .orderBy('created_at', 'desc')
    .limit(paging ? paging.limit : UNPAGED_LIST_CAP)
    .offset(paging?.offset ?? 0)
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
    scheduled: row.scheduled,
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
    .$if(!!from, (qb) => qb.where('trading_day', '>=', from!))
    .$if(!!to, (qb) => qb.where('trading_day', '<=', to))
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

/**
 * Petty Cash In booked ahead (client changes v2, 6.3; 0128): a dated entry, admin only. Nothing runs
 * on the day. pettyCashDay() starts a Monday at £0 and adds that day's entries, so an entry dated on a
 * reset day always lands after the reset.
 */
router.get(
  '/petty-cash/scheduled',
  requireStaff,
  requirePermission('reports.view'),
  async (req, res) => {
    const shopId = readShop(req);
    const today = await shopDayNow();
    const rows = await db
      .selectFrom('cash_entries')
      .select(['id', 'trading_day', 'amount', 'note'])
      .where('scheduled', '=', true)
      .where('trading_day', '>', today)
      .$if(!!shopId, (qb) => qb.where('shop_id', '=', shopId!))
      .orderBy('trading_day')
      .execute();
    return res.json(
      rows.map((r) => ({ id: r.id, date: r.trading_day, amount: r.amount, note: r.note })),
    );
  },
);

router.post(
  '/petty-cash/scheduled',
  requireStaff,
  requirePermission('reports.view'),
  async (req, res) => {
    const parsed = scheduledPettyCashBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const shopId = await writeShop(req, res);
    if (!shopId) return;
    if (parsed.data.date <= (await shopDayNow())) {
      return res.status(400).json({ error: 'Choose a date after today.' });
    }
    const row = await db
      .insertInto('cash_entries')
      .values({
        kind: 'petty_in',
        amount: parsed.data.amount,
        note: parsed.data.note,
        staff_id: req.user!.id,
        shop_id: shopId,
        trading_day: parsed.data.date,
        scheduled: true,
      })
      .returning(['id', 'trading_day', 'amount', 'note'])
      .executeTakeFirstOrThrow();
    return res
      .status(201)
      .json({ id: row.id, date: row.trading_day, amount: row.amount, note: row.note });
  },
);

/** Cancels one until its day arrives; after that it is an ordinary entry in the books. */
router.delete(
  '/petty-cash/scheduled/:id',
  requireStaff,
  requirePermission('reports.view'),
  async (req, res) => {
    const id = req.params.id ?? '';
    if (!isUuid(id)) return res.status(404).json({ error: 'Not found.' });
    const shopId = readShop(req);
    const deleted = await db
      .deleteFrom('cash_entries')
      .where('id', '=', id)
      .where('scheduled', '=', true)
      .where('trading_day', '>', await shopDayNow())
      .$if(!!shopId, (qb) => qb.where('shop_id', '=', shopId!))
      .returning('id')
      .executeTakeFirst();
    if (!deleted) return res.status(409).json({ error: 'That one has already gone in.' });
    return res.status(204).end();
  },
);
