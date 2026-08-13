import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';
import {
  payoutReceiptPayloadSchema,
  refundReceiptPayloadSchema,
  saleReceiptPayloadSchema,
  testPrintPayloadSchema,
} from '../api.js';
import type { ReceiptConfig } from '../printerConfig.js';
import { addressLines, type ShopDetails } from '../shopDetails.js';
import { encodeCode39 } from './barcode.js';
import { formatPence, formatWhen, sanitiseForPrinter, wrap } from './sanitise.js';

/**
 * Turning a frozen payload into ESC/POS bytes.
 * =========================================================================
 * NO BYTE SEQUENCE IS WRITTEN BY HAND IN THIS FILE. Every control code comes
 * out of @point-of-sale/receipt-printer-encoder (MIT). That is a hard rule for
 * this project: a hex escape typed from memory produces output that is subtly
 * wrong rather than obviously wrong — a line cut off at the right margin, a
 * cut command a clone ignores — and nobody notices until a customer complains.
 *
 * If you find yourself typing \x1b in here, stop.
 *
 * ---------------------------------------------------------------------------
 * THE CONTENT RULES, WHICH ARE CLIENT-CONFIRMED AND NOT STYLE CHOICES
 * ---------------------------------------------------------------------------
 *   - NO VAT. No column, no calculation, no label, and specifically not the
 *     "(Inc Tax)" wording their old EPOS printed. The business is not VAT
 *     registered, so a receipt implying otherwise is a document a customer
 *     could hold them to.
 *
 *   - NO CARD TRANSACTION DETAIL BLOCK. Their old receipt carried AID / MID /
 *     TID / auth code because the till was integrated with the card machine.
 *     Ours is manual-entry by design, so the card machine prints its own slip
 *     and we print the shop's receipt. Two pieces of paper. What appears here
 *     is the method, the amount, the frozen machine label, and the slip
 *     reference staff typed in — nothing the card network owns.
 *
 *   - THE RETURNS WINDOW IS GENERATED, NEVER TYPED. It comes from
 *     `shop.returnWindowDays`, which is the same column the refund screen
 *     enforces. This is the bug that has already been fixed twice in this
 *     codebase (a hardcoded RETURN_WINDOW_DAYS = 30 on one side and a
 *     configurable setting on the other) and the thermal receipt was still
 *     missing the line entirely, which is the third variant of it: a customer
 *     handed a browser-printed receipt got the promise, and one handed a
 *     thermal receipt got nothing.
 *
 *   - THE HEADER IS "Fonology". Not "Zakaso Limited T/A Fonology".
 *
 * ---------------------------------------------------------------------------
 * A REAL LIBRARY QUIRK, FOUND BY TESTING — DO NOT "TIDY" THE newline() AWAY
 * ---------------------------------------------------------------------------
 * Measured on v3.0.3. Calling `.align()` on the same buffered line that
 * `.initialize()` occupies hoists the alignment padding IN FRONT of the
 * initialise bytes:
 *
 *   .initialize().align('center').line('FONOLOGY')
 *     -> "                 <1b>@<1c>.<1b>M<00>...FONOLOGY"
 *          ^^^^^^^^^^^^^^^^^ padding emitted BEFORE ESC @
 *
 *   .initialize().newline().align('center').line('FONOLOGY')
 *     -> "<1b>@<1c>.<1b>M<00>\n\r<1b>t<00>                 FONOLOGY"   correct
 *
 * On a compliant printer ESC @ clears the buffer so the stray padding is
 * discarded — but "the printer will probably throw it away" is not a thing to
 * rely on with a clone whose behaviour is unverified. The `newline()` costs
 * nothing (initialize() already terminates its own line when left alone) and
 * makes the byte order correct rather than accidentally harmless.
 *
 * ---------------------------------------------------------------------------
 * A SECOND QUIRK: LEADING WHITESPACE IS STRIPPED. YOU CANNOT INDENT WITH SPACES
 * ---------------------------------------------------------------------------
 * Also measured on v3.0.3, by encoding and reading the bytes back:
 *
 *   .line('   @ 5.99 each')   -> "@ 5.99 each"    leading spaces GONE
 *   .text('   @ 5.99 each')   -> "@ 5.99 each"    same, so text() is no escape
 *   .line('a   b')            -> "a   b"          interior survives
 *   .line('trail   ')         -> "trail   "       trailing survives
 *
 * So an indented continuation line is not achievable by padding the left of the
 * string, no matter which method is used. Every layout below is therefore flush
 * left, and `twoColumn` works only because its padding is INTERIOR.
 *
 * This is written down because it is invisible: the code reads as though it
 * indents, the output simply does not, and the difference is only apparent on
 * paper. If Part C wants a genuine indent it needs a non-space leading
 * character, or the image-based path.
 */

