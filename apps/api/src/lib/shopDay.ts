/**
 * Trading-day → UTC instant boundaries, in the shop's own timezone.
 *
 * The schema groups every daily total by `public.shop_day(ts)`, which is
 * `(ts at time zone 'Europe/London')::date` (0001). Anything on this side
 * that filters a `timestamptz` column by a trading day has to agree with
 * that, or the two disagree for one hour a day through BST.
 *
 * The trap this closes: PostgREST sends an un-offset literal like
 * `2026-09-01T00:00:00`, and Postgres resolves it against the session
 * TimeZone — UTC on Supabase. Through BST that names 01:00 London, so a
 * day window built that way both misses the day's first London hour and
 * swallows the first hour of the next one. For till cash that window is
 * outside trading hours, but `transactions` includes online orders
 * (`orders.paid_at`), which land at any hour of the night.
 *
 * Offsets come from the IANA database via Intl rather than a hardcoded
 * +0/+1, so the BST switchover dates are never ours to maintain.
 */

const LONDON = 'Europe/London';

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: LONDON,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** London's UTC offset, in ms, at a given instant. */
function londonOffsetMs(instant: number): number {
  const parts = partsFormatter.formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  // `hour: '2-digit'` with hour12:false renders midnight as 24 in some ICU
  // versions; normalise it back to 0 before reassembling.
  const hour = get('hour') % 24;
  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    hour,
    get('minute'),
    get('second'),
  );
  return asIfUtc - instant;
}

/**
 * The UTC instant at which the given London calendar day begins.
 *
 * Two passes: guess using the offset at the naive instant, then re-read the
 * offset at the guess and correct. That second pass is what makes the two
 * clock-change days right — on those, the offset at 00:00 UTC and the offset
 * at the true local midnight differ.
 */
function londonDayStart(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const naive = Date.UTC(y!, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
  const guess = naive - londonOffsetMs(naive);
  return new Date(naive - londonOffsetMs(guess));
}

/**
 * Half-open UTC bounds covering the London calendar days `from`..`to`
 * inclusive, as ISO strings for PostgREST.
 *
 * Half-open on purpose: `.lt(endExclusive)` has no sub-millisecond gap for a
 * timestamp to fall through, which the old `T23:59:59.999` upper bound did.
 * Both dates are `YYYY-MM-DD`.
 */
export function shopDayRangeUtc(from: string, to: string): { start: string; endExclusive: string } {
  const start = londonDayStart(from);
  const [y, m, d] = to.split('-').map(Number);
  // Midnight starting the day AFTER `to`, named in London terms. Date.UTC
  // normalises month/year rollover, and the value is only ever used to build
  // a day string, so the UTC-vs-London distinction cannot leak here.
  const dayAfter = new Date(Date.UTC(y!, (m ?? 1) - 1, (d ?? 1) + 1)).toISOString().slice(0, 10);
  return { start: start.toISOString(), endExclusive: londonDayStart(dayAfter).toISOString() };
}
