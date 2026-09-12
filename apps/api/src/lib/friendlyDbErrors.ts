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

/** Same shape as webhooks.routes.ts's own formatPence, plus a minus sign
 * that reads naturally rather than `£-5.00` — these are user-facing
 * sentences, not a receipt line, so the sign belongs on the £, not inside it. */
function formatPence(pence: number): string {
  const negative = pence < 0;
  const abs = Math.abs(pence);
  const body = `£${(abs / 100).toFixed(2)}`;
  return negative ? `-${body}` : body;
}

/**
 * record_job_payment()'s cap (0006_repairs.sql:456-459) — surfaced here
 * without ever touching error.message. The caller (jobs.routes.ts) already
 * has every figure this needs from getJobOutstanding() plus its own
 * attempted amount — there is nothing to parse, and nothing that can drift
 * out of sync with the DB's wording, because this never reads it.
 *
 * Only reachable for a non-cash tender (Item B clamps cash before the RPC
 * is ever called) or a genuine race — see jobs.routes.ts's own comment on
 * that distinction.
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