/**
 * One encoder per receipt, never shared.
 *
 * The encoder is stateful — it accumulates a buffer — so a module-level
 * instance would leak the tail of one receipt onto the head of the next. That
 * is a duplicate-content bug of exactly the kind this system must not have.
 */
function newEncoder(cfg: ReceiptConfig): InstanceType<typeof ReceiptPrinterEncoder> {
  return new ReceiptPrinterEncoder({
    language: 'esc-pos',
    columns: cfg.columns,
    // Lets `.codepage('auto')` below switch code table per run of characters so
    // an accented name prints instead of turning into "?". See
    // printerConfig.ts for the measurements and the reason the list is short.
    codepageMapping: 'epson',
    codepageCandidates: cfg.codepageCandidates,
  });
}

/**
 * Select the code table.
 *
 * 'auto' rather than a fixed page: the encoder then picks per run, so "£12.34
 * Łukasz Woźniak" keeps the pound on cp437 AND the Polish letters on cp852 in
 * one line. With a single fixed page one of the two is always lost — measured
 * both ways.
 *
 * Falls back to the configured page when only one candidate exists, which is
 * also what makes this safe to narrow back to ['cp437'] in settings if the
 * clone turns out not to implement the second table.
 */
function selectCodepage(
  enc: InstanceType<typeof ReceiptPrinterEncoder>,
  cfg: ReceiptConfig,
): InstanceType<typeof ReceiptPrinterEncoder> {
  return enc.codepage(cfg.codepageCandidates.length > 1 ? 'auto' : cfg.codepage);
}

/**
 * A horizontal rule, in plain ASCII hyphens.
 *
 * NOT `enc.rule()`, and that is a deliberate downgrade. The library's rule
 * emits byte 0xC4 repeated — the box-drawing character `─` in cp437. It looks
 * better, and it depends on this clone mapping 0xC4 the way cp437 says, which
 * is the same unverified assumption as the pound sign except that it appears
 * two or three times on every single receipt.
 *
 * The pound sign is worth that bet: it is the shop's currency and there is no
 * substitute. A decorative line is not. A hyphen is in every code table ever
 * made, so this one cannot be wrong on any device.
 *
 * If the encoding test print comes back clean, switching back to `enc.rule()`
 * is a one-line change.
 */
function rule(enc: ReturnType<typeof newEncoder>, cols: number): void {
  enc.line('-'.repeat(cols));
}

/**
 * A label on the left, an amount hard against the right margin.
 *
 * Computed here rather than with the printer's tab stops, which vary by clone
 * and are one of the places "broadly ESC/POS compatible" stops being true.
 * Plain spaces work identically everywhere.
 */
function twoColumn(left: string, right: string, columns: number): string {
  const l = sanitiseForPrinter(left);
  const r = sanitiseForPrinter(right);
  const gap = columns - l.length - r.length;
  if (gap >= 1) return l + ' '.repeat(gap) + r;
  // Too long to fit: keep the AMOUNT whole and truncate the description. A
  // clipped price is unreadable; a clipped product name is still a product
  // name. The ellipsis is ASCII on purpose — see sanitise.ts.
  const room = Math.max(0, columns - r.length - 1);
  return `${l.slice(0, room)} ${r}`;
}

/**
 * Validate the codepage in settings by trying it.
 *
 * The encoder THROWS on an unknown codepage (verified: "cp1252" and "pc437"
 * both raise "Unknown codepage"), which is the behaviour we want — but it
 * throws at encode time, i.e. mid-receipt with a customer waiting. Calling
 * this at startup turns that into a clear message before the first sale.
 */
export function assertCodepageSupported(cfg: ReceiptConfig): void {
  // Every candidate, not just the base page: a typo in codepageCandidates would
  // otherwise throw on the first receipt that happens to contain an accent —
  // i.e. rarely, and in front of a customer.
  for (const page of new Set([cfg.codepage, ...cfg.codepageCandidates])) {
    try {
      new ReceiptPrinterEncoder({ language: 'esc-pos', columns: cfg.columns })
        .codepage(page)
        .text('probe')
        .encode();
    } catch (err) {
      throw new Error(
        `printer_config.receipt has codepage "${page}", which this encoder does not support ` +
          `(${err instanceof Error ? err.message : String(err)}). cp437 is the ESC/POS default.`,
      );
    }
  }

  // And the real path, with auto-selection on, against text that forces a
  // switch. This is what actually runs.
  try {
    selectCodepage(newEncoder(cfg).initialize().newline(), cfg).text('probe').encode();
  } catch (err) {
    throw new Error(
      `printer_config.receipt.codepageCandidates ${JSON.stringify(cfg.codepageCandidates)} ` +
        `could not be used together (${err instanceof Error ? err.message : String(err)}).`,
    );
  }
}

