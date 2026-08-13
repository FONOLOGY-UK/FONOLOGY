import { log } from '../logger.js';
import type { PrintHost } from '../host/host.js';
import type { PrinterConfig } from '../printerConfig.js';
import { FakeLabelTransport, FakeReceiptTransport } from './fake.js';
import { TcpTransport } from './tcp.js';
import { WindowsLabelTransport } from './windowsLabel.js';
import { WindowsRawTransport } from './windowsRaw.js';
import type { LabelTransport, ReceiptTransport } from './types.js';

/**
 * THE ONE FILE THAT CHANGES IF THE HARDWARE ASSUMPTIONS ARE WRONG.
 * =========================================================================
 * Everything above the transport interface — the worker, the marker, the retry
 * policy, the queue — is written against `ReceiptTransport` / `LabelTransport`
 * and cannot tell which implementation it has. Selecting one is this file, and
 * only this file.
 *
 * In practice even THIS file does not change for the most likely surprise. If
 * the POS80GXa turns out to be on the LAN rather than USB, the fix is a
 * settings edit:
 *
 *     update shop_settings set printer_config = jsonb_set(
 *       jsonb_set(printer_config, '{receipt,transport}', '"tcp"'),
 *       '{receipt,host}', '"192.168.1.50"');
 *
 * because the tcp transport is already built and already selectable. A code
 * change is only needed for a transport nobody has written yet — and then it
 * is one `case` here plus the new file.
 *
 * `FONOLOGY_FORCE_FAKE=1` overrides everything and is how the pipeline is
 * exercised end to end without touching hardware. It logs loudly at warn
 * level every time it is used, because an agent silently printing to a
 * directory in a live shop would be the worst possible failure.
 */

export function buildReceiptTransport(cfg: PrinterConfig, host: PrintHost): ReceiptTransport {
  if (process.env.FONOLOGY_FORCE_FAKE === '1') {
    log.warn('FONOLOGY_FORCE_FAKE=1 — receipts go to the fake printer, not to paper.');
    return new FakeReceiptTransport();
  }

  switch (cfg.receipt.transport) {
    case 'windows':
      // ASSUMPTION 1. Basis and consequences documented in windowsRaw.ts.
      return new WindowsRawTransport(host, cfg.receipt.windowsPrinterName);
    case 'tcp':
      return new TcpTransport(cfg.receipt.host, cfg.receipt.port);
    case 'fake':
      return new FakeReceiptTransport();
    default: {
      // Unreachable while the schema is an enum, and kept anyway: this is the
      // seam where a future transport gets forgotten, and falling back to the
      // fake printer would mean a live shop silently stops printing receipts.
      const unexpected: never = cfg.receipt.transport;
      throw new Error(`Unknown receipt transport in shop settings: ${String(unexpected)}`);
    }
  }
}

export function buildLabelTransport(cfg: PrinterConfig, host: PrintHost): LabelTransport {
  if (process.env.FONOLOGY_FORCE_FAKE === '1') {
    log.warn('FONOLOGY_FORCE_FAKE=1 — labels go to the fake printer, not to paper.');
    return new FakeLabelTransport(host);
  }

  switch (cfg.label.transport) {
    case 'windows':
      return new WindowsLabelTransport(host, cfg.label.windowsPrinterName);
    case 'fake':
      return new FakeLabelTransport(host);
    default: {
      const unexpected: never = cfg.label.transport;
      throw new Error(`Unknown label transport in shop settings: ${String(unexpected)}`);
    }
  }
}
