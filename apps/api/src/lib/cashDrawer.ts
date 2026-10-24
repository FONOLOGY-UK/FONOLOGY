import { db } from './db.js';
import { shopDayRangeUtc } from './shopDay.js';
import { pettyCashSeparateFrom } from './pettyCash.js';

// What should be in one shop's cash drawer for one trading day: shared by the day close
// (routes/pos/day-close.ts) and the printed End Day summary (lib/printPayloads.ts), so the two can
// never disagree.

/**
 * expected = floatOpen + pettyIn − pettyOut + cashSales − cashRefunds − cashTradeInPayouts
 * Every term is scoped to the given trading day via shop_day(), computed
 * fresh from the ledger — never stored/cached, never trusted from a caller.
 *
 * From the petty-cash cut-over day on (0121), petty cash is its own pot and is
 * NOT in the drawer: pettyIn and pettyOut are 0 here (lib/pettyCash.ts).
 */
export async function computeExpectedCash(tradingDay: string, shopId: string) {
  const pettyInDrawer = tradingDay < (await pettyCashSeparateFrom());
  // UTC instants for this London trading day, so these filters agree with
  // shop_day() through BST rather than being an hour out. See lib/shopDay.ts.
  const { start: dayStart, endExclusive: dayEnd } = shopDayRangeUtc(tradingDay, tradingDay);

  // Let the database add the day up (not 5 queries each shipping every row to be summed in JavaScript), and
  // do all five reads from ONE snapshot so a sale landing between them cannot make the pieces disagree.
  const total = (value: unknown) => Number(value ?? 0);
  const { cashEntries, cashSales, cashRefunds, cashPayoutsSigned, cashRepairs } = await db
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (trx) => {
      const [entries, sales, refunds, payouts, repairs] = await Promise.all([
        trx
          .selectFrom('cash_entries')
          .select(['kind', (eb) => eb.fn.sum<number>('amount').as('amount')])
          .where('trading_day', '=', tradingDay)
          .where('shop_id', '=', shopId)
          .groupBy('kind')
          .execute(),
        trx
          .selectFrom('sale_payments')
          .innerJoin('sales', 'sales.id', 'sale_payments.sale_id')
          .select((eb) => eb.fn.sum<number>('sale_payments.amount').as('amount'))
          .where('sales.shop_id', '=', shopId)
          .where('sale_payments.tender', '=', 'cash')
          .where('sales.created_at', '>=', dayStart)
          .where('sales.created_at', '<', dayEnd)
          .executeTakeFirst(),
        trx
          .selectFrom('refunds')
          .select((eb) => eb.fn.sum<number>('amount').as('amount'))
          .where('shop_id', '=', shopId)
          .where('refund_tender', '=', 'cash')
          .where('created_at', '>=', dayStart)
          .where('created_at', '<', dayEnd)
          .executeTakeFirst(),
        trx
          .selectFrom('trade_in_payouts')
          .select((eb) => eb.fn.sum<number>('amount').as('amount'))
          .where('shop_id', '=', shopId)
          .where('method', '=', 'cash')
          .where('created_at', '>=', dayStart)
          .where('created_at', '<', dayEnd)
          .executeTakeFirst(),
        trx
          .selectFrom('job_payments')
          .select((eb) => eb.fn.sum<number>('amount').as('amount'))
          .where('shop_id', '=', shopId)
          .where('tender', '=', 'cash')
          .where('at', '>=', dayStart)
          .where('at', '<', dayEnd)
          .executeTakeFirst(),
      ]);
      return {
        cashEntries: entries,
        cashSales: total(sales?.amount),
        cashRefunds: total(refunds?.amount),
        cashPayoutsSigned: total(payouts?.amount),
        cashRepairs: total(repairs?.amount),
      };
    });

  let floatOpen = 0;
  let pettyIn = 0;
  let pettyOut = 0;
  for (const row of cashEntries) {
    if (row.kind === 'float_open') floatOpen += total(row.amount);
    else if (!pettyInDrawer) continue;
    else if (row.kind === 'petty_in') pettyIn += total(row.amount);
    else if (row.kind === 'petty_out') pettyOut += total(row.amount);
  }

  // trade_in_payouts.amount is already stored negative (money out) — summing
  // it directly and ADDING is the same as subtracting its absolute value.

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

  const expectedTotal =
    floatOpen + pettyIn - pettyOut + cashSales + cashRepairs - cashRefunds + cashPayoutsSigned;

  return {
    total: expectedTotal,
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