/**
 * The shop's own details at the head of a receipt.
 *
 * Read from settings, never written here. `GET /shop` exists because the
 * storefront once carried five hardcoded copies of these facts; a sixth, on the
 * one surface a customer takes home and the one machine nobody can edit
 * remotely, would be the worst place to put it.
 *
 * "Fonology" only — client-confirmed, NOT "Zakaso Limited T/A Fonology".
 */
function renderShopHeader(enc: ReturnType<typeof newEncoder>, shop: ShopDetails): void {
  enc
    .align('center')
    .bold(true)
    .line(sanitiseForPrinter(shop.shopName ?? 'Fonology'))
    .bold(false);
  for (const line of addressLines(shop.shopAddress)) {
    enc.line(sanitiseForPrinter(line));
  }
  if (shop.shopPhone) enc.line(sanitiseForPrinter(shop.shopPhone));
  if (shop.receiptHeaderText) enc.line(sanitiseForPrinter(shop.receiptHeaderText));
  enc.newline();
}

/**
 * The currency symbol, on headline figures only.
 *
 * Column figures are bare — the context is unambiguous and the width matters
 * more on 80mm paper. The TOTAL, the refunded amount and the payout amount get
 * the symbol because those are the numbers a dispute turns on.
 *
 * "£" is deliberately NOT stripped by sanitiseForPrinter: it is present in
 * cp437 at 0x9C, verified against the encoder. Whether this particular clone
 * renders that byte as a pound sign is a property of the DEVICE and remains
 * UNVERIFIED until the `encoding` test print is photographed. The label
 * renderer already made the same call, so being squeamish here would only make
 * the two surfaces inconsistent.
 */
function money(pence: number): string {
  return `£${formatPence(pence)}`;
}

/**
 * Tender codes as a CUSTOMER should read them.
 *
 * Deliberately not the same mapping as `tenderLabel()` in the web app, which
 * renders "Card — POS 1" for the admin screens. Which of the shop's two card
 * machines was used is an internal reconciliation detail; the machine's own
 * label (frozen by 0032) is already printed next to it and carries that
 * information for anyone who needs it. "POS 2" on a customer's receipt is
 * noise.
 *
 * An unrecognised code is passed through rather than replaced with a guess. A
 * tender we have not seen before printing as its raw code is a question
 * somebody asks; one silently relabelled "Card" is a wrong receipt.
 */
function receiptTenderLabel(tender: string): string {
  switch (tender) {
    case 'cash':
      return 'Cash';
    case 'pos1':
    case 'pos2':
      return 'Card';
    case 'transfer':
      return 'Bank transfer';
    case 'stripe':
      return 'Paid online';
    default:
      return tender;
  }
}

/**
 * Module width for the barcode the PRINTER draws at the foot of a receipt.
 *
 * Derived from paper width rather than fixed, because paper width is itself
 * still an assumption and the failure mode of getting this wrong is a symbol
 * that is truncated or dropped without any error.
 *
 * The arithmetic, using the verified encoder behaviour (`GS w` = width + 1,
 * so width 2 is 3 dots per module):
 *
 *   a 9-character reference in Code 39 is ~176 modules
 *   width 2 -> ~528 dots. Fits an 80mm head (576 dots printable).
 *   width 1 -> ~352 dots. Fits a 58mm head (384 dots printable).
 *
 * `barcodeModuleWidth` in settings overrides, for when the device disagrees
 * with the arithmetic.
 */
function receiptBarcodeWidth(cfg: ReceiptConfig): number {
  if (cfg.barcodeModuleWidth !== null) return cfg.barcodeModuleWidth;
  return cfg.paperWidthMm >= 70 ? 2 : 1;
}

/**
 * The symbology we ask the printer for. Code 39 across the whole shop — see
 * render/barcode.ts for why one symbology rather than the "correct" one per
 * value.
 */
const BARCODE_SYMBOLOGY = 'code39';

