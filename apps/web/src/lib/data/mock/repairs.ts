import type { Device, PartTier, RepairType } from '../types';
import { pounds } from '../types';

/**
 * Repair booking fixtures — from the approved prototype (js/data.js).
 * Base tier prices converted to pence. Device multipliers unchanged, so the
 * derived quotes match the prototype's displayed numbers exactly.
 */
export const MOCK_DEVICES: Device[] = [
  { id: 'ip15p', name: 'iPhone 15 Pro', brand: 'apple', priceMultiplier: 1.5 },
  { id: 'ip15', name: 'iPhone 15', brand: 'apple', priceMultiplier: 1.3 },
  { id: 'ip14', name: 'iPhone 14', brand: 'apple', priceMultiplier: 1.15 },
  { id: 'ip13', name: 'iPhone 13', brand: 'apple', priceMultiplier: 1.0 },
  { id: 'ip12', name: 'iPhone 12', brand: 'apple', priceMultiplier: 0.85 },
  { id: 'ipse', name: 'iPhone SE', brand: 'apple', priceMultiplier: 0.7 },
  { id: 's24', name: 'Galaxy S24', brand: 'samsung', priceMultiplier: 1.35 },
  { id: 's23', name: 'Galaxy S23', brand: 'samsung', priceMultiplier: 1.15 },
  { id: 'a54', name: 'Galaxy A54', brand: 'samsung', priceMultiplier: 0.8 },
  { id: 'px8', name: 'Pixel 8', brand: 'pixel', priceMultiplier: 1.1 },
  { id: 'px7', name: 'Pixel 7', brand: 'pixel', priceMultiplier: 0.95 },
  { id: 'other', name: 'Something else', brand: 'other', priceMultiplier: 1.0 },
];

export const MOCK_REPAIR_TYPES: RepairType[] = [
  {
    id: 'screen',
    name: 'Screen replacement',
    desc: 'Cracked glass, dead pixels, ghost touch',
    time: '40–60 min',
    base: { original: pounds(140), oem: pounds(105), copy: pounds(72) },
  },
  {
    id: 'battery',
    name: 'Battery replacement',
    desc: 'Drains fast, dies at 30%, feels warm',
    time: '30–45 min',
    base: { original: pounds(72), oem: pounds(56), copy: pounds(42) },
  },
  {
    id: 'port',
    name: 'Charging port',
    desc: 'Loose cable, charges only at an angle',
    time: '45–60 min',
    base: { original: pounds(64), oem: pounds(52), copy: pounds(40) },
  },
  {
    id: 'other',
    name: 'Something else',
    desc: 'Water damage, camera, speaker, mystery fault',
    time: 'Free diagnosis',
    base: null,
  },
];

export const MOCK_PART_TIERS: PartTier[] = [
  {
    id: 'original',
    name: 'Original',
    strap: 'Pulled or service-pack parts from the manufacturer.',
    line: 'Identical to factory. True Tone, colours and brightness exactly as shipped.',
    warranty: '12-month warranty',
  },
  {
    id: 'oem',
    name: 'OEM',
    strap: 'Built by the same factories, sold without the logo.',
    line: 'Our most-fitted grade. 95% of the flagship experience at a fair price.',
    warranty: '6-month warranty',
  },
  {
    id: 'copy',
    name: 'Copy',
    strap: 'Quality-checked aftermarket. Honest budget option.',
    line: 'Great for older phones and resales. We’ll tell you straight when it isn’t.',
    warranty: '90-day warranty',
  },
];

/** Bookable slot times (prototype parity). */
export const MOCK_TIME_SLOTS = ['09:30', '11:00', '12:30', '14:00', '15:30', '17:00'] as const;
