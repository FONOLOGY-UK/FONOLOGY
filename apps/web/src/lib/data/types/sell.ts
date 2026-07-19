import { z } from 'zod';
import { emailSchema, idSchema, ukPhoneSchema } from './common';
import { moneySchema } from './pricing';
import { contactMethodSchema } from './repair';

/**
 * Sell / trade-in domain (6.5) — NEW. Mirrors the repair flow: device →
 * condition → contact → submit. There is NO fixed price; the value card shows
 * an INDICATIVE estimate (or a "we'll quote you" state) and Fonology confirms
 * after inspection.
 *
 * The exact condition-grading field list is PENDING CLIENT CONFIRMATION — this
 * structure follows trade-in platforms (Mazuma / iDoctor). See NOTES.md.
 */

export const screenConditionSchema = z.enum(['flawless', 'good', 'cracked']);
export const bodyConditionSchema = z.enum(['flawless', 'good', 'worn']);
export const networkStatusSchema = z.enum(['unlocked', 'locked']);
export type ScreenCondition = z.infer<typeof screenConditionSchema>;
export type BodyCondition = z.infer<typeof bodyConditionSchema>;
export type NetworkStatus = z.infer<typeof networkStatusSchema>;

export const sellConditionSchema = z.object({
  storage: z.string().min(1, 'Pick a storage size'),
  screen: screenConditionSchema,
  body: bodyConditionSchema,
  powersOn: z.boolean(),
  network: networkStatusSchema,
  /** Box, charger, cable, etc. */
  accessories: z.array(z.string()),
});
export type SellCondition = z.infer<typeof sellConditionSchema>;

export const sellRequestInputSchema = z.object({
  deviceId: idSchema,
  /** Free-text model when device is "Something else". */
  deviceOther: z.string().optional(),
  condition: sellConditionSchema,
  name: z.string().trim().min(2, 'Please enter your name'),
  phone: ukPhoneSchema,
  email: emailSchema,
  preferredContact: contactMethodSchema,
  notes: z.string().max(1000).optional(),
});
export type SellRequestInput = z.infer<typeof sellRequestInputSchema>;

export const sellStatusSchema = z.enum(['received', 'quoted', 'accepted', 'paid', 'declined']);
export type SellStatus = z.infer<typeof sellStatusSchema>;

export const sellRequestSchema = sellRequestInputSchema.extend({
  id: idSchema,
  reference: z.string(), // "FNL-3xxx"
  status: sellStatusSchema,
  /** Indicative estimate captured at submission, in pence (or null). */
  estimate: moneySchema.nullable(),
  createdAt: z.string(),
});
export type SellRequest = z.infer<typeof sellRequestSchema>;
