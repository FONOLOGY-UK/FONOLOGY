import type { RectOp } from './drawOps.js';

/**
 * Code 39, as bars we draw ourselves.
 * =========================================================================
 * WHY THIS EXISTS AT ALL, GIVEN THE ANTI-HALLUCINATION RULE
 *
 * The rule is: no printer PROTOCOL from memory. This is not protocol. Code 39
 * is a symbology — a table of bar/space patterns — and the table below is a
 * straight port of `apps/web/src/lib/barcode.ts`, which already renders the
 * label designer's barcodes and the job-label preview in the browser. It is not
 * recalled; it is copied from working code in this repo, and the port is
 * verified by encoding the same values in both and comparing (see the round
 * trip in the agent's own probe output).
 *
 * The Brother raster protocol is still never touched. These become plain
 * rectangles in millimetres, which GDI+ draws and the Brother driver
 * rasterises — exactly like every other op.
 *
 * ---------------------------------------------------------------------------
 * WHY CODE 39 AND NOT CODE 128 OR EAN-13
 * ---------------------------------------------------------------------------
 * One symbology across the whole shop. The web app already emits Code 39, the
 * receipt printer is asked for Code 39, and the labels drawn here are Code 39 —
 * so there is one thing to enable on the scanner and one thing that can be
 * wrong.
 *
 * The obvious objection is that a product barcode is an EAN-13 and "should" be
 * printed as EAN-13. It does not matter for the job this has to do: a scanner
 * decodes a symbol back to its DATA, and "5099999900001" read off a Code 39
 * symbol is the same string as read off an EAN-13 one. `GET /admin/products/
 * barcode/:code` matches on that string, so the till finds the same product
 * either way.
 *
 * What IS unverified is whether the shop's Eyoyo EY-7130 has Code 39 enabled —
 * most scanners do by default, some are shipped locked to EAN/UPC. That is
 * precisely what the `barcode` test print exists to settle, and if it fails the
 * fix is contained: an EAN-13 pattern table beside this one.
 *
 * ---------------------------------------------------------------------------
 * TWO DELIBERATE DIFFERENCES FROM THE WEB VERSION
 * ---------------------------------------------------------------------------
 * 1. IT REFUSES RATHER THAN FILTERS. The web version silently drops characters
 *    Code 39 cannot encode. On screen that is a preview; on a label it would
 *    mean a barcode that scans back as a DIFFERENT string than the one printed
 *    beneath it — the quiet-wrong-output failure this project keeps paying for.
 *    Here an unencodable value returns null and the caller prints the value as
 *    plain text instead.
 *
 * 2. IT REFUSES WHEN THE BARS WOULD BE TOO FINE TO READ. See MIN_NARROW_MM.
 */

/** Narrow and wide element widths, in abstract units. 2.6 is the web's ratio. */
const NARROW = 1;
const WIDE = 2.6;

/**
 * The narrowest bar we are willing to print, in millimetres.
 *
 * A JUDGEMENT, NOT A MEASURED DEVICE PROPERTY — flagged as such because it
 * reads like a spec. Code 39 practice puts the usable floor for a close-range
 * handheld somewhere near 0.19mm (7.5 mil); below that, read rates fall off and
 * the failure is intermittent, which is the worst kind at a counter. A long
 * value on a narrow roll is what would push us under it.
 *
 * When we would go under, no bars are drawn at all. A barcode that scans
 * sometimes is worse than one that is visibly absent, because the absent one
 * gets reported and the intermittent one gets blamed on the staff member.
 */
const MIN_NARROW_MM = 0.19;

