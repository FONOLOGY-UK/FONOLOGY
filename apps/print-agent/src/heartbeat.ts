import {
  AgentUnauthorizedError,
  ApiUnreachableError,
  type DeviceHealth,
  type PrintApiClient,
  type Target,
} from './api.js';
import { log } from './logger.js';
import { Sleeper, jitter } from './sleeper.js';
import type { DeviceReport, LabelTransport, ReceiptTransport } from './transports/types.js';

/**
 * The heartbeat — how a shop in Scotland stays visible from Pakistan.
 * =========================================================================
 * The people maintaining this are not in the building. "Is the printer alive?"
 * has to be answerable without phoning the shop, and it has to be answerable
 * BEFORE a customer is standing at the counter, not after.
 *
 * Three jobs, all on one timer:
 *
 *   1. LIVENESS. Updates `print_agents.last_seen_at`. The API judges staleness
 *      against shop_settings.opening_hours, so a PC switched off overnight
 *      reads as asleep rather than broken — which is why this does not need to
 *      be clever about quiet periods.
 *
 *   2. DEVICE HEALTH. Asks each transport how its printer looks and upserts
 *      the answer into print_device_health. This is where "out of paper" and
 *      "somebody unplugged the printer to charge a phone" become visible.
 *
 *   3. SETTINGS REFRESH. Re-reads printer_config and the shop's own details so
 *      that changing a setting — the printer name, the codepage, the roll size,
 *      the transport itself, or the shop's phone number — takes effect within a
 *      minute with nobody touching the shop PC. That is what makes the hardware
 *      assumptions genuinely cheap to be wrong about; a setting nobody can
 *      apply without a site visit is not a setting.
 *
 * Never throws. A heartbeat failure must never stop printing: the workers have
 * their own connection and their own backoff, and a shop that can print but
 * cannot report is in far better shape than the reverse.
 */

const INTERVAL_MS = 30_000;
const BACKOFF_CEILING_MS = 5 * 60_000;

export interface HeartbeatDeps {
  api: PrintApiClient;
  getReceiptTransport: () => ReceiptTransport;
  getLabelTransport: () => LabelTransport;
  /** Re-reads settings and rebuilds the transports if anything changed. */
  refreshConfig: () => Promise<void>;
}

export class Heartbeat {
  private stopping = false;
  private failures = 0;
  private warnedConflict = false;
  private lastPrimary: boolean | null = null;
  private readonly sleeper = new Sleeper();

  constructor(private readonly deps: HeartbeatDeps) {}

  async run(): Promise<void> {
    log.info('Heartbeat started.');
    while (!this.stopping) {
      try {
        // Settings first: if the owner has just corrected the printer name, the
        // health we report a moment later should be about the RIGHT printer.
        await this.deps.refreshConfig();

        const devices = await this.collectHealth();
        const res = await this.deps.api.heartbeat(devices);
        this.failures = 0;

        // Only log the transitions. Logging "still primary" every 30 seconds
        // would push the interesting lines out of a size-capped log within a
        // day, which is how a log becomes useless.
        if (this.lastPrimary !== res.isPrimary) {
          if (res.isPrimary) {
            log.info('This agent is the primary print agent.');
          } else {
            log.warn(
              'This agent is NOT primary and will not be given jobs. Promote it in Settings → Print agents if this is the till PC.',
            );
          }
          this.lastPrimary = res.isPrimary;
        }

        if (res.instanceConflict && !this.warnedConflict) {
          // The server has seen this token heartbeat from a different
          // installation. That is the double-print case the local lock cannot
          // see, so it is stated as plainly as possible.
          log.error(
            'ANOTHER INSTALLATION IS USING THIS AGENT TOKEN. Two agents sharing a token can double-print a receipt. ' +
              'Revoke this token and issue a new one to whichever PC should be printing.',
          );
          this.warnedConflict = true;
        } else if (!res.instanceConflict) {
          this.warnedConflict = false;
        }
      } catch (err) {
        this.onError(err);
      }

      await this.sleeper.sleep(this.failures === 0 ? INTERVAL_MS : this.backoff());
    }
    log.info('Heartbeat stopped.');
  }

  private onError(err: unknown): void {
    this.failures++;
    if (err instanceof AgentUnauthorizedError) {
      log.error(
        'Heartbeat rejected: the agent token is not valid. Issue a new one in Settings → Print agents.',
      );
      return;
    }
    if (err instanceof ApiUnreachableError) {
      // Expected during an outage, and the workers are logging it too. Warn
      // once per failure rather than escalating, so an hour offline does not
      // fill the log with identical errors.
      log.warn(`Heartbeat could not reach the API (attempt ${this.failures}).`, err);
      return;
    }
    log.error('Heartbeat failed unexpectedly.', err);
  }

  /**
   * Ask both transports how they look.
   *
   * Genuinely concurrent, because each transport now talks to its OWN print
   * host process. While they shared one, this `Promise.all` interleaved
   * nothing — and worse, a health check issued while the other printer was
   * mid-queue-wait would time out and report a healthy printer as broken.
   *
   * `check()` is contractually not allowed to throw, but this catches anyway:
   * a health check that takes the agent down would be the single most
   * embarrassing possible bug in a component whose entire job is reporting
   * that things are fine.
   */
  private async collectHealth(): Promise<DeviceHealth[]> {
    const safely = async (
      target: Target,
      check: () => Promise<DeviceReport>,
    ): Promise<DeviceHealth> => {
      try {
        return { target, ...(await check()) };
      } catch (err) {
        return { target, status: 'unknown', detail: `Health check failed: ${String(err)}` };
      }
    };

    return Promise.all([
      safely('receipt', () => this.deps.getReceiptTransport().check()),
      safely('label', () => this.deps.getLabelTransport().check()),
    ]);
  }

  private backoff(): number {
    return jitter(Math.min(INTERVAL_MS * 2 ** Math.min(this.failures, 6), BACKOFF_CEILING_MS));
  }

  stop(): void {
    this.stopping = true;
    this.sleeper.interrupt();
  }
}
