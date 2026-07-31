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
  //
  // There is no `adminPin` here any more. It described a single shared
  // dashboard PIN that has no column in the schema and that the API has
  // never returned. The real lock is per staff member (`staff.pin_hash`,
  // set via POST /staff/pin) — see pin-lock.tsx.
  //
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
