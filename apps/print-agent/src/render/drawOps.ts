/**
 * The label drawing vocabulary.
 * =========================================================================
 * A label is described as a display list in MILLIMETRES, and the Windows print
 * host executes it with GDI+ onto either the Brother driver or a PNG.
 *
 * WHY A DISPLAY LIST AND NOT AN IMAGE BUILT IN NODE
 * Rendering text to a bitmap in Node needs a native canvas binding, which
 * would drag a compiler toolchain into the install on a shop PC. Windows
 * already has a text renderer. Describing the drawing and letting GDI+ execute
 * it keeps the layout logic in TypeScript — where Part C will write it, beside
 * the rest of the product — while the renderer itself never has to change.
 *
 * WHY MILLIMETRES
 * The physical constraint is the roll: 62mm wide. Working in device pixels
 * would bake the 300dpi assumption into every coordinate, so a change of
 * printer or of roll would mean rewriting the layout rather than one setting.
 *
 * NOTE FOR PART C: `rect` exists so a barcode can be drawn as a run of bars
 * without this file or the PowerShell renderer changing. The Code128 encoding
 * itself is TypeScript that has not been written yet — deliberately, because
 * the reference format it encodes is a Part C decision.
 *
 * We never touch Brother's raster protocol. We draw; the installed Brother
 * driver rasterises. That is the entire reason this path could be written
 * without the device present.
 */

export interface TextOp {
  t: 'text';
  /** Millimetres from the left edge of the label. */
  x: number;
  /** Millimetres from the top edge. */
  y: number;
  /** Width of the text box in mm. Text wraps inside it rather than overflowing. */
  w?: number;
  /** Height of the text box in mm. Generous by default. */
  h?: number;
  text: string;
  /** Points, as on paper — independent of dpi. */
  size?: number;
  font?: string;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
}

export interface RectOp {
  t: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Filled by default. An outline uses `width` for the stroke. */
  fill?: boolean;
  width?: number;
}

export interface LineOp {
  t: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width?: number;
}

export type DrawOp = TextOp | RectOp | LineOp;

export interface LabelDocument {
  widthMm: number;
  heightMm: number;
  ops: DrawOp[];
}
