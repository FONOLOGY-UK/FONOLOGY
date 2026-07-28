import { z } from 'zod';
import { moneySchema } from './pricing';

/**
 * Shop settings (item 7, Settings module). Small and flat on purpose — every
 * field here is something the owner actually tunes. The PIN is the dashboard
 * SCREEN LOCK (overlay), not authentication — logins are item 9 / Raja's
 * backend, and the mock PIN lives here only so the lock is demonstrable.
 */

export const shopSettingsSchema = z.object({
  /** Returns accepted within this many days of purchase (default 30). */
  returnWindowDays: z.number().int().min(0),
  /**
   * Low-stock alerting is now PER PRODUCT (see StockMeta.lowStockAlert /
   * lowStockThreshold) — there is intentionally no global threshold here.
   */
  /** Idle minutes before the dashboard locks itself. */
  idleLockMinutes: z.number().int().min(1),
  /**
   * 4-digit dashboard lock PIN (mock only — see note above). Real dev
   * results never populate this: the schema has no column for a single
   * shared PIN at all. The real lock is per-staff (staff.pin_hash), proven
   * in B1 (POST /staff/pin, /staff/session/lock|unlock) — see the B6
   * report. Optional so a real API response validates without it.
   */
  adminPin: z
    .string()
    .regex(/^\d{4}$/, 'PIN is 4 digits')
    .optional(),
  /** Suggested opening float, pence — pre-filled in the morning prompt. */
  floatTarget: moneySchema,

  /**
   * Additive over the original mock shape — every field below is a real
   * shop_settings column the owner can tune (B6). See the B6 report.
   */
  shopName: z.string().optional(),
  shopAddress: z.string().nullable().optional(),
  shopPhone: z.string().nullable().optional(),
  shopEmail: z.string().nullable().optional(),
  openingHours: z.array(z.record(z.string(), z.unknown())).optional(),
  socialLinks: z.record(z.string(), z.unknown()).optional(),
  nextDayCutoffTime: z.string().optional(),
  belowCostPromptsForReason: z.boolean().optional(),
  idDocumentRetentionDays: z.number().int().positive().optional(),
  receiptHeaderText: z.string().nullable().optional(),
  receiptFooterText: z.string().nullable().optional(),
  customerEmailTemplates: z.record(z.string(), z.unknown()).optional(),
});
export type ShopSettings = z.infer<typeof shopSettingsSchema>;

export type ShopSettingsPatch = Partial<ShopSettings>;
