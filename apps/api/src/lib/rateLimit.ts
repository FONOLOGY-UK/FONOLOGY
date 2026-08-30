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
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Returns true if `key` has exceeded `max` calls within the trailing
 * `windowMs` — the counter resets the moment the window rolls over rather
 * than sliding, which is simpler and close enough for this purpose.
 */
export function isRateLimited(key: string, opts: { max: number; windowMs: number }): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart > opts.windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
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
