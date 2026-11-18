import { jobLabelPayloadSchema, shelfLabelPayloadSchema, testPrintPayloadSchema } from '../api.js';
import type { LabelConfig } from '../printerConfig.js';
import { drawCode39 } from './barcode.js';
import type { DrawOp, LabelDocument } from './drawOps.js';
import { formatPence, formatWhen, sanitiseForPrinter } from './sanitise.js';

/**
 * Turning a frozen payload into a label display list.
 * =========================================================================
 * NO BROTHER RASTER PROTOCOL IS WRITTEN ANYWHERE IN THIS AGENT. We produce a
 * list of things to draw in millimetres; the Windows print host draws them
 * with GDI+; the installed Brother driver rasterises. Brother owns the part
 * that cannot be verified without the device.
 *
 * ---------------------------------------------------------------------------
 * BARCODES ARE DRAWN, NOT COMMANDED
 * ---------------------------------------------------------------------------
 * Unlike the receipt path — where the printer draws the barcode from `GS k` —
 * a label barcode is emitted as a run of `rect` ops by render/barcode.ts. That
 * is what `rect` was put in the vocabulary for, and it means the bars are ours:
 * their width, position and quiet zone do not depend on anything Brother's
 * driver decides. Code 39, the same symbology the receipt asks for and the same
 * one the web app already draws.
 *
 * ---------------------------------------------------------------------------
 * WHAT A LABEL IS FOR, WHICH DRIVES THE LAYOUT
 * ---------------------------------------------------------------------------
 * A JOB LABEL is how a device on a shelf is matched back to its owner. The
 * reference and the customer's NAME are the two things that do that, so they
 * are the biggest type on it — and the label path renders glyphs via GDI+
 * rather than codepage bytes, so a name in any script comes out correctly
 * (verified: Polish, Chinese and Urdu all render, including RTL joining).
 * That is why the name matters more here than on any receipt.
 *
 * A SHELF LABEL is the most public surface in the shop. Stock counts, cost and
 * margin never appear on one — and the protection is upstream, in the payload
 * builder, which never loads those columns at all.
 *
 * ---------------------------------------------------------------------------
 * ASSUMPTION 2: a 62mm CONTINUOUS roll (DK-22205 / the DK-2205 starter roll)
 * ---------------------------------------------------------------------------
 * Continuous is self-correcting in a way die-cut is not: WE choose the length,
 * so being wrong about it wastes roll rather than cropping the customer's
 * phone number off the bottom. Both dimensions come from settings, never from
 * a constant here.
 */

/** Keep clear of the edges — no printer places its paper perfectly. */
const MARGIN_MM = 3;

/**
 * How much bigger than the first layout the job and shelf labels print.
 *
 * The first labels off the real QL-600 (30 Oct 2026) were right but read small
 * next to the shop's old ones, so every font size AND the space each line takes
 * grow together by this factor — growing only the fonts would overlap lines.
 * The width cannot grow (62mm roll), so text wraps sooner and a continuous
 * label simply comes out longer. The reference and the price are sized
 * separately: they must stay on one line.
 */
const ZOOM = 1.35;
function z(mm: number): number {
  return Math.round(mm * ZOOM * 10) / 10;
}

function labelWidth(cfg: LabelConfig): number {
  return cfg.rollWidthMm - MARGIN_MM * 2;
}

/**
 * `job_payment_status` as a human reads it.
 *
 * The enum values are `unpaid` / `deposit_paid` / `paid` (0006), and the first
 * render of this label printed "deposit_paid" verbatim onto a bench ticket.
 * Whether a customer still owes money is the second most important fact on the
 * label after whose device it is, so it gets read out loud across a counter —
 * a database identifier is the wrong thing to be reading.
 *
 * Unknown values pass through rather than being mapped to a guess: a status we
 * have not seen before printing as its raw name is a question, one silently
 * relabelled "Paid" is a device handed back for free.
 */
