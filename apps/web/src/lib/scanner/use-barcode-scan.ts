'use client';

import { useEffect, useRef } from 'react';
import { createScanCapture, type ScanCaptureOptions } from './scan-capture';

/**
 * React wrapper around `createScanCapture`. All the timing logic lives in
 * that module; this only manages the listener's lifetime and the two guards
 * that need to know about the DOM as a whole.
 */

/**
 * Is a modal surface currently up? Covers Radix dialogs (`role="dialog"`,
 * which DialogContent sets) and the PIN lock overlay, which sets the same
 * role by hand — see `components/admin/pin-lock.tsx`.
 *
 * This matters because the till sits behind those overlays: a scan that
 * reached through the PIN lock would add a product to a sale nobody can see,
 * and a scan reaching past an open dialog would fire a hidden action on the
 * screen underneath.
 */
/**
 * Radix keeps a dialog MOUNTED after it closes (it waits on the exit
 * animation), flipping `data-state` to "closed" rather than removing the
 * node. Matching on the role alone therefore treats a dialog that has been
 * opened once as open forever, which silently kills scanning for the rest of
 * the session — caught on the real till, not in a unit test.
 *
 * `:not([data-state="closed"])` also correctly matches the PIN lock overlay,
 * which sets role="dialog" by hand and carries no data-state at all.
 */
const MODAL_SELECTOR =
  '[role="dialog"]:not([data-state="closed"]), [role="alertdialog"]:not([data-state="closed"])';

function openModals(): Element[] {
  return Array.from(document.querySelectorAll(MODAL_SELECTOR)).filter(
    (el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true',
  );
}

function aModalIsOpen(): boolean {
  return openModals().length > 0;
}

/**
 * Is this keystroke landing on the page BEHIND an open modal?
 *
 * Not hypothetical: the till's "count the float" dialog opens with focus left
 * on the search box behind it, so keystrokes — a scan or otherwise — reach
 * the covered screen. While a modal is up, anything aimed past it is stopped;
 * anything aimed at the modal itself is left completely alone so the dialog's
 * own inputs keep working normally.
 */
function targetsBehindAModal(event: KeyboardEvent): boolean {
  const modals = openModals();
  if (modals.length === 0) return false;
  const target = event.target as Node | null;
  if (!target) return true;
  return !modals.some((modal) => modal.contains(target));
}

export interface UseBarcodeScanOptions extends Omit<ScanCaptureOptions, 'onScan' | 'isEnabled'> {
  /** Turn capture off entirely (screen not ready, feature disabled). */
  enabled?: boolean;
  /**
   * Receive scans even while a dialog is open. Default false — a dialog that
   * genuinely wants scans opts in, everything else stays deaf so a scan can
   * never trigger something on the screen behind it.
   */
  allowWhenModalOpen?: boolean;
}

/**
 * Listen for barcode scans anywhere on the page.
 *
 * `onScan` is kept in a ref so a consumer passing an inline arrow function
 * doesn't tear down and rebuild the listener on every render — which would
 * drop the in-progress buffer mid-scan.
 */
export function useBarcodeScan(
  onScan: (code: string) => void,
  { enabled = true, allowWhenModalOpen = false, ...captureOptions }: UseBarcodeScanOptions = {},
): void {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const { maxKeyIntervalMs, minLength, endTimeoutMs, terminators, now } = captureOptions;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    return createScanCapture(window, {
      onScan: (code) => onScanRef.current(code),
      isEnabled: allowWhenModalOpen ? undefined : () => !aModalIsOpen(),
      suppressWhenDisabled: allowWhenModalOpen ? undefined : targetsBehindAModal,
      maxKeyIntervalMs,
      minLength,
      endTimeoutMs,
      terminators,
      now,
    });
  }, [enabled, allowWhenModalOpen, maxKeyIntervalMs, minLength, endTimeoutMs, terminators, now]);
}
