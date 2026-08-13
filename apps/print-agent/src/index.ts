import { ensureStateDirs, STATE_DIR } from './paths.js';
import { ConfigError, loadAgentConfig, type AgentConfig } from './config.js';
import { log, setLogLevel } from './logger.js';
import { AlreadyRunningError, claimSingleInstance, loadInstanceId } from './instance.js';
import { readOrphanedMarkers, clearMarker, sweepTempMarkers } from './marker.js';
import {
  PrintApiClient,
  ApiUnreachableError,
  LeaseLostError,
  AgentUnauthorizedError,
  type PrintJob,
} from './api.js';
import { defaultPrinterConfig, type PrinterConfig } from './printerConfig.js';
import { fallbackShopDetails, type ShopDetails } from './shopDetails.js';
import { PrintHost } from './host/host.js';
import { buildLabelTransport, buildReceiptTransport } from './transports/index.js';
import type { LabelTransport, ReceiptTransport } from './transports/types.js';
import type { LabelDocument } from './render/drawOps.js';
import {
  assertBarcodeSupported,
  assertCodepageSupported,
  renderPayoutReceipt,
  renderRefundReceipt,
  renderSaleReceipt,
  renderTestPrint,
  renderUnknownReceipt,
} from './render/receipt.js';
import {
  renderJobLabel,
  renderShelfLabel,
  renderTestLabel,
  renderUnknownLabel,
} from './render/label.js';
import { isUkTimezoneAvailable } from './render/sanitise.js';
import { PrintWorker } from './worker.js';
import { Heartbeat } from './heartbeat.js';
import { AGENT_VERSION } from './version.js';

/**
 * The Fonology print agent.
 * =========================================================================
 * Runs on the till PC inside the shop, because nothing else can: a browser
 * cannot open a raw socket or claim a USB device, and apps/api runs on a VPS
 * in Germany that cannot reach a printer on a Glasgow shop's private LAN.
 *
 * It PULLS work — the server never pushes. An outbound poll traverses a
 * consumer router with no configuration at all, while inbound would need port
 * forwarding or a tunnel: fragile, and a security liability pointed at a
 * printer that must never be on the internet.
 *
 * Startup order below is deliberate and worth keeping:
 *
 *   1. Directories, so the marker write can never fail for want of a folder.
 *   2. Config, which fails loudly and by name rather than guessing.
 *   3. The single-instance lock, BEFORE anything touches the queue — two
 *      agents on one PC is a double-printed receipt.
 *   4. Then start printing, with last session's unfinished business reported
 *      alongside rather than in front of it (see recoverOrphanedMarkers).
 */

interface Runtime {
  printerConfig: PrinterConfig;
  shop: ShopDetails;
  receipt: ReceiptTransport;
  label: LabelTransport;
}

