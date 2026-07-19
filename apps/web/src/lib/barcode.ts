/**
 * Code 39 barcode encoder — real, scannable output for printed labels (item 7:
 * job/device labels + the label designer). Code 39 needs no checksum and
 * covers A–Z 0–9 and a few symbols, which is exactly the label use-case.
 * Unsupported characters are dropped (uppercased first).
 *
 * Each character is 9 elements (bars/spaces) of which 3 are wide. Output is a
 * list of black bar [x, width] pairs on a unit grid for SVG rendering.
 */

const NARROW = 1;
const WIDE = 2.6;

/** 9-char patterns ('n'/'w'), alternating bar/space starting with a bar. */
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

export interface BarcodeBar {
  x: number;
  width: number;
}

/** Encode `value` (plus start/stop sentinels) into black-bar geometry. */
export function encodeCode39(value: string): { bars: BarcodeBar[]; totalWidth: number } {
  const clean = value
    .toUpperCase()
    .split('')
    .filter((c) => c !== '*' && CODE39[c] !== undefined)
    .join('');
  const chars = `*${clean}*`;

  const bars: BarcodeBar[] = [];
  let x = 0;
  for (const char of chars) {
    const pattern = CODE39[char];
    if (!pattern) continue;
    for (let i = 0; i < pattern.length; i += 1) {
      const width = pattern[i] === 'w' ? WIDE : NARROW;
      if (i % 2 === 0) bars.push({ x, width }); // even index = bar, odd = space
      x += width;
    }
    x += NARROW; // inter-character gap
  }
  return { bars, totalWidth: Math.max(1, x - NARROW) };
}
