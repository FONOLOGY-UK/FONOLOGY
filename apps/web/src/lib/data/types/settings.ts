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
  /** 4-digit dashboard lock PIN (mock — see note above). */
  adminPin: z.string().regex(/^\d{4}$/, 'PIN is 4 digits'),
  /** Suggested opening float, pence — pre-filled in the morning prompt. */
  floatTarget: moneySchema,
});
export type ShopSettings = z.infer<typeof shopSettingsSchema>;

export type ShopSettingsPatch = Partial<ShopSettings>;
