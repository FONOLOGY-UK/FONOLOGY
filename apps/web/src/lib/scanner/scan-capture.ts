/**
 * Barcode scan capture — the Eyoyo EY-7130 (and any HID-keyboard scanner).
 *
 * The scanner is not a device we talk to. It is a keyboard: on a successful
 * read it "types" the barcode's characters extremely fast and then usually
 * sends a terminator (Enter by factory default, Tab or nothing if it has been
 * reprogrammed). So the whole of "scanning" is telling a machine-speed
 * keystroke burst apart from a human typing.
 *
 * This module is deliberately framework-agnostic — no React — so the timing
 * logic can be unit-tested by dispatching synthetic events, and so the till
 * and the inventory screens share one implementation instead of two that
 * drift. `use-barcode-scan.ts` is the thin React wrapper.
 *
 * THE ONE RULE THAT MATTERS: ordinary typing must never be eaten. We
 * therefore never call preventDefault on a character key — characters always
 * reach whatever is focused. The only key we ever suppress is the terminator,
 * and only once the burst has already qualified as a scan (so a scan into a
 * form doesn't also submit it). A scan while a search box is focused still
 * types into that box, which is exactly what "scan into a barcode field"
 * should do; the consumer clears it if it wants to.
 */

/**
 * Maximum gap between two keystrokes for them to belong to the same burst.
 *
 * Measured behaviour: HID scanners emit at roughly 5–15ms per character.
 * A fast human touch-typist sustains about 60–120ms, and even a burst of
 * muscle-memory keys rarely drops under 40ms. 35ms sits in the empty space
 * between the two populations — comfortably above scanner speed, comfortably
 * below human speed. Anything slower than this starts a fresh buffer, which
 * is why human typing can never accumulate into a scan: every keystroke
 * resets it to a single character, and a single character never qualifies.
 */
export const SCAN_MAX_KEY_INTERVAL_MS = 35;

/**
 * Shortest string we will treat as a barcode. EAN-8 is the shortest symbology
 * the shop realistically handles; 4 keeps room for short internal codes while
 * still rejecting an accidental two- or three-character fast keypress.
 */
export const SCAN_MIN_LENGTH = 4;

/**
 * How long to wait after the last character before deciding a terminator-less
 * scan has ended. Only used as a fallback — a scanner set to send nothing at
 * all still works, at the cost of this much latency. Must be comfortably
 * above SCAN_MAX_KEY_INTERVAL_MS so it never fires mid-burst.
 */
export const SCAN_END_TIMEOUT_MS = 80;

/** Keys a scanner may be programmed to send at the end of a read. */
export const DEFAULT_SCAN_TERMINATORS = ['Enter', 'Tab'] as const;

export interface ScanCaptureOptions {
  /** Called with the decoded barcode once a burst qualifies as a scan. */
  onScan: (code: string) => void;
  /**
   * Consulted on every keystroke. Return false to ignore input entirely —
   * used to stand down while a dialog or the PIN lock is up.
   */
  isEnabled?: () => boolean;
  /**
   * Consulted only when `isEnabled` said no. Return true to also stop the
   * keystroke reaching whatever is focused.
   *
   * Standing down is not the same as being harmless. Verified on the real
   * till: the "count the float" dialog opens over the POS while focus stays
   * on the search box behind it, so a scan arriving then still typed into
   * that box and its Enter added the highlighted search result to a ticket
   * nobody could see. Ignoring the burst is not enough — the keystrokes have
   * to be stopped from acting on the screen behind the modal.
   */
  suppressWhenDisabled?: (event: KeyboardEvent) => boolean;
  maxKeyIntervalMs?: number;
  minLength?: number;
  /** 0 disables the timeout fallback (terminator-only mode). */
  endTimeoutMs?: number;
  terminators?: readonly string[];
  /** Injectable clock — tests drive this instead of waiting in real time. */
  now?: () => number;
}

/**
 * Attach scan capture to a target (normally `window`). Returns the detach
 * function — call it on unmount.
 */
export function createScanCapture(
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
  options: ScanCaptureOptions,
): () => void {
  const {
    onScan,
    isEnabled,
    suppressWhenDisabled,
    maxKeyIntervalMs = SCAN_MAX_KEY_INTERVAL_MS,
    minLength = SCAN_MIN_LENGTH,
    endTimeoutMs = SCAN_END_TIMEOUT_MS,
    terminators = DEFAULT_SCAN_TERMINATORS,
    now = () => performance.now(),
  } = options;

  let buffer = '';
  let lastKeyAt = 0;
  let endTimer: ReturnType<typeof setTimeout> | null = null;

  const clearEndTimer = () => {
    if (endTimer !== null) {
      clearTimeout(endTimer);
      endTimer = null;
    }
  };

  const reset = () => {
    buffer = '';
    clearEndTimer();
  };

  /** A burst is a scan if it is long enough. Length is sufficient on its own:
   *  the buffer is reset on every slow gap, so anything that survived to this
   *  length did so at machine speed by construction. */
  const qualifies = () => buffer.length >= minLength;

  const emit = () => {
    const code = buffer;
    reset();
    onScan(code);
  };

  const onKeyDown = (event: Event) => {
    const e = event as KeyboardEvent;

    if (isEnabled && !isEnabled()) {
      reset();
      if (suppressWhenDisabled?.(e)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
      return;
    }

    // A scanner never holds a modifier (Shift aside, for uppercase symbologies).
    // Anything chorded is a human using a shortcut — never part of a scan.
    if (e.ctrlKey || e.metaKey || e.altKey) {
      reset();
      return;
    }

    if (terminators.includes(e.key)) {
      if (qualifies()) {
        // Suppress ONLY here: a qualified scan's Enter must not also submit
        // the surrounding form or trigger a focused input's own Enter
        // handler, and its Tab must not move focus.
        //
        // stopImmediatePropagation matters as much as preventDefault. The
        // till's search box binds its own Enter ("add the highlighted
        // result"), so a scan terminating while that box has focus would
        // otherwise add whatever the burst happened to filter to, instead of
        // the product the barcode actually identifies. We listen in the
        // CAPTURE phase precisely so we get to make that call first.
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        emit();
      } else {
        // Not a scan — let the key do its ordinary job untouched.
        reset();
      }
      return;
    }

    // Shift arrives as its own keydown before the character it modifies.
    // Ignore it without disturbing the buffer or the timing.
    if (e.key === 'Shift') return;

    // Any other non-printable key (arrows, Escape, Backspace, F-keys) is a
    // human editing something. Never part of a barcode.
    if (e.key.length !== 1) {
      reset();
      return;
    }

    const at = now();
    // Gap too large: this character starts a new burst rather than extending
    // the old one. This is the whole defence against human typing.
    if (buffer !== '' && at - lastKeyAt > maxKeyIntervalMs) buffer = '';
    buffer += e.key;
    lastKeyAt = at;

    // Deliberately NOT preventDefault — the character reaches whatever is
    // focused, so typing is never swallowed.

    clearEndTimer();
    if (endTimeoutMs > 0) {
      endTimer = setTimeout(() => {
        endTimer = null;
        if (qualifies()) emit();
        else reset();
      }, endTimeoutMs);
    }
  };

  // Capture phase, not bubble: we must decide whether a terminator belongs to
  // a scan before any focused element's own handler sees it.
  target.addEventListener('keydown', onKeyDown, true);
  return () => {
    clearEndTimer();
    target.removeEventListener('keydown', onKeyDown, true);
  };
}
