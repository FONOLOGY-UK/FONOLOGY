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

/**
 * Change request item 2 — the details a repair request of a given type
 * cannot supply, which the "Send to Jobs" pop-up therefore has to ask for.
 *
 * A closed set, not free text: an admin who typed "pascode" would silently
 * disable the prompt forever. Which of these apply is configured PER REPAIR
 * TYPE, because it genuinely varies — a screen replacement needs a passcode
 * to test afterwards, a battery swap on a device that will not power on
 * cannot have one.
 */
export const jobConversionFieldSchema = z.enum([
  'quote',
  'passcode',
  'condition_on_arrival',
  'accessories_received',
  'imei',
  'data_backed_up',
]);
export type JobConversionField = z.infer<typeof jobConversionFieldSchema>;

/**
 * Which fields each repair type needs at intake, keyed by repair type id.
 *
 * Its own staff-only lookup rather than a field on RepairType, and that is
 * not tidiness: RepairType comes from GET /repair/types, which is the PUBLIC
 * endpoint the storefront's repair wizard reads. Putting the column in that
 * select took the customer-facing booking flow down on a database without
 * 0085 — found while verifying this item — and a customer has no business
 * knowing what the shop collects at the bench either way.
 */
export const repairConversionFieldsSchema = z.record(z.string(), z.array(jobConversionFieldSchema));
export type RepairConversionFields = z.infer<typeof repairConversionFieldsSchema>;

export function jobConversionFieldLabel(field: JobConversionField): string {
  switch (field) {
    case 'quote':
      return 'Quote agreed with the customer (£)';
    case 'passcode':
      return 'Device passcode';
    case 'condition_on_arrival':
      return 'Condition on arrival';
    case 'accessories_received':
      return 'Accessories received';
    case 'imei':
      return 'IMEI';
    case 'data_backed_up':
      return 'Data backed up?';
  }
}

export function jobConversionFieldHint(field: JobConversionField): string {
  switch (field) {
    case 'quote':
      return 'The price actually agreed, which may not be the one quoted online.';
    case 'passcode':
      return 'Without it most repairs cannot be tested afterwards.';
    case 'condition_on_arrival':
      return 'Marks, cracks, anything already broken. This is what settles “that scratch was already there”.';
    case 'accessories_received':
      return 'Case, charger, SIM tray — whatever has to go back with it.';
    case 'imei':
      return 'Staff-only. Never shown on the website.';
    case 'data_backed_up':
      return 'Asked and answered before anyone opens it.';
  }
}

export const repairTypeSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  desc: z.string(),
  /** Human estimate, e.g. "40–60 min" or "Free diagnosis". */
  time: z.string(),
  base: tierPricesSchema,
});
export type RepairType = z.infer<typeof repairTypeSchema>;

/**
 * The shop's own price for one repair on one device at one part tier — the
 * figure `/admin/repair-pricing` defines and, from change request item 6, the
 * floor a staff quote may not go below.
 *
 * A LINE-FOR-LINE PORT of `repair_quote_price()` (0006_repairs.sql:85), and it
 * has to stay one. The rounding is the part that matters: the SQL rounds to
 * whole POUNDS mid-calculation (`round(base/100 * multiplier) * 100`), not to
 * pence at the end. Round differently here and the number a staff member is
 * shown as "the shop price" is a penny off the number the server enforces the
 * floor against — the quote reads as exactly at the floor and is refused,
 * with nothing on screen to explain why.
 *
 * This is display and pre-validation only. The server never takes a floor
 * from the client; it recomputes its own from the selection. Two computations
 * of the same thing is a risk worth naming, and the alternative — round-trip
 * to the API on every tier change — costs a request per keystroke on a screen
 * staff use dozens of times a day.
 *
 * Null out for a diagnosis-only repair type (`base` is null when all three
 * prices are, per `repair_types_all_or_no_pricing`) — there is no price at
 * any tier, so there is no floor.
 */
export function repairQuoteFloor(
  base: TierPrices,
  tier: PartTierId,
  priceMultiplier: number,
): number | null {
  if (!base) return null;
  return Math.round((base[tier] / 100) * priceMultiplier) * 100;
}

/**
 * Admin CRUD shape (Round 5 #33) — same split as AdminDevice/Device above:
 * the public `repairTypeSchema` is what /repair actually needs (already
 * is_active filtered server-side); this adds the field the management
 * screen needs to show an inactive repair type instead of just omitting it.
 */
export const adminRepairTypeInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter a repair name'),
  desc: z.string(),
  time: z.string(),
  isActive: z.boolean(),
  base: tierPricesSchema,
});
export type AdminRepairTypeInput = z.infer<typeof adminRepairTypeInputSchema>;

export const adminRepairTypeSchema = adminRepairTypeInputSchema.extend({ id: idSchema });
export type AdminRepairType = z.infer<typeof adminRepairTypeSchema>;

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
