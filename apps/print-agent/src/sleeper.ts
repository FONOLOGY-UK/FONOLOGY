/**
 * An interruptible sleep, shared by the workers and the heartbeat.
 * =========================================================================
 * This is shutdown-correctness code, not a convenience. `index.ts` relies on a
 * sleeping loop waking IMMEDIATELY on SIGTERM rather than waiting out a
 * 60-second backoff, so that a print already in flight finishes and gets
 * acknowledged instead of becoming an `unconfirmed` receipt somebody has to
 * answer for.
 *
 * It was written twice — once in worker.ts, once in heartbeat.ts, identical
 * apart from a field name. Two copies of the null-ordering between `timer` and
 * `wake` is two places for a shutdown bug to hide.
 *
 * NOTE what is deliberately NOT shared: the backoff POLICIES. The worker
 * doubles from 1s to a 60s ceiling and resets on a successful claim; the
 * heartbeat steps from its 30s interval to a 5-minute ceiling on consecutive
 * failures. Those are different decisions about different things, and folding
 * them into one parameterised helper would obscure both.
 */
export class Sleeper {
  private timer: NodeJS.Timeout | null = null;
  private wake: (() => void) | null = null;

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.wake = resolve;
      this.timer = setTimeout(() => {
        this.timer = null;
        this.wake = null;
        resolve();
      }, ms);
    });
  }

  /** Wake a pending sleep now. Safe to call when nothing is sleeping. */
  interrupt(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.wake) {
      this.wake();
      this.wake = null;
    }
  }
}

/**
 * Spread a delay over 50–100% of its nominal value.
 *
 * Not decoration. Two workers and the heartbeat all back off together when the
 * line drops, and without jitter they would then retry in the same
 * millisecond, forever — hammering the API at the exact moment it is least
 * able to cope.
 */
export function jitter(baseMs: number): number {
  return Math.round(baseMs * (0.5 + Math.random() * 0.5));
}