/**
 * Emit a barcode, or nothing.
 *
 * A REAL TRAP, MEASURED ON v3.0.3: the encoder does NOT throw on a symbology
 * the selected printer profile does not support. It writes a line to the
 * console and emits ZERO bytes. So a typo, or a future change of printer
 * model, would silently produce receipts with no barcode and no error
 * anywhere — and nobody would notice until someone tried to scan one.
 *
 * `assertBarcodeSupported` below turns that into one loud line at startup.
 * Here we simply refuse values Code 39 cannot represent, and print the value
 * as text underneath either way so a person can always read or type it.
 */
function renderReferenceBarcode(
  enc: ReturnType<typeof newEncoder>,
  value: string,
  cfg: ReceiptConfig,
): void {
  const encodable = encodeCode39(value) !== null;

  enc.align('center');
  if (encodable) {
    enc.barcode(value, BARCODE_SYMBOLOGY, {
      height: 50,
      width: receiptBarcodeWidth(cfg),
      // HRI off: we print the reference ourselves on the next line, in the
      // receipt's own font. Letting the printer add it too would print it
      // twice, at a size we do not control.
      text: false,
    });
  }
  // Always, barcode or not. This is the line a member of staff reads out over
  // the phone and types into the returns screen.
  enc.line(sanitiseForPrinter(value));
  enc.align('left');
}

/**
 * Prove at startup that the configured symbology actually emits bytes.
 *
 * Same pattern, and the same reasoning, as assertCodepageSupported: the
 * failure is silent at encode time, so it is forced into the open once, while
 * the shop is opening, rather than discovered on a receipt nobody can scan.
 */
export function assertBarcodeSupported(cfg: ReceiptConfig): void {
  const probe = newEncoder(cfg)
    .initialize()
    .newline()
    .barcode('FNL-10000', BARCODE_SYMBOLOGY, {
      height: 50,
      width: receiptBarcodeWidth(cfg),
      text: false,
    })
    .encode();

  // A supported symbology emits the GS k command and the payload; an
  // unsupported one emits only the initialise preamble. Comparing against a
  // bare initialise is what tells the two apart, since nothing throws.
  const bare = newEncoder(cfg).initialize().newline().encode();
  if (probe.length <= bare.length) {
    throw new Error(
      `The receipt encoder produced no bytes for a "${BARCODE_SYMBOLOGY}" barcode. ` +
        `Receipts would print with no scannable reference and no error. ` +
        `This is a code-level problem, not a settings one.`,
    );
  }
}

/**
 * The standing small print, in the one order it should ever appear.
 *
 * THE RETURNS LINE IS GENERATED FROM SETTINGS AND OMITTED IF UNKNOWN. Both
 * halves of that matter. Generated, because `return_window_days` is the column
 * the refund screen enforces and free text would drift from it. Omitted rather
 * than defaulted, because a receipt promising the wrong window is worse than
 * one promising nothing — the customer keeps the paper, and the shop is held
 * to what is on it.
 *
 * `receiptFooterText` is the owner-editable warranty wording and is kept
 * SEPARATE from the returns line for exactly that reason: free text must never
 * be able to contradict a number the till enforces.
 */
function renderStandingFooter(
  enc: ReturnType<typeof newEncoder>,
  shop: ShopDetails,
  cols: number,
  opts: { returns: boolean },
): void {
  enc.align('center');
  if (opts.returns && shop.returnWindowDays != null) {
    for (const line of wrap(`${shop.returnWindowDays}-day returns with this receipt.`, cols)) {
      enc.line(line);
    }
  }
  if (shop.receiptFooterText) {
    for (const line of wrap(sanitiseForPrinter(shop.receiptFooterText), cols)) enc.line(line);
  }
  if (shop.shopEmail) enc.line(sanitiseForPrinter(shop.shopEmail));
  enc.align('left');
}

/**
 * Feed clear of the tear bar, then cut.
 *
 * Two lines is conventional and is UNVERIFIED for this unit — the gap between
 * the print head and the cutter is a physical property of the device, and the
 * `cut` test print is what settles it.
 */
function finish(enc: ReturnType<typeof newEncoder>, cfg: ReceiptConfig): Uint8Array {
  enc.newline(2);
  enc.cut(cfg.cut);
  return enc.encode();
}

/* ==========================================================================
 * Sale
 * ======================================================================== */

