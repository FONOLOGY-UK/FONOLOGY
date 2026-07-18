import { z } from 'zod';
import { emailSchema, idSchema, isoDateSchema, ukPhoneSchema } from './common';
import { moneySchema } from './pricing';

/**
 * Repair booking domain — the four-step wizard: device -> problem -> part
 * grade -> time & details. Pricing is derived (device multiplier × part-tier
 * base) and is intentionally VAT-free (see pricing.ts / HARD RULE #3).
 */

export const deviceBrandSchema = z.enum(['apple', 'samsung', 'pixel', 'other']);
export type DeviceBrand = z.infer<typeof deviceBrandSchema>;

export const deviceSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  brand: deviceBrandSchema,
  /** Price multiplier applied to a repair's base tier price. */
  priceMultiplier: z.number().positive(),
});
export type Device = z.infer<typeof deviceSchema>;

export const partTierIdSchema = z.enum(['original', 'oem', 'copy']);
export type PartTierId = z.infer<typeof partTierIdSchema>;

/** Base tier prices for a repair, in pence. `null` = quote-on-diagnosis. */
export const tierPricesSchema = z
  .object({
    original: moneySchema,
    oem: moneySchema,
    copy: moneySchema,
  })
  .nullable();
export type TierPrices = z.infer<typeof tierPricesSchema>;

export const repairTypeSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  desc: z.string(),
  /** Human estimate, e.g. "40–60 min" or "Free diagnosis". */
  time: z.string(),
  base: tierPricesSchema,
});
export type RepairType = z.infer<typeof repairTypeSchema>;

export const partTierSchema = z.object({
  id: partTierIdSchema,
  name: z.string().min(1),
  strap: z.string(),
  line: z.string(),
  warranty: z.string(),
});
export type PartTier = z.infer<typeof partTierSchema>;

/** A computed quote for a device+repair+tier combination. */
export const repairQuoteSchema = z.object({
  deviceId: idSchema,
  repairId: idSchema,
  tierId: partTierIdSchema,
  /** null when the repair is quote-on-diagnosis (e.g. water damage). */
  price: moneySchema.nullable(),
  warranty: z.string(),
  estTime: z.string(),
});
export type RepairQuote = z.infer<typeof repairQuoteSchema>;

/** A bookable time slot for a given day. */
export const timeSlotSchema = z.object({
  time: z.string(), // "09:30"
  available: z.boolean(),
});
export type TimeSlot = z.infer<typeof timeSlotSchema>;

/** Payload the wizard submits to create a booking. */
export const bookingInputSchema = z.object({
  deviceId: idSchema,
  repairId: idSchema,
  tierId: partTierIdSchema.nullable(),
  name: z.string().trim().min(2, 'Please enter your name'),
  phone: ukPhoneSchema,
  email: emailSchema.optional().or(z.literal('')),
  date: isoDateSchema,
  slot: z.string().min(1, 'Pick a time slot'),
  notes: z.string().max(1000).optional(),
});
export type BookingInput = z.infer<typeof bookingInputSchema>;

export const bookingStatusSchema = z.enum([
  'received',
  'in-progress',
  'ready',
  'collected',
  'cancelled',
]);
export type BookingStatus = z.infer<typeof bookingStatusSchema>;

/** A confirmed booking as returned by the backend. */
export const bookingSchema = bookingInputSchema.extend({
  id: idSchema,
  reference: z.string(), // "FNL-1234"
  status: bookingStatusSchema,
  price: moneySchema.nullable(),
  createdAt: z.string(),
});
export type Booking = z.infer<typeof bookingSchema>;
