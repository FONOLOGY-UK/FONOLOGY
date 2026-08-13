/* eslint-disable @typescript-eslint/require-await --
 * The fake transport implements the same async Transport<TDoc> interface as the
 * real ones, but its work — writing a file — is synchronous. `async` here is
 * interface conformance, not an oversight: dropping it to satisfy the rule
 * would mean hand-rolling Promise.resolve() at every return and make this file
 * read less like the transports it stands in for.
 */
import fs from 'node:fs';
import path from 'node:path';
import { FAKE_OUT_DIR } from '../paths.js';
import { log } from '../logger.js';
import type { LabelDocument } from '../render/drawOps.js';
import type { PrintHost } from '../host/host.js';
import type {
  DeviceReport,
  LabelTransport,
  PrintContext,
  ReceiptTransport,
  TransportResult,
} from './types.js';

/**
 * The fake printer — a first-class target, not a test hack.
 * =========================================================================
 * This is how the whole pipeline gets exercised with no hardware present, and
 * how the real thing gets debugged later. Treating it as a lesser sibling of
 * the real transports is how it ends up untrustworthy exactly when it is
 * needed — so it is selected the same way (a settings value), goes through the
 * same interface, writes the same marker, and honours the same reachedPrinter
 * contract.
 *
 * It writes what WOULD have been sent:
 *
 *   receipt — the exact bytes (.bin), plus a side-by-side hex/ASCII dump
 *             (.txt) so a human can read the content and see where the control
 *             sequences fall.
 *   label   — the display list (.json), plus a real PNG rendered through the
 *             same GDI+ path the Brother driver would receive, when running on
 *             Windows. That PNG is the closest thing to a photograph of the
 *             label that exists before the hardware does.
 *
 * ---------------------------------------------------------------------------
 * ON THE HEX DUMP
 * ---------------------------------------------------------------------------
 * It is a DUMP, not a decoder. It prints bytes and shows which are printable;
 * it does not claim to interpret ESC/POS sequences, because a hand-written
 * decoder would be exactly the kind of remembered-protocol guesswork this
 * project bans. If you need to know what `1d 56 01` means, read the encoder
 * library's source, not a comment here.
 */

/** Keep the directory from growing without limit, same discipline as the logs. */
const MAX_FAKE_FILES = 200;