export function renderSaleReceipt(
  payload: unknown,
  cfg: ReceiptConfig,
  shop: ShopDetails,
): Uint8Array {
  const sale = saleReceiptPayloadSchema.parse(payload);
  const enc = newEncoder(cfg);
  const cols = cfg.columns;

  selectCodepage(enc.initialize().newline(), cfg);
  renderShopHeader(enc, shop);

  enc.align('left');
  enc.line(twoColumn(sale.reference, formatWhen(sale.soldAt), cols));
  if (sale.staffName) enc.line(sanitiseForPrinter(`Served by ${sale.staffName}`));
  rule(enc, cols);

  for (const item of sale.lines) {
    // Quantity on the description line keeps a two-line item to one line when
    // it fits, which matters on 80mm paper more than it looks.
    const description = item.quantity > 1 ? `${item.quantity} x ${item.name}` : item.name;
    enc.line(twoColumn(description, formatPence(item.lineTotal), cols));
    if (item.quantity > 1) {
      // Flush left, and NOT padded: twoColumn(..., '') only added trailing
      // spaces, and a leading indent is stripped by the encoder regardless
      // (see the header). Written honestly rather than looking indented.
      enc.line(sanitiseForPrinter(`@ ${formatPence(item.unitPrice)} each`));
    }
    // The customer paid a promotional price. Their browser-printed receipt has
    // always said so; the thermal one did not, which is the sort of quiet
    // difference between two receipts for one sale that starts an argument.
    if (item.tierApplied) enc.line('bulk price applied');
  }

  rule(enc, cols);
  enc.line(twoColumn('Subtotal', formatPence(sale.subtotal), cols));
  if (sale.discount !== 0) {
    enc.line(twoColumn('Discount', formatPence(-Math.abs(sale.discount)), cols));
  }
  enc
    .bold(true)
    .line(twoColumn('TOTAL', money(sale.total), cols))
    .bold(false);
  enc.newline();

  // Method, amount, machine, slip reference. NOTHING the card network owns —
  // no AID, no MID, no TID, no auth code. See the file header.
  for (const payment of sale.payments) {
    const label = payment.machineLabel
      ? `${receiptTenderLabel(payment.tender)} (${payment.machineLabel})`
      : receiptTenderLabel(payment.tender);
    enc.line(twoColumn(label, formatPence(payment.amount), cols));
    // Flush left for the same reason as the unit-price line above.
    if (payment.reference) enc.line(sanitiseForPrinter(`Card slip ${payment.reference}`));
  }

  enc.newline();
  renderStandingFooter(enc, shop, cols, { returns: true });
  enc.newline();
  renderReferenceBarcode(enc, sale.reference, cfg);
  enc.newline();
  enc.align('center').line('Thank you');

  return finish(enc, cfg);
}

/* ==========================================================================
 * Refund
 * ======================================================================== */

/**
 * Money going back to a customer.
 *
 * WHAT THIS DOCUMENT HAS TO ANSWER, and why it is not a sale receipt with a
 * minus sign:
 *
 *   "which refund is this"      -> the REF- reference
 *   "against which purchase"    -> the original sale/order reference
 *   "where did my money go"     -> the refund tender, which the client
 *                                  confirmed can differ from how they paid
 *   "how much"                  -> a positive amount, labelled REFUNDED
 *
 * NOT printed, deliberately: the staff-typed `reason`, and whether the returns
 * window was overridden. See the header of printPayloads.ts.
 *
 * No returns line either. Nothing was sold here, and a partial refund would
 * make any blanket statement about the remaining items wrong in one direction
 * or the other.
 */
export function renderRefundReceipt(
  payload: unknown,
  cfg: ReceiptConfig,
  shop: ShopDetails,
): Uint8Array {
  const refund = refundReceiptPayloadSchema.parse(payload);
  const enc = newEncoder(cfg);
  const cols = cfg.columns;

  selectCodepage(enc.initialize().newline(), cfg);
  renderShopHeader(enc, shop);

  // Says what it is before anything else. A refund receipt mistaken for a
  // purchase receipt is exactly the confusion that turns into a dispute.
  enc.align('center').bold(true).line('REFUND').bold(false);
  enc.newline();

  enc.align('left');
  enc.line(twoColumn(refund.reference, formatWhen(refund.refundedAt), cols));
  if (refund.originalReference) {
    const what = refund.originalKind === 'order' ? 'order' : 'sale';
    enc.line(sanitiseForPrinter(`Against ${what} ${refund.originalReference}`));
  }
  if (refund.staffName) enc.line(sanitiseForPrinter(`Refunded by ${refund.staffName}`));
  rule(enc, cols);

  for (const item of refund.lines) {
    const description = item.quantity > 1 ? `${item.quantity} x ${item.name}` : item.name;
    enc.line(twoColumn(description, formatPence(item.lineTotal), cols));
  }
  // A refund can be recorded with no line detail at all (a partial refund
  // entered as an amount). Saying so beats a blank space where items would be.
  if (refund.lines.length === 0) enc.line('Refund against this purchase');

  rule(enc, cols);
  enc
    .bold(true)
    .line(twoColumn('REFUNDED', money(refund.amount), cols))
    .bold(false);
  enc.newline();

  enc.line(twoColumn('Returned by', receiptTenderLabel(refund.refundTender), cols));
  // Only when it DIFFERS. Printing "paid by cash, refunded to cash" on every
  // receipt is noise; printing it when they differ is the whole point, because
  // that is the case a customer queries.
  if (refund.originalTender && refund.originalTender !== refund.refundTender) {
    enc.line(twoColumn('Originally paid by', receiptTenderLabel(refund.originalTender), cols));
  }

  enc.newline();
  renderStandingFooter(enc, shop, cols, { returns: false });
  enc.newline();
  renderReferenceBarcode(enc, refund.reference, cfg);

  return finish(enc, cfg);
}

