import {
  AgentUnauthorizedError,
  ApiUnreachableError,
  LeaseLostError,
  NotPrimaryError,
  type PrintApiClient,
  type PrintJob,
  type Target,
} from './api.js';
import { clearMarker, writeMarker } from './marker.js';
import { log } from './logger.js';
import { Sleeper, jitter } from './sleeper.js';
import type { Transport } from './transports/types.js';

/**
 * One worker per printer. The loop that actually gets paper out.
 * =========================================================================
 * TWO LOOPS, NOT ONE. A label job that hangs for thirty seconds must not put a
 * customer waiting at the till behind it, so receipts and labels are claimed
 * and printed independently. The server supports this directly — `target` on
 * the claim endpoint exists for exactly this reason — and each worker is given
 * its OWN print-host process so the two cannot serialise against each other
 * further down (see host.ts).
 *
 * The worker is generic over the document type it prints, so the compiler pairs
 * each one with a matching renderer and transport. It previously cast, which
 * allowed a receipt's bytes to be handed to the label transport — producing a
 * blank label that reported success and was acknowledged.
 *
 * ---------------------------------------------------------------------------
 * THE ORDER OF OPERATIONS IS THE SAFETY ARGUMENT. Do not reorder it.
 * ---------------------------------------------------------------------------
 *   1. RENDER first. Rendering is pure and can fail (a payload shape we do not
 *      know). Doing it before the marker means a render failure leaves no
 *      marker, reports reachedPrinter:false, and is safely retried.
 *   2. WRITE THE MARKER, fsynced, and only then
 *   3. SEND to the transport.
 *   4. ACK on success, and clear the marker ONLY after the server has taken
 *      the ack.
 *
 * Step 4 matters more than it looks: clearing the marker before the ack is
 * accepted opens a window where we have printed, lost power, and come back
 * with no evidence — which is a silent double print. Clearing after means the
 * worst case is a marker for a job the server already knows printed, which
 * resolves to a question nobody needs to answer. Cheap, in the safe direction.
 */

/**
 * Long enough to comfortably cover a print plus the queue wait, short enough
 * that a dead agent's receipt reaches a human quickly. Worst observed path is
 * ~40s (20s queue wait + host timeout margin).
 */
const LEASE_SECONDS = 90;

/** The server holds the poll open; its own default is 25s and its cap is 30. */
const LONG_POLL_SECONDS = 25;

const BACKOFF_START_MS = 1_000;
const BACKOFF_CEILING_MS = 60_000;
/** A revoked token or a demoted agent is not fixed by trying harder. */
const PARKED_MS = 60_000;

export interface WorkerDeps<TDoc> {
  api: PrintApiClient;
  target: Target;
  getTransport: () => Transport<TDoc>;
  /**
   * Turn a job into something this worker's transport can print.
   *
   * Passed in rather than switched on inside the worker: which layout belongs
   * to which kind is a rendering decision, and it has no business living in the
   * file that owns the marker ordering.
   */
  render: (job: PrintJob) => TDoc;
  instanceId: string;
}

export class PrintWorker<TDoc> {
  private running = false;
  private stopping = false;
  private backoffMs = BACKOFF_START_MS;
  private readonly sleeper = new Sleeper();

  constructor(private readonly deps: WorkerDeps<TDoc>) {}

  /** Never rejects: the loop owns its own errors, or the agent stops printing. */
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    log.info(`[${this.deps.target}] worker started.`);

    while (!this.stopping) {
      try {
        const job = await this.deps.api.claimNext({
          target: this.deps.target,
          leaseSeconds: LEASE_SECONDS,
          waitSeconds: LONG_POLL_SECONDS,
        });

        // A successful round trip is what resets the backoff — not a
        // successful print. An empty queue is a healthy server.
        this.backoffMs = BACKOFF_START_MS;

        if (!job) continue;
        await this.handle(job);
      } catch (err) {
        await this.handleLoopError(err);
      }
    }

