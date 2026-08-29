/** Small date helpers shared by admin filters, prompts and reports. */

/**
 * Europe/London calendar day as "YYYY-MM-DD" — the shop's own day, not the
 * viewing device's.
 *
 * Round 5 #36: this used to read `date.getFullYear()/getMonth()/getDate()`,
 * the BROWSER's local time zone. A till or an admin laptop with its OS clock
 * set to anything other than the UK — or just the ambiguity around a BST
 * transition — could disagree with the server's own trading-day boundary,
 * which has always been correctly Europe/London (`shop_day()` in Postgres,
 * `apps/api/src/lib/printHealth.ts`'s `londonNow()`). This mirrors
 * `londonNow()`'s own `formatToParts` approach rather than string-parsing
 * `toLocaleDateString`'s assembled output, which has changed shape between
 * ICU versions and would make the separator/order load-bearing.
 *
 * Used by the float-open prompt (is today's float already recorded?), the
 * cash-drawer view, and the admin date-range picker — all three now agree
 * with the server regardless of what time zone the device thinks it's in.
 */
export function isoDay(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  // en-CA's assembled format is already YYYY-MM-DD, but pulling the parts
  // directly (rather than trusting the assembled string) is what keeps this
  // independent of any locale/ICU formatting quirk — same reasoning as
  // londonNow()'s own comment.
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Europe/London day `days` back from today, as "YYYY-MM-DD".
 *
 * Round 5 #36: subtracting via `Date.setDate/getDate` operates on the
 * DEVICE's local calendar components, not London's — a device far enough
 * from the UK could walk the wrong number of London calendar days near
 * midnight in either zone. Anchoring the subtraction to noon UTC on
 * London's "today" sidesteps that: noon is never within a few hours of a
 * DST boundary in either direction, so `setUTCDate` can't cross into a
 * different London day than intended.
 */
export function isoDaysAgo(days: number): string {
  const today = isoDay();
  const [y, m, d] = today.split('-').map(Number);
  const anchor = new Date(Date.UTC(y as number, (m as number) - 1, d as number, 12));
  anchor.setUTCDate(anchor.getUTCDate() - days);
  return isoDay(anchor);
}

/** "Sat 19 Jul" style display for an ISO day or timestamp. */
export function formatDay(value: string): string {
  return new Date(value).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** "19 Jul, 14:32" for timestamps in dense tables. */
export function formatDateTime(value: string): string {
  const d = new Date(value);
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}