async function main(): Promise<void> {
  ensureStateDirs();

  let cfg: AgentConfig;
  try {
    cfg = loadAgentConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      // Before the logger has a level set, and possibly before anyone has ever
      // read a log here — so this goes to both.
      log.error(err.message);
      process.stderr.write(`\n${err.message}\n\n`);
      process.exitCode = 2;
      return;
    }
    throw err;
  }
  setLogLevel(cfg.logLevel);

  log.info(`Fonology print agent ${AGENT_VERSION} starting.`, {
    state: STATE_DIR,
    api: cfg.apiBaseUrl,
    platform: `${process.platform} ${process.arch}`,
    node: process.version,
  });

  // ---- The local lock. Nothing below may run twice on one machine. --------
  let lock;
  try {
    lock = await claimSingleInstance(cfg.lockPort);
  } catch (err) {
    if (err instanceof AlreadyRunningError) {
      log.error(err.message);
      process.stderr.write(`\n${err.message}\n\n`);
      process.exitCode = 3;
      return;
    }
    throw err;
  }

  const instanceId = loadInstanceId();
  log.info(`Installation id ${instanceId}.`);

  sweepTempMarkers();

  const api = new PrintApiClient(cfg, instanceId);

  // ONE HOST PER PRINTER. The host's command loop is serial, so a shared one
  // would put a receipt behind a label that is waiting on a paper-out queue —
  // the exact thing the two-worker split exists to prevent. See host.ts.
  const receiptHost = new PrintHost('receipt');
  const labelHost = new PrintHost('label');

  // ---- Settings, with honest fallbacks, fetched concurrently. -------------
  const [printerConfig, shop] = await Promise.all([
    api.fetchPrinterConfig().catch((err) => {
      // Starting on defaults beats not starting: the shop can still print, and
      // the heartbeat re-fetches within a minute. The defaults ARE the values
      // in migration 0033, so this is not an invention.
      log.warn('Could not fetch printer configuration; falling back to defaults.', err);
      return defaultPrinterConfig();
    }),
    api.fetchShopDetails().catch((err) => {
      log.warn('Could not fetch shop details; the receipt header will be sparse.', err);
      return fallbackShopDetails();
    }),
  ]);
  log.info('Loaded settings from the API.', summarise(printerConfig));

  // A bad codepage throws inside the encoder MID-RECEIPT. Checking it now
  // turns that into one clear line at startup instead of a customer waiting
  // while a job fails three times.
  try {
    assertCodepageSupported(printerConfig.receipt);
  } catch (err) {
    log.error('Receipt codepage is not usable — receipts will fail until this is corrected.', err);
  }

  // An unsupported barcode symbology does NOT throw inside the encoder — it
  // emits nothing at all. Without this check, receipts would print with no
  // scannable reference and no error anywhere in the log.
  try {
    assertBarcodeSupported(printerConfig.receipt);
  } catch (err) {
    log.error('Receipt barcodes will not print.', err);
  }

  // Printed times are pinned to Europe/London. If this runtime has no ICU data
  // the agent still prints, but marked UTC — so it must be visible in the log
  // rather than discovered on a customer's receipt.
  if (!isUkTimezoneAvailable()) {
    log.error(
      'This Node runtime cannot resolve the Europe/London timezone, so receipt times will print as UTC. Install a standard Node 20+ build (full ICU).',
    );
  }

  const rt: Runtime = {
    printerConfig,
    shop,
    receipt: buildReceiptTransport(printerConfig, receiptHost),
    label: buildLabelTransport(printerConfig, labelHost),
  };
  log.info(`Transports: receipt=${rt.receipt.name}, label=${rt.label.name}`);

  // Warm both hosts now rather than on the first sale: the interop compile
  // costs ~850ms each and should be spent while the shop is opening, not while
  // a customer waits. NOT awaited — a wedged PowerShell must not hold up the
  // workers, which have their own timeouts and would report the problem
  // properly anyway.
  if (receiptHost.isSupported()) {
    void Promise.all([receiptHost.ping(), labelHost.ping()]).then(([r, l]) =>
      log.info(`Print hosts ready: receipt=${r}, label=${l}.`),
    );
  } else {
    log.warn(
      `Not running on Windows (${process.platform}) — the Windows transports cannot work here. Use FONOLOGY_FORCE_FAKE=1 for the fake printer.`,
    );
  }

  // ---- Run. ---------------------------------------------------------------
  const receiptWorker = new PrintWorker<Uint8Array>({
    api,
    target: 'receipt',
    getTransport: () => rt.receipt,
    render: (job) => renderReceipt(job, rt),
    instanceId,
  });
  const labelWorker = new PrintWorker<LabelDocument>({
    api,
    target: 'label',
    getTransport: () => rt.label,
    render: (job) => renderLabel(job, rt),
    instanceId,
  });

  const heartbeat = new Heartbeat({
    api,
    getReceiptTransport: () => rt.receipt,
    getLabelTransport: () => rt.label,
    refreshConfig: async () => {
      const [fresh, freshShop] = await Promise.all([
        api.fetchPrinterConfig(),
        api.fetchShopDetails(),
      ]);

      if (JSON.stringify(freshShop) !== JSON.stringify(rt.shop)) {
        log.info('Shop details changed.');
        rt.shop = freshShop;
      }

      if (JSON.stringify(fresh) === JSON.stringify(rt.printerConfig)) return;

      // Rebuilt rather than mutated: the transports capture their printer name
      // and host at construction, and a half-updated transport is exactly the
      // kind of state that prints to yesterday's printer.
      log.info('Printer configuration changed; rebuilding transports.', summarise(fresh));
      rt.printerConfig = fresh;
      rt.receipt = buildReceiptTransport(fresh, receiptHost);
      rt.label = buildLabelTransport(fresh, labelHost);
      try {
        assertCodepageSupported(fresh.receipt);
      } catch (err) {
        log.error('The new receipt codepage is not usable.', err);
      }
      try {
        assertBarcodeSupported(fresh.receipt);
      } catch (err) {
        log.error('Receipt barcodes will not print with the new configuration.', err);
      }
    },
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`Received ${signal}; shutting down.`);
    receiptWorker.stop();
    labelWorker.stop();
    heartbeat.stop();
    await Promise.all([receiptHost.stop(), labelHost.stop()]);
    lock.release();
    // Not process.exit(): letting the loops unwind means a print already in
    // flight finishes and gets acknowledged rather than becoming an
    // unconfirmed receipt somebody has to answer for.
    process.exitCode = 0;
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // An unhandled rejection in an unattended agent is a bug we cannot debug
  // from here. Logged rather than fatal: a crash loop at a counter is worse
  // than a degraded agent, and the Scheduled Task's restart policy covers a
  // genuine death.
  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled promise rejection.', reason);
  });
  process.on('uncaughtException', (err) => {
    log.error('Uncaught exception.', err);
  });

  // Last session's unfinished business, reported ALONGSIDE the workers rather
  // than in front of them — see recoverOrphanedMarkers for why that is safe.
  void recoverOrphanedMarkers(api);

  await Promise.all([receiptWorker.run(), labelWorker.run(), heartbeat.run()]);
}

