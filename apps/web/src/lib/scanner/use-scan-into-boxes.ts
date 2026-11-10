'use client';

import { useBarcodeScan } from './use-barcode-scan';

/**
 * Scanning a barcode into the product form (Add / Edit product, and its variation boxes).
 *
 * A barcode box opts in with `data-scan-target` (`="enter"` when its own Enter does the saving, as
 * the extra-barcode and variation-list boxes do). While the form is open, a scan:
 *   - goes into the box that has focus, if it is a barcode box (replacing what was there);
 *   - otherwise goes into the first empty barcode box of the dialog on top (the main Barcode box,
 *     or the next variation without one), and is taken back out of whichever other box it typed
 *     into;
 *   - never submits the form: the capture swallows the scanner's Enter.
 * The value is written through the input's native setter plus an `input` event, so react-hook-form
 * and the controlled variation inputs both pick it up the same way as typing.
 */

const TARGET = 'input[data-scan-target]:not([disabled])';
const OPEN_DIALOG = '[role="dialog"]:not([data-state="closed"])';

function writeValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function pressEnter(input: HTMLInputElement) {
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

function intoBox(code: string) {
  const active = document.activeElement;
  const focused = active instanceof HTMLInputElement ? active : null;

  // The focused box is a barcode box: the scan is its value.
  if (focused?.matches(TARGET)) {
    writeValue(focused, code);
    if (focused.dataset.scanTarget === 'enter') pressEnter(focused);
    return;
  }

  // Which form: the dialog holding focus, or the top one open (nested variation dialogs sit last).
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>(OPEN_DIALOG));
  const scope = (focused?.closest<HTMLElement>(OPEN_DIALOG) ?? dialogs.at(-1)) || null;
  const boxes = scope ? Array.from(scope.querySelectorAll<HTMLInputElement>(TARGET)) : [];
  // A dialog with no barcode box (the PIN lock, a confirm) is left alone.
  if (boxes.length === 0) return;

  // The scanner typed into some other box (Name, price...): take it back out.
  if (focused && focused.type !== 'checkbox' && focused.value.includes(code)) {
    writeValue(focused, focused.value.replace(code, ''));
  }

  const target = boxes.find((b) => !b.value.trim()) ?? boxes[0]!;
  writeValue(target, code);
  if (target.dataset.scanTarget === 'enter') {
    pressEnter(target);
    return;
  }
  // Ready for the next scan: the next empty barcode box, if any.
  const next = boxes.find((b) => b !== target && !b.value.trim());
  (next ?? target).focus();
}

/** Call once from the product form, with whether it is open. */
export function useScanIntoBarcodeBoxes(enabled: boolean) {
  useBarcodeScan(intoBox, { enabled, allowWhenModalOpen: true });
}

/** Spread on a barcode box whose form must not submit when the scanner (or anyone) presses Enter. */
export const barcodeBoxProps = {
  'data-scan-target': '',
  autoComplete: 'off',
  onKeyDown: (e: { key: string; preventDefault: () => void }) => {
    if (e.key === 'Enter') e.preventDefault();
  },
} as const;
