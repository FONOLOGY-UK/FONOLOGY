import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createScanCapture,
  SCAN_END_TIMEOUT_MS,
  SCAN_MAX_KEY_INTERVAL_MS,
  SCAN_MIN_LENGTH,
} from './scan-capture';

/**
 * The clock is injected rather than real: these tests assert on the boundary
 * between scanner speed and human speed, and a test that depended on the
 * machine actually being fast enough would be flaky on a loaded CI box.
 */
let clock = 0;
const now = () => clock;

/** Type a string, advancing the injected clock by `gapMs` between characters. */
function type(
  target: EventTarget,
  text: string,
  gapMs: number,
  options: { terminator?: string | null; from?: EventTarget } = {},
) {
  const { terminator = 'Enter', from } = options;
  for (const char of text) {
    clock += gapMs;
    const event = new KeyboardEvent('keydown', {
      key: char,
      bubbles: true,
      cancelable: true,
    });
    (from ?? target).dispatchEvent(event);
  }
  if (terminator) {
    clock += gapMs;
    const event = new KeyboardEvent('keydown', {
      key: terminator,
      bubbles: true,
      cancelable: true,
    });
    (from ?? target).dispatchEvent(event);
  }
}

const SCANNER_GAP = 8; // well under SCAN_MAX_KEY_INTERVAL_MS
const HUMAN_GAP = 90; // a brisk typist, still well over the threshold

