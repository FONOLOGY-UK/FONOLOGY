/**
 * Lock-out for the 4-digit till PIN (unlock and fast PIN switch).
 *
 * A PIN has only 10,000 values, so the defence has to stop guessing, not slow it. The earlier design
 * slept AFTER a wrong guess had been verified, which concurrent requests simply skip: a burst of
 * parallel guesses is all verified before any delay applies. This guard works the other way round:
 * `beginPinAttempt` runs synchronously BEFORE the PIN is verified and COUNTS the attempt immediately, so
 * the (N+1)th request of any burst is refused whatever the first N are doing. A correct PIN gives the
 * attempt back (`endPinAttempt(…, true)`).
 *
 * Several keys are charged at once — the caller's session, the account being tried, and the client IP —
 * so a single session cannot walk the staff list and several sessions cannot share one account's budget
 * without hitting the account ceiling. State is in memory (single API process, same posture as
 * `rateLimit.ts`), bounded in size and swept when it grows.
 */

interface Bucket {
  attempts: number;
  lockedUntil: number;
  level: number;
  touched: number;
}

export interface PinLimit {
  key: string;
  /** Attempts allowed before the key locks. */
  max: number;
  /** First lock, ms; each further lock within `memoryMs` doubles it up to `capMs`. */
  baseLockMs: number;
  capMs: number;
}

const MEMORY_MS = 60 * 60_000;
const MAX_KEYS = 20_000;
const buckets = new Map<string, Bucket>();

function sweep(now: number): void {
  for (const [key, b] of buckets) {
    if (now - b.touched > MEMORY_MS && b.lockedUntil <= now) buckets.delete(key);
  }
  // Still too big (a flood of distinct keys): drop the oldest rather than grow without bound.
  if (buckets.size > MAX_KEYS) {
    const oldest = [...buckets.entries()].sort((a, b) => a[1].touched - b[1].touched);
    for (const [key] of oldest.slice(0, buckets.size - MAX_KEYS)) buckets.delete(key);
  }
}

/** The standard budget for one unlock/switch attempt by a signed-in session. */
export function pinLimits(opts: {
  session: string;
  account: string;
  ip: string | undefined;
}): PinLimit[] {
  const limits: PinLimit[] = [
    { key: `session:${opts.session}`, max: 5, baseLockMs: 30_000, capMs: 15 * 60_000 },
    { key: `account:${opts.account}`, max: 15, baseLockMs: 60_000, capMs: 15 * 60_000 },
  ];
  if (opts.ip)
    limits.push({ key: `ip:${opts.ip}`, max: 30, baseLockMs: 60_000, capMs: 15 * 60_000 });
  return limits;
}

/**
 * Charges one attempt to every key. Returns 0 when the attempt may proceed, or the milliseconds until the
 * earliest key unlocks when any key is locked (nothing is charged then).
 */
export function beginPinAttempt(limits: PinLimit[], now = Date.now()): number {
  if (buckets.size >= MAX_KEYS / 2) sweep(now);
  let wait = 0;
  for (const l of limits) {
    const b = buckets.get(l.key);
    if (b && b.lockedUntil > now) wait = Math.max(wait, b.lockedUntil - now);
  }
  if (wait > 0) return wait;

  for (const l of limits) {
    let b = buckets.get(l.key);
    if (!b || now - b.touched > MEMORY_MS) {
      b = { attempts: 0, lockedUntil: 0, level: 0, touched: now };
      buckets.set(l.key, b);
    }
    b.touched = now;
    b.attempts += 1;
    if (b.attempts >= l.max) {
      // The attempt that reaches the limit is still verified; the NEXT one is refused.
      b.lockedUntil = now + Math.min(l.baseLockMs * 2 ** b.level, l.capMs);
      b.level += 1;
      b.attempts = 0;
    }
  }
  return 0;
}

/** Settles an attempt. A correct PIN refunds the attempt on every key and clears the escalation level. */
export function endPinAttempt(limits: PinLimit[], ok: boolean): void {
  if (!ok) return;
  for (const l of limits) {
    const b = buckets.get(l.key);
    if (!b) continue;
    b.attempts = Math.max(0, b.attempts - 1);
    if (b.lockedUntil <= Date.now()) b.level = 0;
  }
}
