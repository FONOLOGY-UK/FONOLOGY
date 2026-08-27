import { z } from 'zod';
import { emailSchema, idSchema, ukPhoneSchema, ukPostcodeSchema } from './common';
import { moneySchema } from './pricing';

/**
 * Repair domain — the four-step flow: device -> problem -> part grade -> YOUR
 * DETAILS. Pricing is derived (device multiplier × part-tier base), VAT-free
 * (HARD RULE #3).
 *
 * IMPORTANT (6.4): repairs are MAIL-IN. There is NO appointment booking — no
 * date, no time slot, no appointment number. Step 4 captures mail-in contact
 * details; on submit a shipping label is sent via the preferred contact method.
 * Approved by Tanoli, pending client sign-off (see NOTES.md).
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

/**
 * Admin CRUD shape (Round 4 #FEAT-01) — same split as AdminReview/Review:
 * the public `deviceSchema` above is what Repair/Sell-In actually need
 * (and all a public GET ever returns, is_active filtered server-side
 * already); this adds the one field the management screen needs to show
 * an inactive device instead of just omitting it.
 */
export const adminDeviceInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter a device name'),
  brand: deviceBrandSchema,
  priceMultiplier: z.number().positive('Must be greater than 0'),
  isActive: z.boolean(),
});
export type AdminDeviceInput = z.infer<typeof adminDeviceInputSchema>;

export const adminDeviceSchema = adminDeviceInputSchema.extend({ id: idSchema });
export type AdminDevice = z.infer<typeof adminDeviceSchema>;

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

/** How the customer wants us to reach them (mail-in, no scheduling). */
export const contactMethodSchema = z.enum(['phone', 'email']);
export type ContactMethod = z.infer<typeof contactMethodSchema>;

/**
 * Payload the repair flow submits (MAIL-IN — no date/slot). Name, phone and
 * email are mandatory; address + postcode are where we post the label / return
 * the device.
 */
export const bookingInputSchema = z.object({
  deviceId: idSchema,
  repairId: idSchema,
  tierId: partTierIdSchema.nullable(),
  name: z.string().trim().min(2, 'Please enter your name'),
  phone: ukPhoneSchema,
  email: emailSchema,
  address: z.string().trim().min(4, 'Please enter your address'),
  postcode: ukPostcodeSchema,
  preferredContact: contactMethodSchema,
  notes: z.string().max(1000).optional(),
});
export type BookingInput = z.infer<typeof bookingInputSchema>;

/** Mail-in repair lifecycle (no "collected" — devices are posted back). */
export const bookingStatusSchema = z.enum([
  'received',
  'in-progress',
  'ready',
  'dispatched',
  'cancelled',
]);
export type BookingStatus = z.infer<typeof bookingStatusSchema>;

/** A confirmed booking as returned by the backend. */
export const bookingSchema = bookingInputSchema.extend({
  id: idSchema,
  reference: z.string(), // "FNL-1234"
  status: bookingStatusSchema,
  price: moneySchema.nullable(),
  // The API returns `null` (not omitted) when no notes were given — accept
  // both, since bookingInputSchema's `notes` is write-side-only optional.
  notes: z.string().max(1000).nullable().optional(),
  createdAt: z.string(),
});
export type Booking = z.infer<typeof bookingSchema>;
