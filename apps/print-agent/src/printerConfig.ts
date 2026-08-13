import { z } from 'zod';

/**
 * The printer configuration the SERVER owns.
 * =========================================================================
 * Fetched from `GET /print/config`, which returns
 * `shop_settings.printer_config` verbatim. This schema must match what that
 * endpoint REALLY returns, not what looks reasonable — the single most common
 * bug class in this project's history is a schema written against an
 * imagined response.
 *
 * Verified against the dev project (ohkvwqqtppvnxbvvdsfr) on 2026-08-10, and
 * against the endpoint itself, which is:
 *
 *     res.json(data?.printer_config ?? {})
 *
 * Two consequences of that one line, both handled below:
 *
 *   1. It can return `{}`. If `shop_settings` had no row the agent gets an
 *      empty object, so EVERY field needs a default rather than being
 *      required. An agent that refuses to start because the settings row is
 *      missing is an agent that cannot print a test page to diagnose itself.
 *
 *   2. It is jsonb passed straight through, so nothing has validated it since
 *      an owner typed it. That is exactly why the enums below are strict.
 *
 * ---------------------------------------------------------------------------
 * WHY `cut` IS A STRICT ENUM — a real trap, found by testing the library
 * ---------------------------------------------------------------------------
 * `@point-of-sale/receipt-printer-encoder` does NOT reject an unknown cut
 * mode. Measured on v3.0.3:
 *
 *     .cut('partial')  -> 1d 56 01   (partial)
 *     .cut('full')     -> 1d 56 00   (full)
 *     .cut('nonsense') -> 1d 56 00   (full — silently)
 *
 * So a typo in settings does not fail; it quietly changes how every receipt is
 * cut. That is precisely the "prints subtly wrong" failure this project keeps
 * getting bitten by, so the validation has to happen here, before the value
 * ever reaches the encoder.
 *
 * (By contrast an unknown CODEPAGE does throw — verified — which is why that
 * one is a plain string, checked separately at startup by encoding a probe.)
 */

/**
 * Receipt transports.
 *
 * `windows` — raw ESC/POS handed to the Windows print queue. THE ASSUMPTION:
 *             the POS80GXa is USB-attached and installed as a Windows printer.
 * `tcp`     — a raw socket to port 9100. Already built, so if the assumption is
 *             wrong the fix is a settings edit and NOT a code change.
 * `fake`    — writes the exact bytes to a file. A first-class target: it is how
 *             this pipeline is exercised with no hardware present.
 */
export const receiptTransportSchema = z.enum(['windows', 'tcp', 'fake']);

/**
 * Label transports. No `tcp`: the QL-600 is USB-only (confirmed from a
 * photograph of the actual unit), so offering a network option would be
 * offering something that cannot work.
 */
export const labelTransportSchema = z.enum(['windows', 'fake']);

