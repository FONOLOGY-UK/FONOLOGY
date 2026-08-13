/**
 * Types for @point-of-sale/receipt-printer-encoder v3.0.3.
 * =========================================================================
 * The package ships no declarations (its `files` field is `["dist"]` and there
 * is no .d.ts), so this exists to keep `strict` typechecking meaningful rather
 * than letting the whole encoder degrade to `any`.
 *
 * EVERY SIGNATURE BELOW WAS VERIFIED BY RUNNING THE LIBRARY, not recalled.
 * The method list came from enumerating the prototype; the return types and
 * accepted values came from calling them and reading the bytes back. That
 * matters here more than usual — this is the one dependency standing between
 * this codebase and hand-written ESC/POS, and a wrong type would quietly
 * re-open the door to guessing at the protocol.
 *
 * DELIBERATELY INCOMPLETE. The real prototype also carries qrcode, pdf417,
 * image, table, box, font, size, width, height, invert, italic, underline,
 * pulse, raw and commands. They are omitted because this build does not use
 * them and their exact signatures have NOT been verified. If you need one,
 * verify it the same way first — run it, read the bytes — and then add it
 * here. Do not extend this file from memory or from the project's README.
 *
 * Verified behaviours worth knowing, all recorded at the call sites too:
 *   - Every builder method returns `this`, so chaining works.
 *   - `encode()` returns a Uint8Array.
 *   - `codepage()` THROWS on an unknown name ("Unknown codepage").
 *   - `cut()` does NOT throw on an unknown mode — it silently emits a full
 *     cut. That is why the config schema validates it with an enum.
 */
declare module '@point-of-sale/receipt-printer-encoder' {
  export interface ReceiptPrinterEncoderOptions {
    /** 'esc-pos' | 'star-line' | 'star-prnt'. Only esc-pos is used here. */
    language?: string;
    /** Characters per line in the printer's Font A. */
    columns?: number;
    printerModel?: string;
    codepageMapping?: string;
    codepageCandidates?: string[];
    feedBeforeCut?: number;
    imageMode?: string;
    createCanvas?: unknown;
  }

  export default class ReceiptPrinterEncoder {
    constructor(options?: ReceiptPrinterEncoderOptions);

    /** ESC @ and the encoder's default font/charset preamble. */
    initialize(): this;

    /**
     * NOTE: always call this immediately after initialize(). Verified quirk —
     * calling align() on the line initialize() occupies emits the alignment
     * padding BEFORE the ESC @ bytes. See render/receipt.ts.
     */
    newline(count?: number): this;

    /** Throws on an unknown codepage. */
    codepage(codepage: string): this;

    align(alignment: 'left' | 'center' | 'right'): this;
    bold(enabled?: boolean): this;

    /** Text plus a line break. */
    line(value: string): this;

    /** Text with no line break. */
    text(value: string): this;

    /** A horizontal rule the full width of the paper. */
    rule(options?: { style?: string; width?: number }): this;

    /** Silently emits a FULL cut for any unrecognised value. */
    cut(mode?: 'partial' | 'full'): this;

    /**
     * A barcode the PRINTER draws, from `GS k`. We send the value, never bars.
     *
     * VERIFIED BY RUNNING IT on v3.0.3, reading the bytes back:
     *   - `code39`, `code128`, `ean13`, `itf`, `upca` are all accepted.
     *   - `width` accepts 1–3 and THROWS "Width must be between 1 and 3" at 4.
     *     It emits `GS w (width + 1)`, so width 2 means 3 dots per module.
     *   - `height` maps straight through to `GS h`.
     *   - `text: true` emits `GS H 2` (human-readable digits below the bars);
     *     omitted or false emits `GS H 0`.
     *
     * TWO TRAPS, both measured, both guarded at the call site in
     * render/receipt.ts:
     *
     *   1. AN UNSUPPORTED SYMBOLOGY DOES NOT THROW. It writes a line to the
     *      console and emits ZERO bytes — so receipts would print with no
     *      barcode and no error anywhere.
     *   2. THE VALUE IS NOT VALIDATED against the symbology.
     *      `barcode('FNL-1234', 'ean13')` was accepted and emitted the raw
     *      ASCII under an EAN-13 command, which is garbage bars on paper.
     */
    barcode(
      value: string,
      symbology: string,
      options?: { height?: number; width?: 1 | 2 | 3 | number; text?: boolean },
    ): this;

    encode(): Uint8Array;

    readonly columns: number;
    readonly language: string;
  }
}