/** 9 elements per character ('n'/'w'), alternating bar/space, starting on a bar. */
const CODE39: Record<string, string> = {
  '0': 'nnnwwnwnn',
  '1': 'wnnwnnnnw',
  '2': 'nnwwnnnnw',
  '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn',
  '6': 'nnwwwnnnn',
  '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn',
  '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw',
  B: 'nnwnnwnnw',
  C: 'wnwnnwnnn',
  D: 'nnnnwwnnw',
  E: 'wnnnwwnnn',
  F: 'nnwnwwnnn',
  G: 'nnnnnwwnw',
  H: 'wnnnnwwnn',
  I: 'nnwnnwwnn',
  J: 'nnnnwwwnn',
  K: 'wnnnnnnww',
  L: 'nnwnnnnww',
  M: 'wnwnnnnwn',
  N: 'nnnnwnnww',
  O: 'wnnnwnnwn',
  P: 'nnwnwnnwn',
  Q: 'nnnnnnwww',
  R: 'wnnnnnwwn',
  S: 'nnwnnnwwn',
  T: 'nnnnwnwwn',
  U: 'wwnnnnnnw',
  V: 'nwwnnnnnw',
  W: 'wwwnnnnnn',
  X: 'nwnnwnnnw',
  Y: 'wwnnwnnnn',
  Z: 'nwwnwnnnn',
  '-': 'nwnnnnwnw',
  '.': 'wwnnnnwnn',
  ' ': 'nwwnnnwnn',
  '*': 'nwnnwnwnn',
};

export interface BarcodeGeometry {
  /** Black bars on a unit grid: x offset and width, both in abstract units. */
  bars: { x: number; width: number }[];
  /** Total width of the symbol in the same units. */
  totalUnits: number;
}

/**
 * Encode a value, sentinels included, or null if Code 39 cannot represent it.
 *
 * Uppercased first, because Code 39's alphabet is uppercase — that is a
 * representation detail, not a change of data, and a scanner reads back the
 * uppercase form. A `*` inside the value is rejected rather than dropped: it is
 * the start/stop sentinel and embedding one would terminate the symbol early.
 */
export function encodeCode39(value: string): BarcodeGeometry | null {
  const upper = value.toUpperCase();
  if (upper.length === 0) return null;
  for (const char of upper) {
    if (char === '*' || CODE39[char] === undefined) return null;
  }

  const bars: { x: number; width: number }[] = [];
  let x = 0;
  for (const char of `*${upper}*`) {
    // Every character is known to be in the table: the loop above rejected the
    // value outright otherwise, and '*' is in the table as the sentinel. The
    // fallback keeps `noUncheckedIndexedAccess` satisfied without a cast.
    const pattern = CODE39[char] ?? '';
    for (let i = 0; i < pattern.length; i += 1) {
      const width = pattern[i] === 'w' ? WIDE : NARROW;
      // Even index is a bar, odd is a space. Only bars are drawn.
      if (i % 2 === 0) bars.push({ x, width });
      x += width;
    }
    x += NARROW; // inter-character gap
  }
  return { bars, totalUnits: Math.max(1, x - NARROW) };
}

/**
 * Lay a barcode out as rectangles inside a box, in millimetres.
 *
 * Returns null when the value cannot be encoded, or when fitting it into `w`
 * would take the narrow bars below MIN_NARROW_MM. Both cases mean "do not draw
 * a barcode here" — the caller falls back to printing the value as text, which
 * a person can still type into the till.
 */
export function drawCode39(opts: {
  value: string;
  /** Left edge, mm. */
  x: number;
  /** Top edge, mm. */
  y: number;
  /** Box width, mm. The symbol is scaled to fill it. */
  w: number;
  /** Bar height, mm. */
  h: number;
}): RectOp[] | null {
  const geometry = encodeCode39(opts.value);
  if (!geometry) return null;

  const unitMm = opts.w / geometry.totalUnits;
  if (unitMm * NARROW < MIN_NARROW_MM) return null;

  return geometry.bars.map((bar) => ({
    t: 'rect' as const,
    x: opts.x + bar.x * unitMm,
    y: opts.y,
    w: bar.width * unitMm,
    h: opts.h,
    fill: true,
  }));
}