/* ==========================================================================
 * Trade-in payout
 * ======================================================================== */

/**
 * The shop BUYING a device from a customer.
 *
 * Not a sale, not a refund. Nothing was sold, so there is no returns window
 * and the repair warranty is irrelevant — neither is printed. What the
 * customer needs is written proof of what they handed over and what they were
 * paid for it.
 *
 * `amount` arrives NEGATIVE, exactly as the ledger stores it. The absolute
 * value is taken here, once, next to the words that state the direction. That
 * is the only place in the pipeline the sign convention is interpreted.
 *
 * DELIBERATELY ABSENT: any statement of ownership transfer or right to sell.
 * Second-hand device purchase in the UK carries real obligations, and inventing
 * legal wording is not something to do on a guess — flagged for the client
 * rather than drafted here.
 */
export function renderPayoutReceipt(
  payload: unknown,
  cfg: ReceiptConfig,
  shop: ShopDetails,
): Uint8Array {
  const payout = payoutReceiptPayloadSchema.parse(payload);
  const enc = newEncoder(cfg);
  const cols = cfg.columns;

  selectCodepage(enc.initialize().newline(), cfg);
  renderShopHeader(enc, shop);

  enc.align('center').bold(true).line('DEVICE PURCHASE').bold(false);
  enc.line('Payment to customer');
  enc.newline();

  enc.align('left');
  enc.line(twoColumn(payout.reference, formatWhen(payout.paidAt), cols));
  if (payout.sellRequestReference) {
    enc.line(sanitiseForPrinter(`Online quote ${payout.sellRequestReference}`));
  }
  if (payout.staffName) enc.line(sanitiseForPrinter(`Bought by ${payout.staffName}`));
  rule(enc, cols);

  enc.line('Sold to us by');
  enc.line(sanitiseForPrinter(payout.customerName));
  enc.newline();
  enc.line('Device');
  for (const line of wrap(sanitiseForPrinter(payout.deviceLabel), cols)) enc.line(line);
  rule(enc, cols);

  // Math.abs, once, right here beside the words that say which way the money
  // went. See the doc comment.
  enc
    .bold(true)
    .line(twoColumn('PAID TO YOU', money(Math.abs(payout.amount)), cols))
    .bold(false);
  enc.line(twoColumn('By', payout.method === 'bank_transfer' ? 'Bank transfer' : 'Cash', cols));

  enc.newline();
  // No returns line: nothing was sold. The shop's standing small print still
  // applies as contact information.
  renderStandingFooter(enc, shop, cols, { returns: false });
  enc.newline();
  renderReferenceBarcode(enc, payout.reference, cfg);

  return finish(enc, cfg);
}

/* ==========================================================================
 * Diagnostics
 * ======================================================================== */

/**
 * A line exactly `cols` characters wide, ending hard against the right margin.
 *
 * This is the whole trick behind the width test: if the printer is not really
 * `cols` wide, the tail wraps onto a second line and the right-hand marker is
 * visibly no longer at the edge. Both failure directions are obvious in a
 * photograph and invisible in any log.
 */
function fullWidth(left: string, right: string, cols: number, fill: string): string {
  const room = Math.max(0, cols - left.length - right.length);
  return left + fill.repeat(room) + right;
}

