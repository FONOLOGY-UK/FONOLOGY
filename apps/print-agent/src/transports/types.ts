import type { LabelDocument } from '../render/drawOps.js';

/**
 * The transport contract.
 * =========================================================================
 * One interface, four implementations (windows-raw, tcp, windows-label, fake).
 * Everything above this line — the queue, the worker, the marker, the retry
 * policy — is written against `Transport<TDoc>` and cannot tell which
 * implementation it has. Selecting one is transports/index.ts, and only that.
 *
 * ---------------------------------------------------------------------------
 * WHY ONE GENERIC INTERFACE RATHER THAN TWO SEPARATE ONES
 * ---------------------------------------------------------------------------
 * These were originally two unrelated interfaces, which forced the worker to
 * cast — `transport as ReceiptTransport` — because it could not prove which one
 * it was holding. That cast is unchecked, and the failure it permits is the
 * worst kind this system has: hand a `Uint8Array` to the label transport and
 * the PowerShell host reads `doc.ops` as undefined, defaults it to an empty
 * list, prints a BLANK label, and returns ok — which the agent then
 * acknowledges. Silent wrong output, no error anywhere.
 *
 * Parameterising the document type lets the compiler pair each worker with the
 * right transport and renderer, and the casts disappear entirely.
 */
export type TransportResult =
  | { ok: true; detail?: string }
  /**
   * `reachedPrinter` is the one field that matters.
   *
   * Report `false` ONLY when the transport can prove no byte left this machine
   * — the printer name was wrong, the socket was refused, the config was
   * missing. In that state the queue may safely retry automatically.
   *
   * Every other failure reports `true`, including timeouts, crashes, partial
   * writes and "I do not know". For a receipt that sends the job to
   * `unconfirmed`, where a human is asked whether paper came out.
   *
   * The asymmetry always resolves the same way: guessing `false` when bytes did
   * go out means a customer holds two receipts for one sale, which is what a
   * fraudulent return looks like. Guessing `true` when nothing printed costs one
   * tap on a question. Never invert this to make the queue look tidier.
   */
  | { ok: false; reachedPrinter: boolean; error: string };

/** Context for logging and for the name Windows shows in its print queue. */
export interface PrintContext {
  jobId: string;
  kind: string;
  docName: string;
}

export interface DeviceReport {
  status: 'ok' | 'warning' | 'error' | 'unknown';
  detail: string | null;
}

export interface Transport<TDoc> {
  /** For logs and health detail, e.g. "windows-raw (POS80 Printer)". */
  readonly name: string;
  send(doc: TDoc, ctx: PrintContext): Promise<TransportResult>;
  /** Cheap enough to run on every heartbeat; must never throw. */
  check(): Promise<DeviceReport>;
}

/** A receipt is a finished ESC/POS byte stream. */
export type ReceiptTransport = Transport<Uint8Array>;

/** A label is a display list in millimetres, drawn at print time. */
export type LabelTransport = Transport<LabelDocument>;