function paymentStatusLabel(status: string): string {
  switch (status) {
    case 'unpaid':
      return 'UNPAID';
    case 'deposit_paid':
      return 'Deposit paid';
    case 'paid':
      return 'PAID';
    default:
      return status;
  }
}

/** Height of a drawn barcode's bars, and of the value printed under it. */
const BARCODE_H_MM = z(9);
const BARCODE_TEXT_H_MM = z(3.5);

/**
 * Draw a barcode plus its value as text, or just the value when Code 39 cannot
 * carry it (or the bars would be too fine to scan — see barcode.ts).
 *
 * The value is ALWAYS printed, bars or no bars. It is what a person reads off
 * the shelf and types in when the scanner will not cooperate, and a label whose
 * only identifier is a symbol that failed to encode is a device nobody can
 * match to a job.
 *
 * Returns the height consumed so callers can keep stacking.
 */
function pushBarcode(ops: DrawOp[], value: string, x: number, y: number, w: number): number {
  const bars = drawCode39({ value, x, y, w, h: BARCODE_H_MM });
  let used = 0;
  if (bars) {
    ops.push(...bars);
    used += BARCODE_H_MM + z(0.5);
  }
  ops.push({
    t: 'text',
    x,
    y: y + used,
    w,
    text: sanitiseForPrinter(value),
    size: z(7),
    h: BARCODE_TEXT_H_MM,
    align: 'center',
  });
  return used + BARCODE_TEXT_H_MM;
}

/**
 * How tall a block of text needs to be once it wraps inside `w`.
 *
 * Change request item 1 asked whether a long job note needs a max-character
 * rule or an auto-shrinking font. It needs neither, and this is why.
 *
 * Every other block on this label carries a hardcoded `h` sized for the two
 * lines its field usually runs to. A job note has no usual length — it is
 * whoever was on the counter typing whatever mattered. A fixed `h` would clip
 * it silently (the text box wraps inside `h` and drops the rest), which on a
 * note reading "battery swollen, DO NOT CHARGE" is the worst possible failure.
 *
 * So the block is measured instead. On a CONTINUOUS roll that is the whole
 * answer: the label already grows to fit its content (see heightMm below), so
 * a long note makes a slightly longer ticket and nothing is lost. On a DIE-CUT
 * roll the length is fixed by the physical label and something has to give —
 * there the caller caps this against the space genuinely left, so the note
 * takes what remains rather than pushing the barcode off the end.
 *
 * The arithmetic is an estimate, not metrics: GDI+ does the real layout on the
 * till PC and we have no font metrics here. 1pt = 0.3528mm; an average
 * proportional glyph is around half its point size wide; lines sit at about
 * 1.3x their size. Erring long costs a few mm of roll, erring short clips
 * text, so the estimate is deliberately generous.
 */
function wrappedHeightMm(text: string, widthMm: number, sizePt: number): number {
  const lineMm = sizePt * 0.3528 * 1.3;
  // 0.6 of the size, not 0.5: measured on the bigger (ZOOM) labels, Arial
  // wrapped a note after ~30 characters where 0.5 predicted 33, and the last
  // line of the note was clipped. Wider is the safe direction.
  const charMm = sizePt * 0.3528 * 0.6;
  const perLine = Math.max(8, Math.floor(widthMm / charMm));
  // Count the newlines a person actually typed as well as the wrapping ones.
  const lines = text
    .split('\n')
    .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / perLine)), 0);
  return lines * lineMm;
}

/**
 * Height for a text block that may wrap: the designed height, or more when the
 * text needs it. On a continuous roll the label grows, so nothing is clipped; a
 * die-cut label keeps the designed height because its length is fixed.
 */
function blockH(
  text: string,
  designedMm: number,
  widthMm: number,
  sizePt: number,
  cfg: LabelConfig,
): number {
  if (cfg.rollType !== 'continuous') return designedMm;
  return Math.max(designedMm, wrappedHeightMm(text, widthMm, sizePt));
}

