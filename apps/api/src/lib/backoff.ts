/**
 * Escalating delay after a failed PIN unlock: 0.25s, 0.5s, 1s, 2s, then 4s
 * for every attempt after that.
 *
 * A 4-digit PIN is only 10,000 combinations. bcrypt makes each guess cost
 * something, but nothing otherwise stopped a caller trying them back to back;
 * with this, an exhaustive sweep takes hours rather than minutes.
 *
 * Deliberately NOT a lockout — locking a member of staff out of their own till
 * mid-trade is a policy decision for the client, not something to introduce
 * unasked.
 *
 * Its own module so it can be asserted directly. Timing it through the API is
 * useless here: a single unlock round-trip to Supabase from this machine takes
 * 10–20s, which swamps a 4s cap entirely.
 */
export const UNLOCK_BACKOFF_CAP_MS = 4_000;

export function unlockBackoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(250 * 2 ** (failures - 1), UNLOCK_BACKOFF_CAP_MS);
}