function testHeader(
  enc: ReturnType<typeof newEncoder>,
  shop: ShopDetails,
  title: string,
  issuedAt: string,
  cols: number,
): void {
  enc
    .align('center')
    .bold(true)
    .line(sanitiseForPrinter(shop.shopName ?? 'Fonology'))
    .bold(false);
  // Sanitised even though every caller passes an ASCII literal. It was not,
  // and the first render of the width test came out as "TEST 1 of 5 ? PAPER
  // WIDTH" because the title held an em dash — on the one slip of paper whose
  // entire job is to prove characters print correctly. Caught by reading the
  // output rather than by any test passing.
  enc.line(sanitiseForPrinter(title));
  enc.newline();
  enc.align('left');
  enc.line(twoColumn('Printed', formatWhen(issuedAt), cols));
}

/**
 * The five diagnostics, each designed so a PHOTOGRAPH settles one question.
 *
 * The design rule throughout: a failure must be visible to someone who does not
 * know what the output is supposed to look like. "The right-hand marker is
 * missing" is a thing a shop employee can see and report. "The codepage is
 * wrong" is not.
 */
export function renderTestPrint(
  payload: unknown,
  cfg: ReceiptConfig,
  shop: ShopDetails,
): Uint8Array {
  const test = testPrintPayloadSchema.parse(payload);
  const enc = newEncoder(cfg);
  const cols = cfg.columns;

  selectCodepage(enc.initialize().newline(), cfg);

  switch (test.variant) {
    /* ---- Is the paper really as wide as we think? ---------------------- */
    case 'width': {
      testHeader(enc, shop, 'TEST 1 of 5 - PAPER WIDTH', test.issuedAt, cols);
      enc.line(twoColumn('Configured', `${cfg.paperWidthMm}mm / ${cols} columns`, cols));
      rule(enc, cols);
      enc.newline();
      // A solid bar is the single most obvious element: if it wraps, a short
      // second row of blocks appears underneath it and nobody can miss it.
      enc.line('#'.repeat(cols));
      enc.line('1234567890'.repeat(Math.ceil(cols / 10)).slice(0, cols));
      enc.line(fullWidth('|<', `${cfg.paperWidthMm}mm>|`, cols, '-'));
      enc.line('#'.repeat(cols));
      enc.newline();
      enc.line('The three long lines above must each be');
      enc.line('ONE line, with the bars and the arrow');
      enc.line(
        sanitiseForPrinter(`ending exactly at the right edge, marked "${cfg.paperWidthMm}mm>|".`),
      );
      enc.newline();
      enc
        .bold(true)
        .line('If any of them wraps onto a second')
        .line('line, the paper is NARROWER than');
      enc.line(sanitiseForPrinter(`${cfg.paperWidthMm}mm. Photograph it.`)).bold(false);
      break;
    }

    /* ---- Does the cutter fire, and in the right place? ----------------- */
    case 'cut': {
      testHeader(enc, shop, 'TEST 2 of 5 - THE CUTTER', test.issuedAt, cols);
      enc.line(twoColumn('Cut mode', cfg.cut, cols));
      rule(enc, cols);
      enc.newline();
      enc.line('This is the TOP slip.');
      enc.newline();
      enc.bold(true).line('>>> THE CUT BELONGS BELOW THIS LINE').bold(false);
      // First cut. If the cutter works, everything above leaves the printer.
      enc.newline(2);
      enc.cut(cfg.cut);

      enc.bold(true).line('>>> THIS IS THE SECOND SLIP').bold(false);
      enc.newline();
      enc.line('You should be holding TWO separate');
      enc.line('pieces of paper.');
      enc.newline();
      enc.line('ONE long strip = the cutter did not');
      enc.line('fire. Text sliced in half = the cut');
      enc.line('is in the wrong place.');
      enc.newline();
      enc.line('Photograph both slips side by side.');
      break;
    }

    /* ---- Does this clone render the code table we chose? --------------- */
    case 'encoding': {
      testHeader(enc, shop, 'TEST 3 of 5 - CHARACTERS', test.issuedAt, cols);
      enc.line(twoColumn('Code page', cfg.codepage, cols));
      enc.line(twoColumn('Also allowed', cfg.codepageCandidates.join(', '), cols));
      rule(enc, cols);
      enc.newline();
      enc.line('Each line shows what SHOULD print.');
      enc.newline();
      // The pound sign is the one that bites: it sits at a different byte in
      // different code tables, so a clone that maps 0x9C elsewhere prints
      // something else entirely and every receipt total is affected.
      enc
        .bold(true)
        .line(twoColumn('Pound sign', `${money(1234)}`, cols))
        .bold(false);
      enc.line('   ^ must read as a pound sign, not');
      enc.line('     a box, a "?" or another symbol.');
      enc.newline();
      // Real names, not a character soup, because names are what actually get
      // printed. Every character below was MEASURED against this exact
      // codepage configuration and confirmed to encode without substitution —
      // the first draft of this test promised "Bjørk" would show its marks,
      // and it cannot: ø is in neither cp437 nor cp852.
      enc.line(sanitiseForPrinter('Zoé  Müller  Anaïs  café'));
      enc.line(sanitiseForPrinter('Łukasz Woźniak  Šárka  Nuñez'));
      enc.line('   ^ both lines must show their');
      enc.line('     accent marks. Plain letters');
      enc.line('     mean the code page is not');
      enc.line('     switching.');
      enc.newline();
      // A CONTROL. Without it, a test where NOTHING prints its accents looks
      // the same as a test where everything does — you cannot tell a working
      // check from a broken one. These two characters are outside both
      // configured code tables and must come out as "?".
      // Both failures are the SAME character (o-slash), so the expected output
      // is unambiguous. An earlier draft used a thorn as well and printed
      // "?ór" — the accented o survived and the instruction below was wrong,
      // which in a control line is worse than having no control at all.
      enc.line(sanitiseForPrinter('Søren Bjørk'));
      enc.line('   ^ this line SHOULD print as');
      enc.line('     "S?ren Bj?rk". That is correct,');
      enc.line('     not a fault - those letters are');
      enc.line('     outside the code pages we use.');
      enc.line('     If it shows marks, tell us:');
      enc.line('     the printer supports more than');
      enc.line('     we thought.');
      enc.newline();
      // The em dash never reaches the printer in normal use — sanitiseForPrinter
      // converts it, because almost no code table has one. Printing the RAW
      // character would test a path production never takes. What is worth
      // proving is that the conversion happens and reads correctly.
      enc.line('Dashes and quotes are converted');
      enc.line('before printing, on purpose:');
      enc.line(sanitiseForPrinter('  A—B  ‘q’  “Q”  …'));
      enc.line('   ^ must read:  A-B  \'q\'  "Q"  ...');
      break;
    }

    /* ---- Does a printed barcode scan back to the right product? -------- */
    case 'barcode': {
      testHeader(enc, shop, 'TEST 4 of 5 - BARCODE', test.issuedAt, cols);
      rule(enc, cols);
      if (!test.product) {
        // Cannot happen through the API, which refuses this variant without a
        // product. Printed rather than thrown so the slip explains itself.
        enc.line('No product was attached to this test,');
        enc.line('so there is nothing to scan. Start it');
        enc.line('again and pick a product.');
        break;
      }
      enc.newline();
      enc.line('Scan the barcode below with the shop');
      enc.line('scanner, on the till search box.');
      enc.newline();
      enc.bold(true).line('It must find:').bold(false);
      for (const line of wrap(sanitiseForPrinter(test.product.name), cols)) enc.line(line);
      enc.newline();
      renderReferenceBarcode(enc, test.product.barcode, cfg);
      enc.newline();
      enc.line('Finds the right product = PASS.');
      enc.line('Finds nothing, or the wrong product,');
      enc.line('or will not scan at all = FAIL.');
      enc.newline();
      enc.line('Photograph the barcode and tell us');
      enc.line('which of those happened.');
      break;
    }

    /* ---- The label variant belongs to the label printer. --------------- */
    case 'label': {
      // Unreachable in practice: resolveTarget() sends this variant to the
      // label worker. Handled rather than left to fall through silently.
      testHeader(enc, shop, 'LABEL TEST - WRONG PRINTER', test.issuedAt, cols);
      rule(enc, cols);
      enc.line('This test belongs on the label');
      enc.line('printer but was sent to the receipt');
      enc.line('printer. Please tell the office.');
      break;
    }
  }

  return finish(enc, cfg);
}

/**
 * A kind this build has no layout for.
 *
 * Prints an honest diagnostic rather than throwing. Throwing would fail the
 * job three times and leave staff with a red row and no explanation; a slip of
 * paper naming the kind is something they can act on. All six kinds are built,
 * so this is now purely a guard against a future kind reaching an older agent.
 */
export function renderUnknownReceipt(kind: string, cfg: ReceiptConfig): Uint8Array {
  const enc = newEncoder(cfg);
  selectCodepage(enc.initialize().newline(), cfg);
  enc.align('center').bold(true).line('FONOLOGY').bold(false);
  enc.newline();
  enc.align('left');
  enc.line(sanitiseForPrinter(`Print kind "${kind}" has no layout yet.`));
  enc.line('Please tell the office. Nothing is wrong with the printer.');
  return finish(enc, cfg);
}