const receiptConfigSchema = z
  .object({
    transport: receiptTransportSchema.default('windows'),
    /**
     * Null in the dev row today, and deliberately NOT defaulted to "the
     * Windows default printer". A receipt silently rendering into Microsoft
     * Print to PDF because nobody set a name is the quiet-wrong-output case
     * this system exists to avoid. Unset means the agent reports an error on
     * its health and refuses — loudly, and safely retryable.
     */
    windowsPrinterName: z.string().min(1).nullable().default(null),
    host: z.string().min(1).nullable().default(null),
    port: z.number().int().min(1).max(65535).default(9100),
    paperWidthMm: z.number().positive().max(120).default(80),
    cut: z.enum(['partial', 'full']).default('partial'),
    /**
     * UNVERIFIED until the encoding test print is photographed. cp437 is the
     * ESC/POS default page and does carry "£" (at 0x9C — verified against the
     * encoder), but whether THIS clone renders that byte as a pound sign is a
     * property of the device, not of the protocol.
     */
    codepage: z.string().min(1).default('cp437'),
    /**
     * Extra code tables the encoder may switch INTO mid-line, so a name with
     * accents prints correctly instead of as "?".
     * =====================================================================
     * ESC/POS switches code table with `ESC t n`, and the encoder can pick the
     * right table per run of characters. Measured, on the real encoder:
     *
     *   cp437 alone            "Łukasz Woźniak"  ->  "?ukasz Wo?niak"
     *   cp437 + cp852 (auto)   "Łukasz Woźniak"  ->  correct, 2 table switches
     *
     * and "£12.34 Łukasz Woźniak" comes out with ZERO substitutions, because
     * the pound stays on cp437 (0x9C) and only the Polish letters switch to
     * cp852. Adding a table costs a few bytes per switch and nothing else — no
     * image, no change in print speed, no change in paper used.
     *
     * WHY cp852 SPECIFICALLY, AND WHY THE LIST STOPS THERE. Polish is the
     * largest non-English first language in Scotland, and cp852 (Latin-2) is
     * table 18 in the standard Epson set that clones generally implement. The
     * encoder also supports Greek, Cyrillic, Turkish and Arabic tables, and
     * they demonstrably produce correct bytes — but every additional table is
     * another bet on what THIS clone implements, and the failure mode of a
     * table it does not have is a wrong glyph rather than a "?".
     *
     * So: widen this list once the printer's self-test page confirms which
     * code tables it actually carries. That is a settings edit, not a release.
     *
     * UNVERIFIED, exactly as `codepage` above is: cp437 is already an
     * unconfirmed assumption about this device, and cp852 is the same class of
     * assumption, not a stronger one.
     */
    codepageCandidates: z.array(z.string().min(1)).default(['cp437', 'cp852']),
    /**
     * Characters per line in the printer's Font A. 80mm paper is 42 columns on
     * an Epson TM-series at 12x24; clones vary, and a wrong value produces
     * wrapped or truncated lines rather than an error. Configurable for that
     * reason.
     */
    columns: z.number().int().min(20).max(64).default(42),
    /**
     * Module width of the barcode printed at the foot of a receipt.
     * =====================================================================
     * The printer draws that barcode itself, from `GS k` — we send the value,
     * not the bars. This is the one knob that decides whether the symbol FITS.
     *
     * Measured against the encoder (v3.0.3): the option accepts 1–3 and THROWS
     * "Width must be between 1 and 3" at 4, and it emits `GS w (width + 1)`,
     * i.e. width 2 means 3 dots per module.
     *
     * Why it matters: "FNL-10251" in Code 39 is about 176 modules. At width 2
     * that is ~528 dots, which fits the 576-dot printable area of a true 80mm
     * head — but NOT the 384 dots of a 58mm one, where the symbol would be
     * truncated or dropped silently. Since paper width is itself still an
     * assumption, this is derived from it at render time rather than fixed
     * here; see receiptBarcodeWidth().
     *
     * Null means "derive it". A number overrides, for the case where the
     * device turns out to disagree with the arithmetic.
     */
    barcodeModuleWidth: z.number().int().min(1).max(3).nullable().default(null),
  })
  .default({});

const labelConfigSchema = z
  .object({
    transport: labelTransportSchema.default('windows'),
    windowsPrinterName: z.string().min(1).nullable().default(null),
    /**
     * THE ASSUMPTION: the 62mm continuous starter roll (DK-22205) Brother
     * ships with the QL-600. Continuous is self-correcting — we choose the
     * length — so being wrong wastes roll rather than cropping a label.
     */
    rollType: z.enum(['continuous', 'die-cut']).default('continuous'),
    rollWidthMm: z.number().positive().max(120).default(62),
    labelLengthMm: z.number().positive().max(300).default(40),
  })
  .default({});

/**
 * `.passthrough()` at the top level on purpose: an owner adding a key we do
 * not know about yet must not stop the printers working. Unknown keys inside
 * the two blocks are dropped rather than rejected for the same reason.
 */
export const printerConfigSchema = z
  .object({
    receipt: receiptConfigSchema,
    label: labelConfigSchema,
  })
  .passthrough();

export type PrinterConfig = z.infer<typeof printerConfigSchema>;
export type ReceiptConfig = PrinterConfig['receipt'];
export type LabelConfig = PrinterConfig['label'];

/**
 * The configuration used when the server cannot be reached at all.
 *
 * Matches the migration 0033 default exactly, so an agent starting up during
 * an outage behaves the same as one that fetched successfully. It is only ever
 * a stand-in until the next successful fetch.
 */
export function defaultPrinterConfig(): PrinterConfig {
  return printerConfigSchema.parse({});
}
