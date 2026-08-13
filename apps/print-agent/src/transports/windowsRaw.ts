import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SPOOL_DIR } from '../paths.js';
import { log } from '../logger.js';
import { hostNumber, hostText, type PrintHost } from '../host/host.js';
import { checkWindowsPrinter, hostErrorToResult, reachedPrinterForStage } from './hostOutcome.js';
import type { DeviceReport, PrintContext, ReceiptTransport, TransportResult } from './types.js';

/**
 * ASSUMPTION 1: the POS80GXa is USB-attached and installed as a Windows
 * printer, so raw ESC/POS goes to the Windows print queue.
 * =========================================================================
 * Basis: Epos Now publishes a USB setup guide for this exact model that
 * installs it as a Windows printer; resellers list connectivity as USB/serial;
 * the shop photograph shows a combined "USB In / DC In" lead.
 *
 * IF THAT IS WRONG and the printer is actually on the LAN, nothing in this
 * file changes and no code changes at all: set
 * `shop_settings.printer_config.receipt.transport` to "tcp" and fill in
 * `host`. The tcp transport is already built and selected by
 * transports/index.ts. That is the whole point of putting the assumption in
 * data.
 *
 * ---------------------------------------------------------------------------
 * WHY THE BYTES GO VIA A TEMP FILE
 * ---------------------------------------------------------------------------
 * The host reads the job from a file rather than from its stdin. Passing tens
 * of kilobytes of binary through a PowerShell pipe means base64 and an
 * encoding negotiation that has several ways to be subtly wrong — and "subtly
 * wrong bytes" is the exact failure mode this project cannot afford, because
 * it produces a receipt that looks almost right.
 *
 * A file is boring, has no encoding, and can be inspected byte for byte when
 * something goes wrong at 5pm on a Saturday. It is deleted immediately after,
 * because a receipt is customer data.
 */
export class WindowsRawTransport implements ReceiptTransport {
  readonly name: string;

  constructor(
    private readonly host: PrintHost,
    private readonly printerName: string | null,
    /** How long to watch the Windows queue before giving up on the job. */
    private readonly queueWaitMs = 20_000,
  ) {
    this.name = `windows-raw (${printerName ?? 'NOT CONFIGURED'})`;
  }

  async send(bytes: Uint8Array, ctx: PrintContext): Promise<TransportResult> {
    if (!this.printerName) {
      // Deliberately NOT falling back to the Windows default printer. A
      // receipt quietly rendering into "Microsoft Print to PDF" because nobody
      // filled in a setting is the silent-wrong-output case this whole system
      // is built to avoid. Nothing was sent, so this is safely retryable.
      return {
        ok: false,
        reachedPrinter: false,
        error:
          'No receipt printer name is set. Set printer_config.receipt.windowsPrinterName in shop settings to the exact name Windows shows for the receipt printer.',
      };
    }

    const file = path.join(SPOOL_DIR, `${ctx.jobId}-${crypto.randomBytes(4).toString('hex')}.bin`);

    try {
      fs.writeFileSync(file, bytes);
    } catch (err) {
      // Could not even stage the bytes — certainly nothing printed.
      return {
        ok: false,
        reachedPrinter: false,
        error: `Could not write the job to ${SPOOL_DIR}: ${String(err)}`,
      };
    }

    try {
      const res = await this.host.send(
        'rawPrint',
        {
          printer: this.printerName,
          file,
          docName: ctx.docName,
          waitMs: this.queueWaitMs,
        },
        // Comfortably longer than the host's own queue wait, so a timeout here
        // means the HOST is wedged rather than the printer being slow.
        this.queueWaitMs + 15_000,
      );

      if (res.ok) {
        const queueStatus = hostText(res.queueStatus, 'unknown');
        return {
          ok: true,
          detail: `${hostNumber(res.bytesWritten, bytes.length)} bytes, Windows job ${hostText(res.jobId, '?')}, queue ${queueStatus}`,
        };
      }

      // The stage tells us how far it got, and that is exactly the
      // reachedPrinter question. The rule itself lives in hostOutcome.ts —
      // one copy, because it decides whether a receipt may reprint.
      const stage = hostText(res.stage, 'unknown');
      return {
        ok: false,
        reachedPrinter: reachedPrinterForStage('rawPrint', stage),
        error: `${hostText(res.error, 'Raw print failed.')} (stage: ${stage})`,
      };
    } catch (err) {
      return hostErrorToResult(err);
    } finally {
      try {
        fs.rmSync(file, { force: true });
      } catch (err) {
        // Leaving customer data behind is worth a log line even though it
        // cannot fail the print.
        log.warn('Could not delete a spooled job file.', err);
      }
    }
  }

  async check(): Promise<DeviceReport> {
    // The queue-depth warning is receipt-only: a receipt queue that stops
    // draining is the shape of "out of paper" long before anyone reports it,
    // whereas a label queue is expected to be lumpy.
    return checkWindowsPrinter(
      this.host,
      this.printerName,
      'No receipt printer configured (printer_config.receipt.windowsPrinterName).',
      { queueWarnAt: 5 },
    );
  }
}