function prune(): void {
  try {
    const entries = fs
      .readdirSync(FAKE_OUT_DIR)
      .map((name) => {
        const full = path.join(FAKE_OUT_DIR, name);
        return { full, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    for (const stale of entries.slice(MAX_FAKE_FILES)) {
      fs.rmSync(stale.full, { force: true });
    }
  } catch {
    /* housekeeping only */
  }
}

/** Filesystem-safe, sortable, and unique enough for one printer. */
function stamp(ctx: PrintContext): string {
  const iso = new Date().toISOString().replace(/[:.]/g, '-');
  return `${iso}_${ctx.kind}_${ctx.jobId.slice(0, 8)}`;
}

function hexDump(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const slice = bytes.subarray(offset, offset + 16);
    const hex = Array.from(slice)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ')
      .padEnd(47, ' ');
    const ascii = Array.from(slice)
      .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'))
      .join('');
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex}  |${ascii}|`);
  }
  return lines.join('\n');
}

/**
 * The text as it would appear, with control bytes made visible.
 *
 * Printable ASCII passes through; everything else becomes <XX>. Enough to read
 * the receipt and see the shape of the control sequences around it, without
 * pretending to decode them.
 */
function readableForm(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) {
    if (b === 0x0a) out += '\n';
    else if (b === 0x0d)
      continue; // CR always pairs with LF here; folding it keeps the text readable
    else if (b >= 0x20 && b <= 0x7e) out += String.fromCharCode(b);
    else out += `<${b.toString(16).padStart(2, '0')}>`;
  }
  return out;
}

export class FakeReceiptTransport implements ReceiptTransport {
  readonly name = 'fake (receipt)';

  async send(bytes: Uint8Array, ctx: PrintContext): Promise<TransportResult> {
    const base = path.join(FAKE_OUT_DIR, stamp(ctx));
    try {
      fs.writeFileSync(`${base}.bin`, bytes);
      fs.writeFileSync(
        `${base}.txt`,
        [
          `Fonology fake receipt printer`,
          `job     : ${ctx.jobId}`,
          `kind    : ${ctx.kind}`,
          `document: ${ctx.docName}`,
          `bytes   : ${bytes.length}`,
          `written : ${new Date().toISOString()}`,
          ``,
          `--- as it would print (control bytes shown as <hh>) ---`,
          readableForm(bytes),
          ``,
          `--- raw bytes ---`,
          hexDump(bytes),
          ``,
        ].join('\n'),
        'utf8',
      );
      prune();
      return { ok: true, detail: `${bytes.length} bytes written to ${base}.bin` };
    } catch (err) {
      // The fake printer failing is a disk problem, and nothing "printed".
      return {
        ok: false,
        reachedPrinter: false,
        error: `Fake printer could not write: ${String(err)}`,
      };
    }
  }

  async check(): Promise<DeviceReport> {
    try {
      fs.accessSync(FAKE_OUT_DIR, fs.constants.W_OK);
      // Reported as `warning`, never `ok`. If the shop is somehow running on
      // the fake printer, the admin health screen must say so rather than show
      // a green tick next to a printer that prints nothing.
      return { status: 'warning', detail: `Fake receipt printer — writing to ${FAKE_OUT_DIR}.` };
    } catch (err) {
      return { status: 'error', detail: `Fake output directory is not writable: ${String(err)}` };
    }
  }
}

export class FakeLabelTransport implements LabelTransport {
  readonly name = 'fake (label)';

  /**
   * The host is optional. Without it (or off Windows) the display list is
   * still written, so the pipeline is testable anywhere; the PNG is the bonus
   * you get on the platform that can actually render it.
   */
  constructor(private readonly host: PrintHost | null) {}

  async send(doc: LabelDocument, ctx: PrintContext): Promise<TransportResult> {
    const base = path.join(FAKE_OUT_DIR, stamp(ctx));
    try {
      fs.writeFileSync(`${base}.json`, JSON.stringify(doc, null, 2), 'utf8');
    } catch (err) {
      return {
        ok: false,
        reachedPrinter: false,
        error: `Fake printer could not write: ${String(err)}`,
      };
    }

    let pngNote = ' (no PNG — the renderer needs Windows)';
    if (this.host?.isSupported()) {
      try {
        const res = await this.host.send(
          'drawLabel',
          {
            // No `printer` key: render-only. This is the same code path the
            // real label transport uses, minus the driver.
            widthMm: doc.widthMm,
            heightMm: doc.heightMm,
            dpi: 300,
            pngPath: `${base}.png`,
            ops: doc.ops,
          },
          30_000,
        );
        pngNote = res.ok ? ` and ${base}.png` : ` (PNG failed: ${String(res.error)})`;
      } catch (err) {
        // A failed preview must not fail the "print" — the display list, which
        // is the actual record of what would have been sent, is already saved.
        log.warn('Fake label preview could not be rendered.', err);
        pngNote = ` (PNG failed: ${String(err)})`;
      }
    }

    prune();
    return { ok: true, detail: `${doc.ops.length} draw ops written to ${base}.json${pngNote}` };
  }

  async check(): Promise<DeviceReport> {
    try {
      fs.accessSync(FAKE_OUT_DIR, fs.constants.W_OK);
      return { status: 'warning', detail: `Fake label printer — writing to ${FAKE_OUT_DIR}.` };
    } catch (err) {
      return { status: 'error', detail: `Fake output directory is not writable: ${String(err)}` };
    }
  }
}
