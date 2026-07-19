import type { Device, PartTierId, RepairType, Money } from './types';

/**
 * Pure repair-price formula — the SAME maths the mock adapter's `computeQuote`
 * uses (round(basePounds × deviceMultiplier)), extracted so the homepage quick-
 * quote widget can animate the price instantly from already-fetched device /
 * repair data (no per-keystroke round-trip). The backend owns real pricing;
 * this only mirrors the prototype's display maths. Returns null for
 * diagnosis-only repairs.
 */
export function computeRepairPrice(
  device: Device,
  repair: RepairType,
  tierId: PartTierId,
): Money | null {
  if (!repair.base) return null;
  const basePence = repair.base[tierId];
  return Math.round((basePence / 100) * device.priceMultiplier) * 100;
}
