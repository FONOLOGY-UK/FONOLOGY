import { db, type DbError } from './db.js';
import { formatPence } from './money.js';

/**
 * Turns raw Postgres exception text — raw pence, no currency symbol, and
 * sometimes a raw UUID where a human reference exists — into something a
 * staff member can read at a till, without a customer watching them decode
 * an internal error string.
 *
 * The database keeps every one of these checks exactly as it has them; this
 * module never re-derives or loosens anything, it only rewords the message
 * that reaches the browser once the check has already fired. Formatting
 * belongs here, in apps/api, not in the DB functions themselves (which
 * should not own presentation) and not duplicated across every route that
 * happens to call one of these RPCs.
 *
 * Each function below is named for the DB function whose message it covers,
 * and comments the exact migration/line the raw message comes from — if
 * that wording is ever edited, this is the other half that has to move with
 * it, or the message silently degrades to the safe generic fallback rather
 * than showing something wrong.
 */

/**
 * record_job_payment()'s cap (0006_repairs.sql:456-459) — surfaced here
 * without ever touching error.message. The caller (jobs.routes.ts) already
 * has every figure this needs from getJobOutstanding() plus its own
 * attempted amount — there is nothing to parse, and nothing that can drift
 * out of sync with the DB's wording, because this never reads it.
 *
 * Reachable for every tender, cash included: the cap applies to all of them
 * and nothing is clamped before the RPC. The panel pre-checks the same
 * condition, so in practice this is hit by a stale outstanding figure (a
 * payment landing from another screen between the read and the write) or a
 * caller that isn't the panel.
 */
export function formatJobPaymentOverrun(args: {
  reference: string;
  attempted: number;
  newTotal: number;
  target: number;
}): string {
  return (
    `Paying ${formatPence(args.attempted)} would take ${args.reference} to ` +
    `${formatPence(args.newTotal)} — more than its ${formatPence(args.target)} price.`
  );
}

/**
 * create_refund()'s cap — current wording at
 * 0076_refund_concurrency_lock.sql:109: 'Refund amount (%) plus what has
 * already been refunded (%) would exceed what was paid (%)'. Unlike the job
 * payment case, the route doesn't already have "what's already been
 * refunded" in hand (that's a separate sum the RPC computed internally) —
 * parsing it out of the one place it's already been computed is cheaper
 * than a second query that would just recompute the same number.
 *
 * `reference` comes from the caller (pos.routes.ts already has
 * `body.reference` in scope at this call site) — the raw message never
 * named the sale/order/job at all, only its amount figures.
 */
/**
 * Returns null when the raw message isn't this specific cap — create_refund
 * also raises for "not exactly one of sale/order/job" and "not found",
 * neither reachable through the till refund route today (both are
 * pre-validated or structurally impossible before this RPC is ever called),
 * but null-on-no-match means the caller falls back to the raw message
 * rather than this function inventing a wrong "too much to refund" sentence
 * for an error that was actually something else entirely.
 */
export function formatRefundCapError(rawMessage: string, reference: string): string | null {
  const m = rawMessage.match(
    /^Refund amount \((-?\d+)\) plus what has already been refunded \((-?\d+)\) would exceed what was paid \((-?\d+)\)$/,
  );
  if (!m) return null;
  const [, attemptedStr, alreadyRefundedStr, originalTotalStr] = m;
  const attempted = Number(attemptedStr);
  const alreadyRefunded = Number(alreadyRefundedStr);
  const originalTotal = Number(originalTotalStr);
  const remaining = originalTotal - alreadyRefunded;
  return (
    `${formatPence(attempted)} is more than what's left to refund on ${reference} — ` +
    `${formatPence(remaining)} remaining.`
  );
}

/**
 * upsert_promotion_group()'s tier-price guard — current wording at
 * 0022_promotion_groups.sql:70: 'A tier price cannot be negative (got %).'
 *
 * Honest limitation, not fixed here: the raised message only ever echoes
 * the offending PRICE, never which tier (minQty is read earlier in the same
 * loop iteration — 0023_promotion_group_product_check.sql:64 — but was
 * never included in the message text), so there is no way to name "tier 2"
 * or similar from the API layer without changing the DB message itself,
 * which is a migration this batch isn't making. What this can do instead:
 * state the actual bad value clearly, in pounds, rather than a generic
 * "check the amounts entered" that gives no more than the raw error did.
 */
/**
 * Returns null when the raw message isn't this specific guard —
 * upsert_promotion_group() raises several OTHER messages on the same path
 * (no product, a duplicate product, a missing product, bad quantities, a
 * quantity clash) that are already plain English with no pence in them and
 * must reach the admin unchanged. Only this one, money-shaped message gets
 * rewritten; null-on-no-match is what stops this function from overwriting
 * a perfectly good message with a wrong one.
 */
export function formatTierPriceError(rawMessage: string): string | null {
  const m = rawMessage.match(/^A tier price cannot be negative \(got (-?\d+)\)\.$/);
  if (!m) return null;
  const negativePence = Number(m[1]);
  return `A tier price of ${formatPence(negativePence)} isn't allowed — check the tier(s) you entered.`;
}

