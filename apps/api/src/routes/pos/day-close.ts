import { attempt, db } from '../../lib/db.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { dayCloseBodySchema } from '../../schemas.js';
import { shopDayNow } from './helpers.js';
import { createRouter } from '../../lib/router.js';
import { readShop, writeShop } from '../../lib/shopScope.js';
import { optionalPaging, pageWithTotals, UNPAGED_LIST_CAP } from '../../lib/pagination.js';
import { pettyCashDay } from '../../lib/pettyCash.js';
import { computeExpectedCash } from '../../lib/cashDrawer.js';

export const posDayCloseRouter = createRouter();
const router = posDayCloseRouter;

/* ---------------------------------------------------------------------- */
/* End-of-day close                                                          */
/* ---------------------------------------------------------------------- */
/**
 * No adapter/UI wiring — same as B1's PIN lock, there is no DataAdapter
 * method or component for day-close anywhere in the frontend yet. Built and
 * proven directly against dev via real requests, ready for a future admin
 * pass to wire a hook + component to it.
 */

/**
 * Red-team finding #6c (MEDIUM, confirmed — `variance` was computed and
 * returned, but nothing anywhere flagged a bad one; every day-close read
 * exactly the same regardless of size). £10 is a judgment call, not a
 * business rule handed down anywhere else in this schema: small enough to
 * still catch a shortfall worth asking about, large enough that ordinary
 * till noise (a miscounted coin bag, a petty-cash slip logged a day late —
 * see day_close's own table comment, 0008) doesn't flag every single day
 * and train whoever reviews these to ignore the flag. Shortfall only
 * (negative variance) — a till with MORE than expected is a different,
 * lower-urgency anomaly the brief didn't ask for. Doesn't block day-close;
 * this app never has (0008's own comment: a variance is visibility, not an
 * accusation) — it only adds something to actually see.
 */
const DAY_CLOSE_SHORTFALL_ALERT_THRESHOLD = 1000; // £10, in pence

function dayCloseVarianceFlagged(variance: number): boolean {
  return variance < -DAY_CLOSE_SHORTFALL_ALERT_THRESHOLD;
}

router.post('/day-close', requireStaff, requirePermission('cash.manage'), async (req, res) => {
  const parsed = dayCloseBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  // Each shop closes its own day against its own drawer.
  const shopId = await writeShop(req, res);
  if (!shopId) return;

  const today = await shopDayNow();

  const expected = await computeExpectedCash(today, shopId);

  // Petty cash is counted on its own, from the cut-over day on (client changes Oct 2026 #7, 0121).
  const petty = await pettyCashDay(shopId, today);
  if (petty && body.pettyCountedAmount === undefined) {
    return res.status(400).json({ error: 'Count the petty cash tin too.' });
  }
  const pettyColumns =
    petty && body.pettyCountedAmount !== undefined
      ? {
          petty_cash_opening: petty.opening,
          petty_cash_in: petty.cashIn,
          petty_cash_out: petty.cashOut,
          petty_cash_expected: petty.expected,
          petty_cash_counted: body.pettyCountedAmount,
        }
      : {};

  const { data: row, error } = await attempt(() =>
    db
      .insertInto('day_close')
      .values({
        trading_day: today,
        shop_id: shopId,
        expected_amount: expected.total,
        counted_amount: body.countedAmount,
        note: body.note ?? null,
        staff_id: req.user!.id,
        // Snapshot of how expected.total was reached, stored alongside it
        // (0024, extended to seven terms by 0031). The DB checks these sum
        // back to expected_amount.
        float_open: expected.breakdown.floatOpen,
        petty_in: expected.breakdown.pettyIn,
        petty_out: expected.breakdown.pettyOut,
        cash_sales: expected.breakdown.cashSales,
        cash_repairs: expected.breakdown.cashRepairs,
        cash_refunds: expected.breakdown.cashRefunds,
        cash_payouts: expected.breakdown.cashPayouts,
        ...pettyColumns,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),
  );

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'This trading day has already been closed.' });
    }
    return res.status(500).json({ error: 'Could not record the day close.' });
  }

  return res.status(201).json({
    id: row.id,
    date: row.trading_day,
    expectedAmount: row.expected_amount,
    countedAmount: row.counted_amount,
    variance: row.variance,
    varianceFlagged: dayCloseVarianceFlagged(row.variance),
    note: row.note,
    staffId: row.staff_id,
    at: row.created_at,
    breakdown: expected.breakdown,
    pettyCash: toApiPettyCash(row),
  });
});

