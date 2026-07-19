import type { Device, Money, SellCondition } from './types';

/**
 * INDICATIVE trade-in estimate (6.5) — a rough, mock figure so the value card
 * has something to show; the real number is confirmed after inspection and the
 * grading model is pending client confirmation (see NOTES.md). Returns null
 * until enough condition is known to estimate anything.
 */
export function computeSellEstimate(
  device: Device,
  condition: Partial<SellCondition>,
): Money | null {
  if (!condition.screen || !condition.body || condition.powersOn === undefined) return null;

  // Indicative flagship baseline scaled by the device's value proxy.
  const basePounds = 200 * device.priceMultiplier;
  const screenMod = { flawless: 1, good: 0.78, cracked: 0.4 }[condition.screen];
  const bodyMod = { flawless: 1, good: 0.9, worn: 0.78 }[condition.body];
  const powerMod = condition.powersOn ? 1 : 0.35;
  const networkMod = condition.network === 'locked' ? 0.85 : 1;

  const pounds = Math.max(5, Math.round(basePounds * screenMod * bodyMod * powerMod * networkMod));
  return pounds * 100;
}