/**
 * Which door the job came through, as the bench needs to read it.
 *
 * Item 1 names Mail-in and Walk-in only, but `job_source` has a third value.
 * `online` is not guessed at here: the rest of the app already decides what it
 * means. `isMailIn()` (apps/web/src/lib/data/types/job.ts) returns false for
 * it, so `collected` is the only terminal status an online job can reach —
 * the device is handed over in the shop exactly like a walk-in. The label says
 * that plainly rather than printing a word ("Online") that tells the person
 * holding the device nothing about what to do with it.
 */
function jobSourceLine(source: 'walk_in' | 'mail_in' | 'online'): string {
  switch (source) {
    case 'mail_in':
      return 'MAIL-IN — POST BACK';
    case 'walk_in':
      return 'WALK-IN — COLLECT IN SHOP';
    case 'online':
      return 'ONLINE — COLLECT IN SHOP';
  }
}

/**
 * The bench ticket stuck on a device in for repair: everything on it, as short as it can be.
 *
 * The first layout reserved fixed blocks for each field (12mm for a device called "iphone 14"),
 * so a walk-in ticket ran to about 115mm and took the 150mm "Fonology" format, longer than the
 * phone; and "WALK-IN — COLLECT IN SHOP" wrapped inside a one-line box, losing "SHOP". Now every
 * block is measured, the lines that must stay whole shrink to fit one line, the date shares the
 * header and the reference is not printed twice. A usual ticket is about 50mm and lands on the
 * 60mm format; a long description or note simply grows it.
 *
 * Order, top to bottom: FONOLOGY and the date, the reference (how a device on the shelf is matched
 * to its job, so the biggest type), the customer and phone, how it goes back (walk-in or mail-in),
 * the device and the problem, price and payment, the note in full, then the reference barcode.
 */
export function renderJobLabel(payload: unknown, cfg: LabelConfig): LabelDocument {
  const job = jobLabelPayloadSchema.parse(payload);
  const x = 2;
  const w = cfg.rollWidthMm - x * 2;
  const ops: DrawOp[] = [];
  let y = 1.5;

  /** A block of text at `size`, as tall as it needs once wrapped, then a small gap. */
  const block = (text: string, size: number, bold = false, align: 'left' | 'center' = 'left') => {
    const clean = sanitiseForPrinter(text);
    const h = wrappedHeightMm(clean, w, size);
    ops.push({ t: 'text', x, y, w, h, text: clean, size, bold, align });
    y += h + 0.3;
  };
  /** One line that must not wrap: shrunk to fit the width (to 70% at most), else wrapped. */
  const oneLine = (text: string, size: number, bold = false) =>
    block(text, fitPt(sanitiseForPrinter(text), size, w, Math.round(size * 0.7)), bold);

  // Header: the shop, and when the job was booked, on one line.
  const headH = 8 * 0.3528 * 1.3;
  ops.push({ t: 'text', x, y, w, h: headH, text: 'FONOLOGY', size: 8, bold: true });
  ops.push({
    t: 'text',
    x,
    y,
    w,
    h: headH,
    text: sanitiseForPrinter(formatWhen(job.createdAt)),
    size: 8,
    align: 'right',
  });
  y += headH + 0.3;
  ops.push({ t: 'line', x1: x, y1: y, x2: x + w, y2: y, width: 0.3 });
  y += 0.8;

  oneLine(job.reference, 15, true);

  // The customer and their phone: one line when both fit, else one under the other. No phone is
  // a real state (jobs.phone is nullable), and saying so beats printing "null".
  const name = sanitiseForPrinter(job.customerName);
  const phone = sanitiseForPrinter(job.phone ?? 'No phone on file');
  const nameW = name.length * 11 * 0.3528 * FIT_CHAR_EM;
  const phoneW = phone.length * 10 * 0.3528 * 0.6;
  if (nameW + phoneW + 3 <= w) {
    const rowH = 11 * 0.3528 * 1.3;
    ops.push({ t: 'text', x, y, w, h: rowH, text: name, size: 11, bold: true });
    ops.push({ t: 'text', x, y: y + 0.4, w, h: rowH, text: phone, size: 10, align: 'right' });
    y += rowH + 0.3;
  } else {
    block(job.customerName, 11, true);
    block(phone, 10);
  }

  // Walk-in or mail-in, in caps: whether the device can go to the person at the counter.
  oneLine(jobSourceLine(job.source), 10, true);

  block(job.deviceDescription, 10);
  block(job.problemDescription, 9);

  const price = job.quotedPrice === null ? 'Not quoted' : `£${formatPence(job.quotedPrice)}`;
  oneLine(`${price}  ·  ${paymentStatusLabel(job.paymentStatus)}`, 11, true);

  // The job note in full ("battery swollen, do not charge" has to travel with the device).
  const note = job.notes?.trim();
  if (note) block(`Note: ${note}`, 9);

  // The reference as a barcode, last, in the same place on every ticket. Its text is already the
  // biggest line on the label, so it is only printed again if the bars cannot be drawn.
  y += 0.5;
  const barH = 8.5;
  // 56mm wide like the old ticket's: a 17-character reference needs about that much to stay
  // scannable, and the 3mm either side is the clear space a scanner needs.
  const bars = drawCode39({ value: job.reference, x: x + 1, y, w: w - 2, h: barH });
  if (bars) {
    ops.push(...bars);
    y += barH;
  } else {
    block(job.reference, 10, false, 'center');
  }

  return {
    widthMm: cfg.rollWidthMm,
    // A continuous roll grows to fit, so nothing is ever clipped; a die-cut label keeps its length.
    heightMm:
      cfg.rollType === 'continuous' ? Math.max(cfg.labelLengthMm, y + 1) : cfg.labelLengthMm,
    ops,
  };
}