    log.info(`[${this.deps.target}] worker stopped.`);
    this.running = false;
  }

  private async handleLoopError(err: unknown): Promise<void> {
    if (err instanceof AgentUnauthorizedError) {
      // Loud, and repeated every minute rather than once — this is the message
      // that explains a shop where nothing prints, and it must still be in the
      // log when somebody finally looks.
      log.error(
        `[${this.deps.target}] The agent token was rejected. Printing is stopped until a new token is issued in Settings → Print agents.`,
      );
      await this.sleeper.sleep(PARKED_MS);
      return;
    }
    if (err instanceof NotPrimaryError) {
      log.warn(
        `[${this.deps.target}] This agent is not the primary print agent, so it will not take jobs. If this is the shop's till PC, promote it in Settings → Print agents.`,
      );
      await this.sleeper.sleep(PARKED_MS);
      return;
    }
    if (err instanceof ApiUnreachableError) {
      log.warn(`[${this.deps.target}] Cannot reach the API; retrying shortly.`, err);
      await this.sleeper.sleep(this.nextBackoff());
      return;
    }
    log.error(`[${this.deps.target}] Unexpected error in the print loop.`, err);
    await this.sleeper.sleep(this.nextBackoff());
  }

  /** Exponential backoff with a ceiling, jittered — see sleeper.ts. */
  private nextBackoff(): number {
    this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_CEILING_MS);
    return jitter(this.backoffMs);
  }

  private async handle(job: PrintJob): Promise<void> {
    const started = Date.now();
    log.info(`[${this.deps.target}] job ${job.id} (${job.kind}), attempt ${job.attempts}.`);

    // ---- 1. Render. Pure, and nothing has been sent if this throws. --------
    let rendered: TDoc;
    try {
      rendered = this.deps.render(job);
    } catch (err) {
      // A payload we cannot render is not going to render on the next attempt
      // either, but it still goes back through the queue's attempt counter
      // rather than being force-failed here — the queue is the one place that
      // decides how many tries something gets.
      log.error(`[${this.deps.target}] job ${job.id} could not be rendered.`, err);
      await this.report(job, false, `Could not render this job: ${errText(err)}`);
      return;
    }

    // ---- 2. The marker. Before a single byte. -----------------------------
    try {
      writeMarker({
        jobId: job.id,
        target: this.deps.target,
        kind: job.kind,
        startedAt: new Date().toISOString(),
        instanceId: this.deps.instanceId,
      });
    } catch (err) {
      // We cannot promise not to double-print, so we do not print. A receipt
      // that did not print is a reprint; one that printed twice is a dispute.
      log.error(
        `[${this.deps.target}] job ${job.id}: could not write the safety marker, so nothing was sent.`,
        err,
      );
      await this.report(job, false, `Could not write the print marker: ${errText(err)}`);
      return;
    }

    // ---- 3. Send. ---------------------------------------------------------
    const ctx = {
      jobId: job.id,
      kind: job.kind,
      // What Windows shows in its print queue. The job id makes a stuck job
      // traceable back to a row without guessing.
      docName: `Fonology ${job.kind} ${job.id.slice(0, 8)}`,
    };

    let result;
    try {
      result = await this.deps.getTransport().send(rendered, ctx);
    } catch (err) {
      // A transport that THREW rather than returning a result has told us
      // nothing about how far it got. Fail safe.
      log.error(`[${this.deps.target}] job ${job.id}: transport threw.`, err);
      await this.report(job, true, `Transport error: ${errText(err)}`);
      return;
    }

    // ---- 4. Report the outcome. -------------------------------------------
    if (result.ok) {
      const ms = Date.now() - started;
      log.info(`[${this.deps.target}] job ${job.id} printed in ${ms}ms. ${result.detail ?? ''}`);
      try {
        const { accepted } = await this.deps.api.ack(job.id);
        if (!accepted) {
          // Our lease had already expired and the sweep moved the job on. The
          // paper still came out; the queue simply stopped waiting for us.
          log.warn(
            `[${this.deps.target}] job ${job.id} printed, but the lease had already expired — staff will be asked to confirm it.`,
          );
        }
        // Only now. See the header: clearing before the ack is accepted is the
        // window where a power cut becomes a silent double print.
        clearMarker(job.id);
      } catch (err) {
        // Printed, but we could not say so. The marker STAYS: on the next
        // start it is reported as "may have printed", which is exactly right.
        log.error(
          `[${this.deps.target}] job ${job.id} printed but the acknowledgement failed. The marker is kept.`,
          err,
        );
      }
      return;
    }

    log.warn(
      `[${this.deps.target}] job ${job.id} failed (reachedPrinter=${result.reachedPrinter}): ${result.error}`,
    );
    await this.report(job, result.reachedPrinter, result.error);
  }

  /**
   * Tell the server how it went, then clear the marker.
   *
   * THE MARKER IS CLEARED ONCE THE SERVER HAS THE REPORT, whichever way
   * `reachedPrinter` went — and that is a correction, not a loosening. The
   * marker's only job is to tell the server, on the next start, that we were
   * mid-print. Once the server has been told and has moved the job on
   * (`unconfirmed` for a receipt, requeued for a label), the marker has done
   * its work and is nothing but a stale file.
   *
   * Keeping it, as an earlier version did, meant every paper-out and every
   * queue timeout left a marker behind for the life of the process — each one
   * re-reported at the next startup only to be told the job was already
   * resolved. A bad Saturday became a slow Monday morning.
   *
   * If the report does NOT reach the server, the marker stays. That is the case
   * it exists for.
   */
  private async report(job: PrintJob, reachedPrinter: boolean, error: string): Promise<void> {
    try {
      await this.deps.api.fail(job.id, reachedPrinter, error);
    } catch (err) {
      if (err instanceof LeaseLostError) {
        // The sweep got there first and has already decided this job's fate.
        // Our news is stale, not undelivered.
        log.warn(`[${this.deps.target}] job ${job.id}: the lease was already gone when reporting.`);
        clearMarker(job.id);
        return;
      }
      log.error(`[${this.deps.target}] job ${job.id}: could not report the failure.`, err);
      // The server does not know. Keep the marker so the next start says so.
      if (reachedPrinter) return;
      clearMarker(job.id);
      return;
    }
    clearMarker(job.id);
  }

  stop(): void {
    this.stopping = true;
    this.sleeper.interrupt();
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
