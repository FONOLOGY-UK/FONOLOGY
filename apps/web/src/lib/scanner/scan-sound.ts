'use client';

/**
 * A short tone on scan, synthesised rather than loaded from an asset (no file
 * to ship, no network request at the counter).
 *
 * The shop floor is noisy and staff are looking at the customer, not the
 * screen — a failed scan that only fails visually will be missed, and the
 * expensive mistake is believing something scanned when it didn't. Failure
 * therefore gets a distinctly lower, longer, harder-to-ignore tone.
 *
 * Every call is wrapped: audio is a nicety, and a browser that refuses to
 * make noise must never break the sale. Autoplay policy is satisfied because
 * a scan is keyboard input, which counts as user activation.
 */

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context ??= new Ctor();
    return context;
  } catch {
    return null;
  }
}

function tone(frequency: number, durationMs: number, gain: number): void {
  const ctx = audioContext();
  if (!ctx) return;
  try {
    // Suspended contexts are common when the tab has been idle.
    if (ctx.state === 'suspended') void ctx.resume();
    const oscillator = ctx.createOscillator();
    const amp = ctx.createGain();
    oscillator.type = 'square';
    oscillator.frequency.value = frequency;
    amp.gain.value = gain;
    // Fade out rather than stopping abruptly — a hard stop clicks.
    amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);
    oscillator.connect(amp).connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + durationMs / 1000);
  } catch {
    /* Sound is optional. Never let it surface as an error at the till. */
  }
}

/** Crisp, high, short — "that went on the ticket". */
export function scanOkSound(): void {
  tone(1650, 90, 0.05);
}

/** Low and longer, deliberately unlike the success tone. */
export function scanFailSound(): void {
  tone(220, 280, 0.08);
}