/**
 * A shelf label: what a product costs and what it scans as.
 *
 * NOTHING HERE IS STAFF-ONLY. No stock count, no cost, no margin — and the
 * reason that is safe is upstream: `buildShelfLabel` never selects those
 * columns, so they are not in the payload to leak. This renderer could not
 * print them if it tried.
 *
 * The price is the EFFECTIVE one from `resolve_sale_unit_price` — the same
 * function the till charges by — so the shelf and the till cannot disagree.
 * Bulk tiers appear when the shop is running one, because a label reading
 * "£10" beside a till that rings "3 for £24" understates the shop's own offer.
 */
export function renderShelfLabel(payload: unknown, cfg: LabelConfig): LabelDocument {
  const item = shelfLabelPayloadSchema.parse(payload);
  if (item.lines?.length) return renderTemplateLabel(item.lines, item.barcode, cfg);
  const w = labelWidth(cfg);
  const ops: DrawOp[] = [];
  let y = MARGIN_MM;

  const nameH = blockH(item.name, z(9), w, z(9), cfg);
  ops.push({
    t: 'text',
    x: MARGIN_MM,
    y,
    w,
    text: sanitiseForPrinter(item.name),
    size: z(9),
    bold: true,
    h: nameH,
  });
  y += nameH + z(0.5);

  if (item.sub) {
    ops.push({
      t: 'text',
      x: MARGIN_MM,
      y,
      w,
      text: sanitiseForPrinter(item.sub),
      size: z(7),
      h: z(4.5),
    });
    y += z(5);
  }

  // The price is the reason the label exists. Biggest thing on it.
  ops.push({
    t: 'text',
    x: MARGIN_MM,
    y,
    w,
    text: `£${formatPence(item.price)}`,
    // 26pt, not z(20): '£1,299.99' must stay on one line inside 56mm.
    size: 26,
    bold: true,
    h: z(10),
  });
  y += z(11);

  for (const tier of item.bulkTiers) {
    ops.push({
      t: 'text',
      x: MARGIN_MM,
      y,
      w,
      text: sanitiseForPrinter(`${tier.minQty}+  £${formatPence(tier.unitPrice)} each`),
      size: z(8),
      bold: true,
      h: z(4.5),
    });
    y += z(5);
  }

  // Only when the product actually has one. A shelf label with an invented or
  // blank barcode is worse than one with none: it scans as nothing at the till
  // and staff waste time on it.
  if (item.barcode) {
    y += z(1.5);
    // Client changes, Oct 2026 #8: the shop's name over the bars, so a label with one of the
    // shop's own "29…" numbers still says whose it is (the number itself stays numeric for
    // scanner compatibility).
    ops.push({ t: 'text', x: MARGIN_MM, y, w, text: 'FONOLOGY', size: z(7), bold: true, h: z(4) });
    y += z(4.5);
    y += pushBarcode(ops, item.barcode, MARGIN_MM, y, w);
  }

  return {
    widthMm: cfg.rollWidthMm,
    heightMm:
      cfg.rollType === 'continuous'
        ? Math.max(cfg.labelLengthMm, y + MARGIN_MM)
        : cfg.labelLengthMm,
    ops,
  };
}

