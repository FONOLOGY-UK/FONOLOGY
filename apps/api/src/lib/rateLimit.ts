/**
 * Minimal in-memory rate limiter — same posture as the PIN-unlock backoff
 * in backoff.ts: single-process, resets on restart, proportionate for
 * what this API actually is (not a distributed system needing Redis).
 *
 * Built for Round 5 Phase 3 #23's guest order-tracking lookup
 * specifically: dropping the email pairing there means a bare reference —
 * sequential, unauthenticated, drawn from a single global sequence shared
 * across every order/booking/sell-request the shop has ever issued — is
 * enough on its own to get an answer back. The route's own response is
 * already the primary mitigation (courier + tracking number only, nothing
 * else); this is the second one, making a bulk sweep of the reference
 * space slow rather than free. It is not a complete defense — a
 * distributed attacker rotating IPs is not slowed by a per-IP,
 * single-process counter — but it meaningfully raises the cost of the
 * casual case, and is the same trade-off `backoff.ts` already accepted for
 * PIN attempts one door over.
 */
interface Bucket {
  count: number;
  /** When this window rolls over. Stored rather than derived because the
   *  window length is per-call, so the sweep below can't recompute it. */
  expiresAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Independent audit finding HIGH-01: nothing ever removed a key.
 *
 * The single-process design is deliberate (see the note above) — the
 * unbounded map was not. Every distinct key is an IP that touched a
 * limited route, and on a public API most of those are scanners and
 * crawlers that are never seen twice. Each one used to be retained for the
 * life of the process, so memory tracked "unique IPs since last deploy"
 * rather than "IPs currently being limited", which only ever goes up.
 *
 * Swept opportunistically on write rather than on a `setInterval`: no
 * background timer to keep the event loop alive or unref, nothing running
 * on an idle process, and the sweep only happens when the map is actually
 * big enough to be worth walking. Expired buckets are dead weight by
 * definition — `isRateLimited` treats a rolled-over window exactly like a
 * missing one, so dropping them cannot change any caller's outcome.
 */
const SWEEP_THRESHOLD = 5_000;

/**
 * A sweep walks the whole map, so it is also throttled in time, not just by
 * size. Without this, a burst that leaves 5,000+ buckets simultaneously
 * LIVE (nothing expired, nothing to free) would re-walk the entire map on
 * every subsequent request — trading a slow memory leak for an O(n)
 * per-request cost, which is the worse of the two. Bounded this way, the
 * cost is one walk a minute no matter how hard the API is being hit.
 */
const SWEEP_INTERVAL_MS = 60_000;
let nextSweepAt = 0;

function sweepExpired(now: number): void {
  nextSweepAt = now + SWEEP_INTERVAL_MS;
  for (const [key, bucket] of buckets) {
    if (now > bucket.expiresAt) buckets.delete(key);
  }
}

/**
 * Returns true if `key` has exceeded `max` calls within the trailing
 * `windowMs` — the counter resets the moment the window rolls over rather
 * than sliding, which is simpler and close enough for this purpose.
 */
export function isRateLimited(key: string, opts: { max: number; windowMs: number }): boolean {
  const now = Date.now();

  // Before inserting, not after: this is the only place the map grows, so
  // checking here is what actually bounds it.
  if (buckets.size >= SWEEP_THRESHOLD && now >= nextSweepAt) sweepExpired(now);

  const bucket = buckets.get(key);
  if (!bucket || now > bucket.expiresAt) {
    buckets.set(key, { count: 1, expiresAt: now + opts.windowMs });
    return false;
  }
  bucket.count += 1;
  return bucket.count > opts.max;
}

/**
 * Clears a key's bucket outright — for login-shaped routes that count
 * ATTEMPTS toward the cap (via `isRateLimited`, called before the outcome
 * is known — so the "current" attempt is always counted) but only want a
 * FAILURE to actually count against the caller. Call this after a genuine
 * success so a slate of a few mistyped-then-corrected attempts doesn't sit
 * there consuming headroom until the window naturally expires. Same
 * shape as `failedUnlocks.delete(sessionId)` in staff.routes.ts's PIN
 * backoff, one door over.
 */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}
