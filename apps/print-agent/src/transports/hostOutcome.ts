import {
  HostUnavailableError,
  HostUnknownOutcomeError,
  hostNumber,
  hostText,
  type PrintHost,
} from '../host/host.js';
import type { DeviceReport, TransportResult } from './types.js';

/**
 * Everything the two Windows transports know about the print host.
 * =========================================================================
 * This module exists because the SAFETY RULE was written out twice, by hand,
 * in two files — and had already drifted apart by the time anyone looked. The
 * rule that decides whether a receipt may be reprinted automatically is not
 * something to keep two copies of.
 */

/**
 * The stages a host op can fail at BEFORE any byte can reach the device.
 *
 * These names are produced by `print-host.ps1` — the C# helper sets `r.Stage`
 * as it advances, and the label path sets it directly. Keep this in step with
 * that file; its comment points back here.
 *
 * ---------------------------------------------------------------------------
 * WHY `startPage` IS IN THE LIST (it was missing, and that was a real defect)
 * ---------------------------------------------------------------------------
 * The C# sets `Stage = "startPage"` immediately BEFORE calling
 * StartPagePrinter, and only advances to `"write"` after that call succeeds. So
 * a failure reported at `startPage` provably happened before WritePrinter was
 * ever reached: no byte left. The original list omitted it, so a
 * StartPagePrinter failure sent a receipt to `unconfirmed` and asked a member
 * of staff a question that had a knowable answer.
 *
 * That direction of error is the SAFE one — which is exactly why it survived
 * unnoticed, and exactly why the list belongs somewhere single and documented.
 */
const RAW_PRE_WRITE_STAGES = new Set(['read', 'open', 'startDoc', 'startPage']);

/**
 * The label path has only one such stage. `open` means the printer name did not
 * resolve to an installed Windows printer, so no page was ever handed over.
 * Everything later — including a throw inside `PrintDocument.Print()` — may
 * have reached the spooler.
 */
const LABEL_PRE_WRITE_STAGES = new Set(['open']);

/**
 * Did this stage happen before any byte could leave?
 *
 * Anything unrecognised answers `true` (i.e. "it may have printed"), which is
 * the fail-safe direction: a stage nobody has thought about must never be
 * treated as safe to auto-reprint. Adding a stage to the host without updating
 * this file therefore degrades to caution, not to a double print.
 */
export function reachedPrinterForStage(op: 'rawPrint' | 'drawLabel', stage: string): boolean {
  const preWrite = op === 'rawPrint' ? RAW_PRE_WRITE_STAGES : LABEL_PRE_WRITE_STAGES;
  return !preWrite.has(stage);
}

/**
 * Turn a thrown host error into a transport result.
 *
 * The distinction is the whole point:
 *   - the host never STARTED  → it never saw the command → nothing printed
 *   - the host stopped ANSWERING → it may have written → assume it printed
 */
export function hostErrorToResult(err: unknown): TransportResult {
  if (err instanceof HostUnavailableError) {
    return { ok: false, reachedPrinter: false, error: err.message };
  }
  if (err instanceof HostUnknownOutcomeError) {
    return { ok: false, reachedPrinter: true, error: err.message };
  }
  return { ok: false, reachedPrinter: true, error: String(err) };
}

/**
 * Ask Windows how a printer looks. Shared by both Windows transports, which
 * previously carried the same call and the same `/normal|idle/` reading.
 *
 * `queueWarnAt` is the only genuine difference between the two: a receipt queue
 * that stops draining is the shape of "out of paper" long before anyone reports
 * it, whereas a label queue is expected to be lumpy.
 */
export async function checkWindowsPrinter(
  host: PrintHost,
  printerName: string | null,
  missingDetail: string,
  options: { queueWarnAt?: number } = {},
): Promise<DeviceReport> {
  if (!printerName) return { status: 'error', detail: missingDetail };

  try {
    const res = await host.send('printerStatus', { printer: printerName }, 20_000);
    if (!res.ok) {
      return { status: 'error', detail: hostText(res.error, 'Printer status unavailable.') };
    }

    const status = hostText(res.printerStatus, 'Unknown');
    // "Normal" and "Idle" are both healthy answers depending on the driver.
    if (!/normal|idle/i.test(status)) {
      return { status: 'warning', detail: `Windows reports the printer as "${status}".` };
    }

    const queued = hostNumber(res.queued, 0);
    if (options.queueWarnAt !== undefined && queued > options.queueWarnAt) {
      return { status: 'warning', detail: `${queued} jobs are waiting in the Windows queue.` };
    }
    return { status: 'ok', detail: `Windows reports "${status}".` };
  } catch (err) {
    return { status: 'error', detail: `Could not reach the print host: ${String(err)}` };
  }
}
