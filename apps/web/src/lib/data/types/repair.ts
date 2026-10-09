import { z } from 'zod';
import { emailSchema, idSchema, ukPhoneSchema, ukPostcodeSchema } from './common';
import { moneySchema } from './pricing';

/**
 * Repair domain — the four-step flow: device -> problem -> grade (sub-type) -> YOUR
 * DETAILS. Prices are typed per device (0109, tester change C-3), VAT-free (HARD RULE #3); a
 * repair or grade with no price on a device is not offered for it.
 *
 * IMPORTANT (6.4): repairs are MAIL-IN. There is NO appointment booking — no
 * date, no time slot, no appointment number. Step 4 captures mail-in contact
 * details; on submit a shipping label is sent via the preferred contact method.
 * Approved by Tanoli, pending client sign-off.
 */

export const deviceBrandSchema = z.enum(['apple', 'samsung', 'pixel', 'other']);
export type DeviceBrand = z.infer<typeof deviceBrandSchema>;

export const deviceSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  brand: deviceBrandSchema,
});
export type Device = z.infer<typeof deviceSchema>;

/**
 * One price on a device's price list (0109, tester change C-3): a repair at one sub-type, or a
 * Diagnosis-only repair's flat price (`subTypeId` null). A repair or sub-type with no entry is
 * NOT OFFERED on that device. 0 is a real, free price.
 */
export const devicePriceSchema = z.object({
  repairTypeId: idSchema,
  subTypeId: idSchema.nullable(),
  price: moneySchema,
});
export type DevicePrice = z.infer<typeof devicePriceSchema>;

/**
 * Admin CRUD shape. A device's prices are typed in by hand (the old multiplier is gone); they are
 * read separately (`getDevicePrices`) and saved with the device.
 */
export const adminDeviceInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter a device name'),
  brand: deviceBrandSchema,
  isActive: z.boolean(),
  /** Present = replaces the device's whole price list. */
  prices: z.array(devicePriceSchema).optional(),
});
export type AdminDeviceInput = z.infer<typeof adminDeviceInputSchema>;

export const adminDeviceSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  brand: deviceBrandSchema,
  isActive: z.boolean(),
});
export type AdminDevice = z.infer<typeof adminDeviceSchema>;

/** A grade a repair comes in (0109): Original, OEM, Copy, or a custom one. */
export const repairSubTypeSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  strap: z.string(),
  warranty: z.string(),
});
export type RepairSubType = z.infer<typeof repairSubTypeSchema>;

export const adminRepairSubTypeSchema = repairSubTypeSchema.extend({ sortOrder: z.number().int() });
export type AdminRepairSubType = z.infer<typeof adminRepairSubTypeSchema>;

export interface RepairSubTypeInput {
  name: string;
  strap?: string;
  warranty?: string;
  sortOrder?: number;
}

/** What one device can be repaired for, and at what price — only what it offers. */
export const repairOfferSchema = z.object({
  repairId: idSchema,
  /** Null for a Diagnosis-only repair's flat price. */
  subTypeId: idSchema.nullable(),
  price: moneySchema,
});
export type RepairOffer = z.infer<typeof repairOfferSchema>;

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
 * 0088 — found while verifying this item — and a customer has no business
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

/**
 * A repair type — a definition only since 0109 (tester change C-3): no price on it. Prices are
 * typed per device (Device Models). A Diagnosis-only repair has no sub-types and one flat price per
 * device.
 */
export const repairTypeSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  desc: z.string(),
  /** Human estimate, e.g. "40–60 min". */
  time: z.string(),
  diagnosisOnly: z.boolean(),
});
export type RepairType = z.infer<typeof repairTypeSchema>;

/** Admin CRUD shape: the definition, plus which sub-types it comes in. */
export const adminRepairTypeInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter a repair name'),
  desc: z.string(),
  time: z.string(),
  isActive: z.boolean(),
  diagnosisOnly: z.boolean(),
  /** Ignored (and empty) for a Diagnosis-only repair. */
  subTypeIds: z.array(idSchema),
});
export type AdminRepairTypeInput = z.infer<typeof adminRepairTypeInputSchema>;

export const adminRepairTypeSchema = adminRepairTypeInputSchema.extend({ id: idSchema });
export type AdminRepairType = z.infer<typeof adminRepairTypeSchema>;

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
  /** The sub-type chosen — null for a Diagnosis-only repair. The server prices it. */
  subTypeId: idSchema.nullable(),
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
  reference: z.string(), // "F01-REQ-061026001"
  status: bookingStatusSchema,
  price: moneySchema.nullable(),
  /** The sub-type chosen, by name — kept even after that sub-type is deleted (0109). */
  subTypeName: z.string().nullable().optional(),
  // The API returns `null` (not omitted) when no notes were given — accept
  // both, since bookingInputSchema's `notes` is write-side-only optional.
  notes: z.string().max(1000).nullable().optional(),
  createdAt: z.string(),
});
export type Booking = z.infer<typeof bookingSchema>;