/* ==========================================================================
 * Which layout belongs to which kind
 * ======================================================================== */

function renderReceipt(job: PrintJob, rt: Runtime): Uint8Array {
  switch (job.kind) {
    case 'sale_receipt':
      return renderSaleReceipt(job.payload, rt.printerConfig.receipt, rt.shop);
    case 'refund_receipt':
      return renderRefundReceipt(job.payload, rt.printerConfig.receipt, rt.shop);
    case 'payout_receipt':
      return renderPayoutReceipt(job.payload, rt.printerConfig.receipt, rt.shop);
    case 'test_print':
      return renderTestPrint(job.payload, rt.printerConfig.receipt, rt.shop);
    default:
      return renderUnknownReceipt(job.kind, rt.printerConfig.receipt);
  }
}

function renderLabel(job: PrintJob, rt: Runtime): LabelDocument {
  switch (job.kind) {
    case 'job_label':
      return renderJobLabel(job.payload, rt.printerConfig.label);
    case 'shelf_label':
      return renderShelfLabel(job.payload, rt.printerConfig.label);
    case 'test_print':
      return renderTestLabel(job.payload, rt.printerConfig.label);
    default:
      return renderUnknownLabel(job.kind, rt.printerConfig.label);
  }
}

/**
 * Report anything we were mid-print on when we stopped.
 *
 * A marker on disk means bytes MAY have reached a printer. Reporting it as
 * `reachedPrinter: true` sends a receipt to `unconfirmed`, where a person is
 * asked whether paper came out — the one question no algorithm can answer.
 *
 * WHY THIS RUNS ALONGSIDE THE WORKERS RATHER THAN BEFORE THEM
 * The server's lease sweep (`expire_print_leases`) reaches exactly the same
 * conclusion on its own when the lease runs out. This just gets there sooner,
 * so staff are asked while they still remember the sale. Since it is not
 * load-bearing, it must not be allowed to delay the first print of the day:
 * each report has a 15-second timeout, and blocking startup on a slow link
 * would be minutes of a dead till to save a few minutes of a server sweep.
 *
 * Markers are per-job, so reporting job X while a worker claims job Y cannot
 * interfere. If the API is unreachable we leave the markers alone and try
 * again next start; nothing is lost either way.
 */
async function recoverOrphanedMarkers(api: PrintApiClient): Promise<void> {
  const orphans = readOrphanedMarkers();
  if (orphans.length === 0) return;

  log.warn(
    `Found ${orphans.length} print job(s) that were in progress when the agent last stopped. Reporting them as "may have printed".`,
  );

  for (const orphan of orphans) {
    const detail = orphan.body
      ? `${orphan.body.kind} started at ${orphan.body.startedAt}`
      : 'marker could not be read';
    try {
      await api.fail(
        orphan.jobId,
        // Always true. This is the fail-safe direction and it is not
        // negotiable: an unreadable marker is still evidence we were printing.
        true,
        `The print agent stopped mid-job (${detail}). It may or may not have printed.`,
      );
      log.info(`Reported interrupted job ${orphan.jobId}.`);
      clearMarker(orphan.jobId);
    } catch (err) {
      if (err instanceof LeaseLostError) {
        // The sweep already moved it on, or staff already answered. Our marker
        // has done its job.
        log.info(`Interrupted job ${orphan.jobId} was already resolved server-side.`);
        clearMarker(orphan.jobId);
        continue;
      }
      if (err instanceof ApiUnreachableError || err instanceof AgentUnauthorizedError) {
        log.warn(`Could not report interrupted job ${orphan.jobId} yet; keeping the marker.`, err);
        continue;
      }
      log.error(`Could not report interrupted job ${orphan.jobId}.`, err);
    }
  }
}

/** A one-line view of the config for the log, with nothing secret in it. */
function summarise(cfg: PrinterConfig) {
  return {
    receipt: `${cfg.receipt.transport}/${cfg.receipt.windowsPrinterName ?? cfg.receipt.host ?? 'unset'} ${cfg.receipt.paperWidthMm}mm ${cfg.receipt.codepage}`,
    label: `${cfg.label.transport}/${cfg.label.windowsPrinterName ?? 'unset'} ${cfg.label.rollWidthMm}mm ${cfg.label.rollType}`,
  };
}

main().catch((err) => {
  log.error('The print agent could not start.', err);
  process.stderr.write(`\nThe print agent could not start: ${String(err)}\n\n`);
  process.exitCode = 1;
});
