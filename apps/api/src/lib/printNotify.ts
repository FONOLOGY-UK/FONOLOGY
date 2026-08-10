import { EventEmitter } from 'node:events';

/**
 * Waking a parked long-poll the moment a job is enqueued.
 *
 * WHY THIS EXISTS
 * The first cut of the long-poll simply re-ran `claim_print_job` on a 400ms
 * timer until something turned up. It worked, and it was wrong twice over:
 *
 *   - Every tick was a full round trip to Postgres. Measured against the dev
 *     project, one iteration cost roughly 500–700ms, so a "2 second" poll
 *     actually took 4.5s to give up, and the agent's two loops (one per
 *     printer) would have held a permanent ~5 queries/second against the
 *     database for the entire time the shop is open, forever, to discover
 *     nothing almost every time.
 *   - The latency it bought was still only as good as the tick.
 *
 * The enqueue handler and the parked long-poll live in the SAME Node process,
 * so they can just tell each other. A waiting poll wakes on the event and
 * issues exactly one claim.
 *
 * THE SAFETY POLL IS NOT OPTIONAL
 * An in-process event is invisible to a second API instance, and it does not
 * fire for jobs that return to the queue by other routes — the lease sweep
 * requeuing a label, or a staff member choosing "reprint" on an unconfirmed
 * receipt from another process. So the wait is always `race(event, timer)`
 * with a slow timer. The event is a latency optimisation; the timer is the
 * correctness guarantee. Deleting the timer would work perfectly on one
 * instance and lose jobs silently on two.
 */

const bus = new EventEmitter();
// One listener per parked agent poll; the default cap of 10 would print a
// spurious leak warning long before anything is actually wrong.
bus.setMaxListeners(0);

const ANY = 'any';

/** Called after a job is inserted, so a parked poll can pick it up at once. */
export function notifyPrintJob(target: 'receipt' | 'label'): void {
  bus.emit(target);
  bus.emit(ANY);
}

/**
 * Wait until a job for `target` is announced, the timer fires, or the client
 * disconnects — whichever happens first. Always resolves; never rejects.
 *
 * The listener is removed on every exit path. A parked poll that leaked its
 * listener would accumulate one per request and eventually take the API down,
 * which in this shop means every till at once.
 */
export function waitForPrintJob(
  target: 'receipt' | 'label' | null,
  safetyPollMs: number,
  isAborted: () => boolean,
): Promise<void> {
  const channel = target ?? ANY;
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      bus.off(channel, finish);
      clearTimeout(timer);
      clearInterval(abortCheck);
      resolve();
    };
    const timer = setTimeout(finish, safetyPollMs);
    // Express gives us 'close' on the request, but this helper stays free of
    // the request object so it can be tested on its own.
    const abortCheck = setInterval(() => {
      if (isAborted()) finish();
    }, 250);
    bus.once(channel, finish);
  });
}
