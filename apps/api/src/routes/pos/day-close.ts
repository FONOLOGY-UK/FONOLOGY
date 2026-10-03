import { attempt, db } from '../../lib/db.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { dayCloseBodySchema } from '../../schemas.js';
import { shopDayRangeUtc } from '../../lib/shopDay.js';
import { shopDayNow } from './helpers.js';
import { createRouter } from '../../lib/router.js';
import { readShop, writeShop } from '../../lib/shopScope.js';
import { optionalPaging, pageWithTotals } from '../../lib/pagination.js';

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
  });
});

/**
 * expected = floatOpen + pettyIn − pettyOut + cashSales − cashRefunds − cashTradeInPayouts
 * Every term is scoped to the given trading day via shop_day(), computed
 * fresh from the ledger — never stored/cached, never trusted from a caller.
 */
async function computeExpectedCash(tradingDay: string, shopId: string) {
  // UTC instants for this London trading day, so these filters agree with
  // shop_day() through BST rather than being an hour out. See lib/shopDay.ts.
  const { start: dayStart, endExclusive: dayEnd } = shopDayRangeUtc(tradingDay, tradingDay);

  const sum = (rows: { amount: number }[]) => rows.reduce((s, r) => s + r.amount, 0);
  const [cashEntries, cashSaleRows, cashRefundRows, cashPayoutRows, cashRepairRows] =
    await Promise.all([
      db
        .selectFrom('cash_entries')
        .select(['kind', 'amount'])
        .where('trading_day', '=', tradingDay)
        .where('shop_id', '=', shopId)
        .execute(),
      // Cash sale payments for sales created on this trading day (shop_day of
      // the sale's created_at, via a join filtered in SQL by the same day
      // window — sales.created_at is timestamptz, trading_day is a plain date
      // matching shop_day()'s own Europe/London conversion).
      db
        .selectFrom('sale_payments')
        .innerJoin('sales', 'sales.id', 'sale_payments.sale_id')
        .select('sale_payments.amount')
        .where('sales.shop_id', '=', shopId)
        .where('sale_payments.tender', '=', 'cash')
        .where('sales.created_at', '>=', dayStart)
        .where('sales.created_at', '<', dayEnd)
        .execute(),
      db
        .selectFrom('refunds')
        .select('amount')
        .where('shop_id', '=', shopId)
        .where('refund_tender', '=', 'cash')
        .where('created_at', '>=', dayStart)
        .where('created_at', '<', dayEnd)
        .execute(),
      db
        .selectFrom('trade_in_payouts')
        .select('amount')
        .where('shop_id', '=', shopId)
        .where('method', '=', 'cash')
        .where('created_at', '>=', dayStart)
        .where('created_at', '<', dayEnd)
        .execute(),
      // Cash taken on repairs (deposits and balances) — see cashRepairs below.
      db
        .selectFrom('job_payments')
        .select('amount')
        .where('shop_id', '=', shopId)
        .where('tender', '=', 'cash')
        .where('at', '>=', dayStart)
        .where('at', '<', dayEnd)
        .execute(),
    ]);

  let floatOpen = 0;
  let pettyIn = 0;
  let pettyOut = 0;
  for (const row of cashEntries) {
    if (row.kind === 'float_open') floatOpen += row.amount;
    else if (row.kind === 'petty_in') pettyIn += row.amount;
    else if (row.kind === 'petty_out') pettyOut += row.amount;
  }

  const cashSales = sum(cashSaleRows);
  const cashRefunds = sum(cashRefundRows);
  // trade_in_payouts.amount is already stored negative (money out) — summing
  // it directly and ADDING is the same as subtracting its absolute value.
  const cashPayoutsSigned = sum(cashPayoutRows);

  // Cash taken on repairs (deposits and balances). record_job_payment writes
  // ONLY to job_payments — no sale, no sale_payments row — so this money is
  // in the drawer but was invisible to this calculation until 0031, giving a
  // phantom overage on every day a repair was paid in cash.
  //
  // Cannot double-count with cashSales: the jobs routes never call
  // complete_sale, so a job payment can never also be a sale payment.
  //
  // No matching subtraction for repair refunds: the refunds query above
  // filters only on refund_tender, not on what the refund is linked to, so a
  // cash refund of a repair deposit is already inside cashRefunds. Adding a
  // term here would subtract it twice.
  const cashRepairs = sum(cashRepairRows);

  const total =
    floatOpen + pettyIn - pettyOut + cashSales + cashRepairs - cashRefunds + cashPayoutsSigned;

  return {
    total,
    breakdown: {
      floatOpen,
      pettyIn,
      pettyOut,
      cashSales,
      cashRepairs,
      cashRefunds,
      cashPayouts: -cashPayoutsSigned, // reported as a positive "amount paid out" for readability
    },
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
    .$if(!!paging, (qb) => qb.limit(paging!.limit).offset(paging!.offset))
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