/**
 * A label template from Admin -> Labels, as the shop designed it: every line centred and as big as
 * the 62mm roll allows, the price line biggest, then a compact barcode. Modelled on the shop's old
 * price labels. It used to print from the browser, which the Brother driver shrank into a corner of
 * a long blank strip.
 *
 * Sized to land on the 60mm "Fonology" format for a usual phone label (name, two short lines, a
 * price, a barcode): the driver's feed takes 3mm off each end, so the drawing stays under 54mm.
 * (the host takes a format when the drawing is within its length less 5.5mm). A longer label
 * simply gets the next format.
 */
const TEMPLATE_PT = { lg: 20, md: 14, sm: 11 } as const;
const TEMPLATE_PRICE_PT = 34;
/** A price line: "£799", "£1,299.99". */
const TEMPLATE_PRICE_LINE = /^£\s*[\d,]+(?:\.\d{1,2})?$/;
/** Arial bold runs a little wider than regular; erring wide shrinks the text rather than clipping it. */
const FIT_CHAR_EM = 0.62;

/** The biggest size up to `pt` at which `text` fits one line of `widthMm`, or `minPt`. */
function fitPt(text: string, pt: number, widthMm: number, minPt: number): number {
  const fits = widthMm / (Math.max(1, text.length) * 0.3528 * FIT_CHAR_EM);
  return Math.max(minPt, Math.min(pt, Math.floor(fits * 2) / 2));
}

function renderTemplateLabel(
  lines: { text: string; size: 'sm' | 'md' | 'lg'; bold: boolean }[],
  barcode: string | null,
  cfg: LabelConfig,
): LabelDocument {
  const x = 2;
  const w = cfg.rollWidthMm - x * 2;
  const ops: DrawOp[] = [];
  let y = 1.5;

  for (const line of lines) {
    const text = sanitiseForPrinter(line.text);
    const isPrice = TEMPLATE_PRICE_LINE.test(line.text.trim());
    const wanted = isPrice ? TEMPLATE_PRICE_PT : TEMPLATE_PT[line.size];
    // A line too long for one line at its size shrinks to fit (down to 70%), then wraps.
    const size = fitPt(text, wanted, w, Math.round(wanted * 0.7));
    const h = Math.max(size * 0.3528 * 1.18, wrappedHeightMm(text, w, size));
    ops.push({ t: 'text', x, y, w, h, text, size, bold: isPrice || line.bold, align: 'center' });
    y += h + 0.5;
  }

  if (barcode) {
    // The shop's name over the bars, as on every shelf label (client changes, Oct 2026 #8).
    ops.push({
      t: 'text',
      x,
      y,
      w,
      h: 3.4,
      text: 'FONOLOGY',
      size: 8,
      bold: true,
      align: 'center',
    });
    y += 3.4;
    const barH = 8.5;
    const bars = drawCode39({ value: barcode, x, y, w, h: barH });
    if (bars) {
      ops.push(...bars);
      y += barH + 0.5;
    }
    ops.push({
      t: 'text',
      x,
      y,
      w,
      h: 4,
      text: sanitiseForPrinter(barcode),
      size: 9,
      align: 'center',
    });
    y += 4;
  }

  return {
    widthMm: cfg.rollWidthMm,
    heightMm:
      cfg.rollType === 'continuous' ? Math.max(cfg.labelLengthMm, y + 1) : cfg.labelLengthMm,
    ops,
  };
}

