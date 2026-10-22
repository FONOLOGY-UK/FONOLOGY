import type { Kysely } from 'kysely';
import type { DB } from '../db/types.js';
import { db } from './db.js';

/**
 * Petty cash as its own pot (client changes, Oct 2026 #7; 0121) — the one place the rule lives.
 *
 *   * From shop_settings.petty_cash_separate_from on, Petty Cash In / Out (cash_entries) are not
 *     part of the drawer: the day close's expected drawer figure leaves them out
 *     (routes/pos/day-close.ts computeExpectedCash).
 *   * A day OPENS with what the most recent day close of the same week counted in the tin, plus any
 *     petty entries after that close; with no close yet this week, with what the week's entries add
 *     up to. Monday always opens at £0 — the week starts again (the client's rule; what happens to
 *     money left on a Sunday night is theirs to decide later).
 *   * expected = opening + in − out for the day. That is the balance "now" while the day is open,
 *     and what the day close counts against.
 *
 * Days are the shop's trading days (YYYY-MM-DD, Europe/London, from shop_day()), so plain string
 * comparison orders them.
 */

type Executor = Kysely<DB>;

export interface PettyCashDay {
  /** The Monday this day's week started on. */
  weekStart: string;
  opening: number;
  cashIn: number;
  cashOut: number;
  /** opening + cashIn − cashOut. */
  expected: number;
}

/** First trading day on which petty cash is separate from the drawer. */
export async function pettyCashSeparateFrom(executor: Executor = db): Promise<string> {
  const row = await executor
    .selectFrom('shop_settings')
    .select('petty_cash_separate_from')
    .limit(1)
    .executeTakeFirst();
  return row?.petty_cash_separate_from ?? '2000-01-01';
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The Monday on or before `day`. */
export function mondayOf(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

/**
 * One shop's petty cash for one trading day, or null when that day is before the cut-over (petty
 * cash was still part of the drawer then).
 */
export async function pettyCashDay(
  shopId: string,
  day: string,
  executor: Executor = db,
): Promise<PettyCashDay | null> {
  const separateFrom = await pettyCashSeparateFrom(executor);
  if (day < separateFrom) return null;

  const weekStart = mondayOf(day);
  const start = weekStart > separateFrom ? weekStart : separateFrom;

  // The last close this week (before today) that counted the tin: its count is where we carry on from.
  let base = 0;
  let entriesFrom = start;
  if (day > start) {
    const close = await executor
      .selectFrom('day_close')
      .select(['trading_day', 'petty_cash_counted'])
      .where('shop_id', '=', shopId)
      .where('trading_day', '>=', start)
      .where('trading_day', '<', day)
      .where('petty_cash_counted', 'is not', null)
      .orderBy('trading_day', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (close && close.petty_cash_counted !== null) {
      base = close.petty_cash_counted;
      entriesFrom = addDays(close.trading_day, 1);
    }
  }

  const rows = await executor
    .selectFrom('cash_entries')
    .select(['kind', 'trading_day', (eb) => eb.fn.sum<number>('amount').as('amount')])
    .where('shop_id', '=', shopId)
    .where('kind', 'in', ['petty_in', 'petty_out'])
    .where('trading_day', '>=', entriesFrom)
    .where('trading_day', '<=', day)
    .groupBy(['kind', 'trading_day'])
    .execute();

  let before = 0;
  let cashIn = 0;
  let cashOut = 0;
  for (const r of rows) {
    const amount = Number(r.amount ?? 0);
    const signed = r.kind === 'petty_in' ? amount : -amount;
    if (r.trading_day < day) before += signed;
    else if (r.kind === 'petty_in') cashIn += amount;
    else cashOut += amount;
  }

  const opening = base + before;
  return { weekStart, opening, cashIn, cashOut, expected: opening + cashIn - cashOut };
}
