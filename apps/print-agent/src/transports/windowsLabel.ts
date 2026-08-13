import { hostText, type PrintHost } from '../host/host.js';
import { checkWindowsPrinter, hostErrorToResult, reachedPrinterForStage } from './hostOutcome.js';
import type { LabelDocument } from '../render/drawOps.js';
import type { DeviceReport, LabelTransport, PrintContext, TransportResult } from './types.js';

/**
 * The Brother QL-600, through its own Windows driver.
 * =========================================================================
 * WE NEVER TOUCH BROTHER'S RASTER PROTOCOL. The display list is drawn with
 * GDI+ onto a PrintDocument and the installed Brother driver rasterises it.
 * That is a deliberate architectural choice, not a shortcut: the raster
 * command set is undocumented enough that writing it from memory would produce
 * output that is subtly wrong, and a previous session established that the
 * obvious Node library (`node-brother-label-printer`) does not list QL-600
 * support. Going through the driver means Brother owns the part we cannot
 * verify without the device.
 *
 * The cost is a documented install step: the Brother driver must be installed
 * on the till PC (assumption 3). It is a free download and the printer is
 * unusable without it anyway.
 *
 * ---------------------------------------------------------------------------
 * WHY A DUPLICATE LABEL IS ALLOWED TO HAPPEN AND A DUPLICATE RECEIPT IS NOT
 * ---------------------------------------------------------------------------
 * This transport still reports `reachedPrinter` honestly, but the queue treats
 * the answer differently for labels: a label that may have printed is requeued
 * while attempts remain, because a duplicate label is an inch of wasted roll,
 * while a duplicate receipt is a dispute. That asymmetry lives in the database
 * (`expire_print_leases`), not here — this file just tells the truth and lets
 * the queue decide.
 */
export class WindowsLabelTransport implements LabelTransport {
  readonly name: string;

  constructor(
    private readonly host: PrintHost,
    private readonly printerName: string | null,
    private readonly queueWaitMs = 20_000,
  ) {
    this.name = `windows-label (${printerName ?? 'NOT CONFIGURED'})`;
  }

  async send(doc: LabelDocument, ctx: PrintContext): Promise<TransportResult> {
    if (!this.printerName) {
      return {
        ok: false,
        reachedPrinter: false,
        error:
          'No label printer name is set. Set printer_config.label.windowsPrinterName in shop settings to the exact name Windows shows for the Brother QL-600.',
      };
    }

    // NO PNG IS KEPT OF A PRINTED LABEL, deliberately. A bench ticket carries a
    // customer's name and phone number, so a preview per label would be a
    // slowly accumulating pile of PII on a shop PC that nothing ever prunes.
    // The fake transport writes previews because that is its whole purpose;
    // the real one does not. To debug a layout, switch the target to "fake"
    // in settings and print again.
    try {
      const res = await this.host.send(
        'drawLabel',
        {
          printer: this.printerName,
          docName: ctx.docName,
          widthMm: doc.widthMm,
          heightMm: doc.heightMm,
          dpi: 300,
          pngPath: null,
          ops: doc.ops,
          waitMs: this.queueWaitMs,
        },
        this.queueWaitMs + 20_000,
      );

      if (res.ok) {
        return { ok: true, detail: `queue ${hostText(res.queueStatus, 'unknown')}` };
      }

      // How far it got decides reachedPrinter. The rule lives in
      // hostOutcome.ts — one copy, shared with the receipt path.
      const stage = hostText(res.stage, 'unknown');
      return {
        ok: false,
        reachedPrinter: reachedPrinterForStage('drawLabel', stage),
        error: `${hostText(res.error, 'Label print failed.')} (stage: ${stage})`,
      };
    } catch (err) {
      return hostErrorToResult(err);
    }
  }

  async check(): Promise<DeviceReport> {
    return checkWindowsPrinter(
      this.host,
      this.printerName,
      'No label printer configured (printer_config.label.windowsPrinterName).',
    );
  }
}
