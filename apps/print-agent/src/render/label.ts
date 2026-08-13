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
const BARCODE_H_MM = 9;
const BARCODE_TEXT_H_MM = 3.5;

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
    used += BARCODE_H_MM + 0.5;
  }
  ops.push({
    t: 'text',
    x,
    y: y + used,
    w,
    text: sanitiseForPrinter(value),
    size: 7,
    h: BARCODE_TEXT_H_MM,
    align: 'center',
  });
  return used + BARCODE_TEXT_H_MM;
}

export function renderJobLabel(payload: unknown, cfg: LabelConfig): LabelDocument {
  const job = jobLabelPayloadSchema.parse(payload);
  const w = labelWidth(cfg);
  const ops: DrawOp[] = [];

  let y = MARGIN_MM;

  ops.push({ t: 'text', x: MARGIN_MM, y, w, text: 'FONOLOGY', size: 9, bold: true, h: 5 });
  y += 5;

  ops.push({
    t: 'line',
    x1: MARGIN_MM,
    y1: y,
    x2: MARGIN_MM + w,
    y2: y,
    width: 0.4,
  });
  y += 1.5;

  // The reference is the single most important thing on a bench ticket: it is
  // how a device on a shelf is matched back to a job. Biggest type on the
  // label, and first.
  ops.push({
    t: 'text',
    x: MARGIN_MM,
    y,
    w,
    text: sanitiseForPrinter(job.reference),
    size: 13,
    bold: true,
    h: 7,
  });
  y += 7.5;

  ops.push({
    t: 'text',
    x: MARGIN_MM,
    y,
    w,
    text: sanitiseForPrinter(job.customerName),
    size: 8,
    bold: true,
    h: 4.5,
  });
  y += 4.5;

  ops.push({ t: 'text', x: MARGIN_MM, y, w, text: sanitiseForPrinter(job.phone), size: 8, h: 4.5 });
  y += 5;

  ops.push({
    t: 'text',
    x: MARGIN_MM,
    y,
    w,
    text: sanitiseForPrinter(job.deviceDescription),
    size: 8,
    h: 9,
  });
  y += 9;

  ops.push({
    t: 'text',
    x: MARGIN_MM,
    y,
    w,
    text: sanitiseForPrinter(job.problemDescription),
    size: 7,
    h: 9,
  });
  y += 9;

  const price = job.quotedPrice === null ? 'Not quoted' : `£${formatPence(job.quotedPrice)}`;
  const paid = paymentStatusLabel(job.paymentStatus);
  ops.push({
    t: 'text',
    x: MARGIN_MM,
    y,
    w,
    text: sanitiseForPrinter(`${price}  ·  ${paid}`),
    size: 8,
    bold: true,
    h: 5,
  });
  y += 5;

  ops.push({
    t: 'text',
    x: MARGIN_MM,
    y,
    w,
    text: sanitiseForPrinter(formatWhen(job.createdAt)),
    size: 6,
    h: 4,
  });
  y += 5;

  // The scannable copy of the reference, last and in a consistent place — a
  // bench ticket is scanned off a shelf, and hunting for the symbol is what
  // makes people give up and type it instead.
  y += pushBarcode(ops, job.reference, MARGIN_MM, y, w);

  return {
    widthMm: cfg.rollWidthMm,
    // On a CONTINUOUS roll the length is ours to choose, so the label grows to
    // fit its content instead of clipping it — a long device description must
    // never push the phone number off the end. `labelLengthMm` is the minimum,
    // not the maximum.
    //
    // This is exactly why assumption 2 is cheap to be wrong about. On a DIE-CUT
    // roll the length is fixed by the physical label and growing is not an
    // option; that branch is deliberately not written on a guess, and settings
    // already carry `rollType` so it can be added when someone can see the box.
    heightMm:
      cfg.rollType === 'continuous'
        ? Math.max(cfg.labelLengthMm, y + MARGIN_MM)
        : cfg.labelLengthMm,
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
  const w = labelWidth(cfg);
  const ops: DrawOp[] = [];
  let y = MARGIN_MM;

  ops.push({
    t: 'text',
    x: MARGIN_MM,
    y,
    w,
    text: sanitiseForPrinter(item.name),
    size: 9,
    bold: true,
    h: 9,
  });
  y += 9.5;

  if (item.sub) {
    ops.push({
      t: 'text',
      x: MARGIN_MM,
      y,
      w,
      text: sanitiseForPrinter(item.sub),
      size: 7,
      h: 4.5,
    });
    y += 5;
  }

  // The price is the reason the label exists. Biggest thing on it.
  ops.push({
    t: 'text',
    x: MARGIN_MM,
    y,
    w,
    text: `£${formatPence(item.price)}`,
    size: 20,
    bold: true,
    h: 10,
  });
  y += 11;

  for (const tier of item.bulkTiers) {
    ops.push({
      t: 'text',
      x: MARGIN_MM,
      y,
      w,
      text: sanitiseForPrinter(`${tier.minQty}+  £${formatPence(tier.unitPrice)} each`),
      size: 8,
      bold: true,
      h: 4.5,
    });
    y += 5;
  }

  // Only when the product actually has one. A shelf label with an invented or
  // blank barcode is worse than one with none: it scans as nothing at the till
  // and staff waste time on it.
  if (item.barcode) {
    y += 1.5;
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
 * TEST 5 of 5 — the label printer.
 *
 * Designed so a photograph settles three questions at once:
 *
 *   1. IS THE ROLL THE WIDTH WE THINK? An inset border runs the full usable
 *      width. If the roll is narrower, the right-hand edge of the box is
 *      simply not on the paper — and a box with three sides is unmissable to
 *      someone who has never seen the correct output.
 *   2. IS THE LABEL FEEDING SQUARE? Corner ticks sit at all four corners. A
 *      misfeed or a skew shows as ticks at different distances from the edges.
 *   3. DOES A DRAWN BARCODE SCAN? Same product, same scanner as test 4 — so
 *      the two tests together prove BOTH printers against the same known-good
 *      answer.
 */
export function renderTestLabel(payload: unknown, cfg: LabelConfig): LabelDocument {
  const test = testPrintPayloadSchema.parse(payload);
  const w = labelWidth(cfg);

  // Tall enough for the border to be a recognisable box rather than a strip.
  const heightMm = Math.max(cfg.labelLengthMm, 52);
  const boxH = heightMm - MARGIN_MM * 2;

  const ops: DrawOp[] = [];

  // ---- The border, inset by the margin on every side. ---------------------
  ops.push({ t: 'rect', x: MARGIN_MM, y: MARGIN_MM, w, h: boxH, fill: false, width: 0.4 });

  // ---- Corner ticks, just inside the border. ------------------------------
  // Solid squares rather than lines: a 1.5mm block survives a poor photograph,
  // where a 0.4mm hairline may not.
  const TICK = 2;
  const corners: [number, number][] = [
    [MARGIN_MM, MARGIN_MM],
    [MARGIN_MM + w - TICK, MARGIN_MM],
    [MARGIN_MM, MARGIN_MM + boxH - TICK],
    [MARGIN_MM + w - TICK, MARGIN_MM + boxH - TICK],
  ];
  for (const [cx, cy] of corners) {
    ops.push({ t: 'rect', x: cx, y: cy, w: TICK, h: TICK, fill: true });
  }

  let y = MARGIN_MM + TICK + 1.5;
  const innerX = MARGIN_MM + TICK + 1;
  const innerW = w - (TICK + 1) * 2;

  ops.push({
    t: 'text',
    x: innerX,
    y,
    w: innerW,
    text: 'TEST 5 of 5 - LABEL',
    size: 8,
    bold: true,
    h: 4.5,
  });
  y += 5;

  ops.push({
    t: 'text',
    x: innerX,
    y,
    w: innerW,
    text: `${cfg.rollWidthMm}mm ${cfg.rollType}`,
    size: 6,
    h: 3.5,
  });
  y += 4;

  ops.push({
    t: 'text',
    x: innerX,
    y,
    w: innerW,
    text: sanitiseForPrinter(formatWhen(test.issuedAt)),
    size: 6,
    h: 3.5,
  });
  y += 5;

  if (test.product) {
    ops.push({
      t: 'text',
      x: innerX,
      y,
      w: innerW,
      text: sanitiseForPrinter(`Scans as: ${test.product.name}`),
      size: 6,
      h: 7,
    });
    y += 7.5;
    pushBarcode(ops, test.product.barcode, innerX, y, innerW);
  } else {
    ops.push({
      t: 'text',
      x: innerX,
      y,
      w: innerW,
      text: 'No product attached, so there is nothing to scan. Start the test again and pick one.',
      size: 6,
      h: 10,
    });
  }

  return { widthMm: cfg.rollWidthMm, heightMm, ops };
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
