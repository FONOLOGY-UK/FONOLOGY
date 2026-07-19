/**
 * Admin chart palette — VALIDATED with the dataviz six-checks script against
 * the card surface #faf9f6 (lightness band, chroma floor, CVD separation,
 * normal-vision floor, contrast: all PASS). Do not eyeball replacements —
 * re-run the validator if these change.
 *
 * Series hues follow the entity, never the rank:
 *   repairs  → vermilion (the trade the brand is named for)
 *   shop     → steel blue (the counter)
 *   reserve  → brass (only if a third series ever exists)
 * Single-hue magnitude charts (category/tender bars, heatmap) use vermilion.
 */
export const CHART = {
  repair: '#e8250c',
  shop: '#1f6fa8',
  reserve: '#a8842c',
  grid: 'rgba(24, 16, 16, 0.08)',
  axis: '#7b706a',
  surface: '#faf9f6',
} as const;

/** Sequential ramp for the heatmap: light red-tint → deep red (monotone lightness). */
export function heatColor(t: number): string {
  const clamp = Math.max(0, Math.min(1, t));
  const from = { r: 0xf7, g: 0xe7, b: 0xe0 };
  const to = { r: 0xb8, g: 0x1d, b: 0x06 };
  const mix = (a: number, b: number) => Math.round(a + (b - a) * clamp);
  return `rgb(${mix(from.r, to.r)}, ${mix(from.g, to.g)}, ${mix(from.b, to.b)})`;
}