/**
 * complete_sale()'s refusals, reworded for the till (routes/pos/sales.ts).
 *
 * The till used to show one line for all of them — "Something didn't add up completing this sale" —
 * because two of the raw messages are not fit for a cashier: one carries an internal id, the other raw
 * pence. So staff could not tell whether to lower a quantity, fix the stock count or refresh the screen.
 * Found by the deep audit of 9 Nov 2026.
 *
 * Returns null for anything it does not recognise; the route then keeps its generic line. Nothing here
 * decides whether a sale may go through - the database already refused it - this only says why.
 *
 * Raw wording matched (keep in step if a migration rewords one):
 *   'Not enough stock for product %'                  stock_consume(): 0099_master_list.sql:233 names the
 *                                                     product, 0060_product_variants.sql:334 the variation
 *   'Sale % payments (%) do not equal the total (%)'  0008_till.sql:107
 *   'Product % not found', 'Variant % not found',
 *   'Product % belongs to another shop'               complete_sale(), 0097_shop_aware_functions.sql
 *   constraints sales_discount_not_over_subtotal and sale_lines_unit_price_check
 *   SQLSTATE 22003, which lib/db.ts already words 'That amount is too large.'
 */
export async function formatSaleError(
  err: DbError,
  lines: { product_id?: string; variant_id?: string | null; quantity: number }[],
): Promise<string | null> {
  const stock = err.message.match(/^Not enough stock for product ([0-9a-f-]{36})$/i);
  if (stock) return describeShortStock(stock[1]!, lines);

  const pay = err.message.match(
    /^Sale \S+ payments \((-?\d+)\) do not equal the total \((-?\d+)\)$/,
  );
  if (pay) {
    const paid = Number(pay[1]);
    const total = Number(pay[2]);
    if (total <= 0) {
      return `A sale has to cost more than ${formatPence(0)}, so a 100% discount can't go through the till.`;
    }
    // The till adds the ticket up itself; the server adds it up again. They only disagree when the till is
    // showing an old price or offer (changed in the dashboard while the till was open), so refreshing is the fix.
    return (
      `The payments come to ${formatPence(paid)} but the total is ${formatPence(total)}. ` +
      `A price or offer may have changed - refresh the till, then ring the sale up again.`
    );
  }

  if (/^(Product|Variant) \S+ (not found|belongs to another shop)$/.test(err.message)) {
    return 'One of the items on this ticket is no longer available. Refresh the till, then ring the sale up again.';
  }
  if (err.constraint === 'sales_discount_not_over_subtotal') {
    return 'The discount is bigger than the ticket. Lower the discount, then try again.';
  }
  if (err.constraint === 'sale_lines_unit_price_check') {
    return `A price on this ticket is below ${formatPence(0)}. Correct it, then try again.`;
  }
  if (err.code === '22003') {
    return 'One of the amounts on this ticket is too large. Check the prices and quantities, then try again.';
  }
  return null;
}

/** "Only 1 of Fuzz Case – Blue in stock…", with the shelf figure as the system has it now. */
async function describeShortStock(
  id: string,
  lines: { product_id?: string; variant_id?: string | null; quantity: number }[],
): Promise<string> {
  const fallback =
    "One of the items on this ticket doesn't have enough stock on the system. Refresh the till to see what's left.";
  try {
    const variant = await db
      .selectFrom('product_variants')
      .innerJoin('products', 'products.id', 'product_variants.product_id')
      .select([
        'products.name as name',
        'product_variants.options as options',
        'product_variants.stock_qty as stock',
      ])
      .where('product_variants.id', '=', id)
      .executeTakeFirst();
    const item = variant
      ? {
          label: [
            variant.name,
            ...Object.values((variant.options ?? {}) as Record<string, string>),
          ].join(' – '),
          stock: variant.stock,
        }
      : await db
          .selectFrom('products')
          .select(['name as label', 'stock_qty as stock'])
          .where('id', '=', id)
          .executeTakeFirst();
    if (!item) return fallback;

    // The id is the variation's when the line is one (0060), the product's otherwise.
    const matching = lines.filter(
      (l) => l.variant_id === id || (!l.variant_id && l.product_id === id),
    );
    const asked = (matching.length ? matching : lines.filter((l) => l.product_id === id)).reduce(
      (sum, l) => sum + l.quantity,
      0,
    );

    if (item.stock <= 0) {
      return (
        `${item.label} is out of stock on the system. If there's one on the shelf, ` +
        `correct its stock count first (Inventory or Goods in), then sell it.`
      );
    }
    return (
      `Only ${item.stock} of ${item.label} in stock on the system` +
      (asked > item.stock ? `, so ${asked} can't be sold` : '') +
      `. Lower the quantity, or correct the stock count first if there are more on the shelf.`
    );
  } catch {
    return fallback;
  }
}