describe('createScanCapture', () => {
  let detach: () => void;
  let onScan: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clock = 0;
    onScan = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    detach?.();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('detects a barcode typed at scanner speed', () => {
    detach = createScanCapture(window, { onScan, now });
    type(window, '5012345678900', SCANNER_GAP);
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('5012345678900');
  });

  it('ignores the same characters typed at human speed', () => {
    detach = createScanCapture(window, { onScan, now });
    type(window, '5012345678900', HUMAN_GAP);
    expect(onScan).not.toHaveBeenCalled();
  });

  it('ignores a fast burst shorter than the minimum barcode length', () => {
    detach = createScanCapture(window, { onScan, now });
    type(window, '12', SCANNER_GAP);
    expect(onScan).not.toHaveBeenCalled();
    expect('12'.length).toBeLessThan(SCAN_MIN_LENGTH);
  });

  it('accepts Tab as a terminator', () => {
    detach = createScanCapture(window, { onScan, now });
    type(window, '5012345678900', SCANNER_GAP, { terminator: 'Tab' });
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('5012345678900');
  });

  it('ends a terminator-less scan on the timeout fallback', () => {
    detach = createScanCapture(window, { onScan, now });
    type(window, '5012345678900', SCANNER_GAP, { terminator: null });
    expect(onScan).not.toHaveBeenCalled(); // nothing yet — still waiting
    vi.advanceTimersByTime(SCAN_END_TIMEOUT_MS + 1);
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('5012345678900');
  });

  it('keeps two rapid consecutive scans separate', () => {
    detach = createScanCapture(window, { onScan, now });
    type(window, '5012345678900', SCANNER_GAP);
    type(window, '5000112233445', SCANNER_GAP);
    expect(onScan).toHaveBeenCalledTimes(2);
    expect(onScan).toHaveBeenNthCalledWith(1, '5012345678900');
    expect(onScan).toHaveBeenNthCalledWith(2, '5000112233445');
  });

  it('suppresses the terminator only for a real scan, so forms still submit on Enter', () => {
    detach = createScanCapture(window, { onScan, now });

    const scanEnter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    type(window, '5012345678900', SCANNER_GAP, { terminator: null });
    window.dispatchEvent(scanEnter);
    expect(scanEnter.defaultPrevented).toBe(true);

    // A bare Enter with no burst behind it must pass through untouched.
    const plainEnter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    window.dispatchEvent(plainEnter);
    expect(plainEnter.defaultPrevented).toBe(false);
  });

  it('never swallows ordinary typing into an input', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();

    detach = createScanCapture(window, { onScan, now });

    const prevented: boolean[] = [];
    for (const char of 'hello') {
      clock += HUMAN_GAP;
      const event = new KeyboardEvent('keydown', { key: char, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      prevented.push(event.defaultPrevented);
    }

    expect(prevented).toEqual([false, false, false, false, false]);
    expect(onScan).not.toHaveBeenCalled();
  });

  it('still recognises a scan typed into a focused input (dedicated barcode field)', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();

    detach = createScanCapture(window, { onScan, now });
    type(window, '5012345678900', SCANNER_GAP, { from: input });

    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('5012345678900');
  });

  it('does not swallow the characters of a scan — they still reach the field', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();

    detach = createScanCapture(window, { onScan, now });

    const prevented: boolean[] = [];
    for (const char of '5012345678900') {
      clock += SCANNER_GAP;
      const event = new KeyboardEvent('keydown', { key: char, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      prevented.push(event.defaultPrevented);
    }

    // Only the terminator is ever suppressed; every character passes through.
    expect(prevented.every((p) => p === false)).toBe(true);
  });

  it('stands down when isEnabled returns false (dialog / PIN lock open)', () => {
    let enabled = false;
    detach = createScanCapture(window, { onScan, now, isEnabled: () => enabled });

    type(window, '5012345678900', SCANNER_GAP);
    expect(onScan).not.toHaveBeenCalled();

    enabled = true;
    type(window, '5012345678900', SCANNER_GAP);
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('5012345678900');
  });

  it('can swallow keystrokes aimed behind a modal while disabled', () => {
    // Reproduces the real till bug: the float dialog opens over the POS with
    // focus left on the search box behind it, so a scan arriving then would
    // otherwise type into that box and add the highlighted result on Enter.
    const behind = document.createElement('input');
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    const inModal = document.createElement('input');
    modal.append(inModal);
    document.body.append(behind, modal);

    detach = createScanCapture(window, {
      onScan,
      now,
      isEnabled: () => false,
      suppressWhenDisabled: (event) => !modal.contains(event.target as Node),
    });

    const behindEvent = new KeyboardEvent('keydown', {
      key: '5',
      bubbles: true,
      cancelable: true,
    });
    behind.dispatchEvent(behindEvent);
    expect(behindEvent.defaultPrevented).toBe(true);

    // Typing into the dialog itself must still work perfectly normally.
    const modalEvent = new KeyboardEvent('keydown', {
      key: '5',
      bubbles: true,
      cancelable: true,
    });
    inModal.dispatchEvent(modalEvent);
    expect(modalEvent.defaultPrevented).toBe(false);

    expect(onScan).not.toHaveBeenCalled();
  });

  it('abandons a burst interrupted by an editing key', () => {
    detach = createScanCapture(window, { onScan, now });

    type(window, '50123', SCANNER_GAP, { terminator: null });
    clock += SCANNER_GAP;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
    type(window, '45', SCANNER_GAP);

    expect(onScan).not.toHaveBeenCalled();
  });

  it('ignores chorded keystrokes (a human using a shortcut)', () => {
    detach = createScanCapture(window, { onScan, now });

    for (const char of '5012345678900') {
      clock += SCANNER_GAP;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: char, ctrlKey: true }));
    }
    clock += SCANNER_GAP;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(onScan).not.toHaveBeenCalled();
  });

  it('detaches cleanly', () => {
    detach = createScanCapture(window, { onScan, now });
    detach();
    type(window, '5012345678900', SCANNER_GAP);
    expect(onScan).not.toHaveBeenCalled();
  });

  it('treats the documented threshold as the scanner/human boundary', () => {
    detach = createScanCapture(window, { onScan, now });

    // Just inside the threshold: still one burst.
    type(window, '5012345678900', SCAN_MAX_KEY_INTERVAL_MS - 1);
    expect(onScan).toHaveBeenCalledTimes(1);

    onScan.mockClear();

    // Just outside it: every character starts a new buffer, so nothing ever
    // reaches the minimum length.
    type(window, '5012345678900', SCAN_MAX_KEY_INTERVAL_MS + 1);
    expect(onScan).not.toHaveBeenCalled();
  });
});