/**
 * TEST 5 of 5 — the label printer.
 *
 * A photograph of it settles two questions:
 *
 *   1. DOES A FULL-SIZE LABEL COME OUT WHOLE? It uses the same type sizes and
 *      spacing as the real job and shelf labels (ZOOM), so if every line and
 *      the barcode are on the paper, the real ones will be too.
 *   2. DOES A DRAWN BARCODE SCAN? Same product, same scanner as test 4 — so
 *      the two tests together prove BOTH printers against the same known-good
 *      answer.
 *
 * It used to carry a border and corner ticks to check the roll width and the
 * page orientation. Both were settled on the real QL-600 (30 Oct 2026) and the
 * shop found the box made the label look small, so they are gone.
 */
export function renderTestLabel(payload: unknown, cfg: LabelConfig): LabelDocument {
  const test = testPrintPayloadSchema.parse(payload);
  const w = labelWidth(cfg);
  const ops: DrawOp[] = [];
  let y = MARGIN_MM;

  ops.push({
    t: 'text',
    x: MARGIN_MM,
    y,
    w,
    text: 'TEST 5 of 5 - LABEL',
    size: z(9),
    bold: true,
    h: z(5),
  });
  y += z(5.5);

  ops.push({
    t: 'text',
    x: MARGIN_MM,
    y,
    w,
    text: `${cfg.rollWidthMm}mm ${cfg.rollType}`,
    size: z(7),
    h: z(4),
  });
  y += z(4.5);

  ops.push({
    t: 'text',
    x: MARGIN_MM,
    y,
    w,
    text: sanitiseForPrinter(formatWhen(test.issuedAt)),
    size: z(7),
    h: z(4),
  });
  y += z(5.5);

  if (test.product) {
    ops.push({
      t: 'text',
      x: MARGIN_MM,
      y,
      w,
      text: sanitiseForPrinter(`Scans as: ${test.product.name}`),
      size: z(8),
      bold: true,
      h: z(9),
    });
    y += z(9.5);
    y += pushBarcode(ops, test.product.barcode, MARGIN_MM, y, w);
  } else {
    ops.push({
      t: 'text',
      x: MARGIN_MM,
      y,
      w,
      text: 'No product attached, so there is nothing to scan. Start the test again and pick one.',
      size: z(7),
      h: z(12),
    });
    y += z(12);
  }

  return { widthMm: cfg.rollWidthMm, heightMm: Math.max(cfg.labelLengthMm, y + MARGIN_MM), ops };
}

/** See renderUnknownReceipt — same reasoning, printed rather than thrown. */
export function renderUnknownLabel(kind: string, cfg: LabelConfig): LabelDocument {
  const w = labelWidth(cfg);
  return {
    widthMm: cfg.rollWidthMm,
    heightMm: cfg.labelLengthMm,
    ops: [
      { t: 'text', x: MARGIN_MM, y: MARGIN_MM, w, text: 'FONOLOGY', size: 9, bold: true, h: 5 },
      {
        t: 'text',
        x: MARGIN_MM,
        y: MARGIN_MM + 6,
        w,
        text: sanitiseForPrinter(`No layout yet for "${kind}".`),
        size: 7,
        h: 10,
      },
    ],
  };
}