/** The petty cash count stored with a close (0121), or null for a close before the cut-over. */
function toApiPettyCash(row: {
  petty_cash_opening: number | null;
  petty_cash_in: number | null;
  petty_cash_out: number | null;
  petty_cash_expected: number | null;
  petty_cash_counted: number | null;
  petty_cash_variance: number | null;
}) {
  if (row.petty_cash_opening === null || row.petty_cash_counted === null) return null;
  return {
    opening: row.petty_cash_opening,
    cashIn: row.petty_cash_in ?? 0,
    cashOut: row.petty_cash_out ?? 0,
    expected: row.petty_cash_expected ?? 0,
    counted: row.petty_cash_counted,
    variance: row.petty_cash_variance ?? 0,
  };
}

/**
 * The stored breakdown, or null for a row closed before 0024 existed. Never
 * recomputed from today's ledger — see 0024's own note: a reconstructed
 * breakdown can disagree with the `expected_amount` beside it.
 */
function toApiBreakdown(row: Record<string, unknown>) {
  if (row.float_open === null || row.float_open === undefined) return null;
  return {
    floatOpen: row.float_open,
    pettyIn: row.petty_in,
    pettyOut: row.petty_out,
    cashSales: row.cash_sales,
    // Null on rows closed between 0024 and 0031 — they were reconciled
    // before repair cash was counted, and 0031 deliberately does not restate
    // their expected figure. Coalesced to 0 so the shape stays uniform.
    cashRepairs: row.cash_repairs ?? 0,
    cashRefunds: row.cash_refunds,
    cashPayouts: row.cash_payouts,
  };
}

router.get('/day-close', requireStaff, requirePermission('cash.manage'), async (req, res) => {
  const shopId = readShop(req);
  const paging = optionalPaging(req);
  const rows = await db
    .selectFrom('day_close')
    .selectAll()
    .$if(!!shopId, (qb) => qb.where('shop_id', '=', shopId!))
    .orderBy('trading_day', 'desc')
    .limit(paging ? paging.limit : UNPAGED_LIST_CAP)
    .offset(paging?.offset ?? 0)
    .execute();
  const shaped = rows.map((row) => ({
    id: row.id,
    date: row.trading_day,
    expectedAmount: row.expected_amount,
    countedAmount: row.counted_amount,
    variance: row.variance,
    varianceFlagged: dayCloseVarianceFlagged(row.variance),
    note: row.note,
    staffId: row.staff_id,
    at: row.created_at,
    breakdown: toApiBreakdown(row),
    pettyCash: toApiPettyCash(row),
  }));
  if (!paging) return res.json(shaped);

  const whole = await db
    .selectFrom('day_close')
    .select((eb) => [
      eb.fn.countAll<number>().as('count'),
      eb.fn.sum<number>('variance').as('variance'),
    ])
    .$if(!!shopId, (qb) => qb.where('shop_id', '=', shopId!))
    .executeTakeFirstOrThrow();
  return res.json(
    pageWithTotals(shaped, Number(whole.count), paging, { variance: Number(whole.variance ?? 0) }),
  );
});

/**
 * What the drawer should hold in cash right now (today's trading day), for guarding money going OUT:
 * a cash refund or payout larger than this would take the drawer below zero.
 */
export async function expectedCashInDrawerNow(shopId: string): Promise<number> {
  const today = await shopDayNow();
  return (await computeExpectedCash(today, shopId)).total;
}
