import { attempt, db } from '../../lib/db.js';
import type { Updateable } from 'kysely';
import type { ShopSettings, Shops } from '../../db/types.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { settingsPatchBodySchema } from '../../schemas.js';
import { createRouter } from '../../lib/router.js';
import { hubShopId, readShop, writeShop } from '../../lib/shopScope.js';

export const adminSettingsRouter = createRouter();
const router = adminSettingsRouter;

/* ---------------------------------------------------------------------- */
/* Settings — site-wide values from shop_settings, per-shop values from shops */
/* ---------------------------------------------------------------------- */

function toApiSettings(row: Record<string, unknown>) {
  return {
    returnWindowDays: row.return_window_days,
    idleLockMinutes: row.idle_lock_minutes,
    floatTarget: row.float_target,
    shopName: row.shop_name,
    shopAddress: row.shop_address,
    shopPhone: row.shop_phone,
    shopEmail: row.shop_email,
    openingHours: row.opening_hours,
    socialLinks: row.social_links,
    nextDayCutoffTime: row.next_day_cutoff_time,
    belowCostPromptsForReason: row.below_cost_prompts_for_reason,
    idDocumentRetentionDays: row.id_document_retention_days,
    receiptHeaderText: row.receipt_header_text,
    receiptFooterText: row.receipt_footer_text,
    // Item 5. Null is meaningful and is passed through as null — it is what
    // "no limit on this machine for this period" looks like.
    card1DailyLimit: row.card1_daily_limit ?? null,
    card1WeeklyLimit: row.card1_weekly_limit ?? null,
    card1MonthlyLimit: row.card1_monthly_limit ?? null,
    card2DailyLimit: row.card2_daily_limit ?? null,
    card2WeeklyLimit: row.card2_weekly_limit ?? null,
    card2MonthlyLimit: row.card2_monthly_limit ?? null,
    customerEmailTemplates: row.customer_email_templates,
    // adminPin is deliberately absent — no column; the real dashboard lock
    // is per-staff (staff.pin_hash).
  };
}

/**
 * The settings screen shows one shop at a time: the site-wide row with that shop's own
 * address, hours, receipt text, float and card limits laid over it. `shopId` is the shop the
 * caller is looking at (their own, or the one an owner/manager picked with ?shop=).
 */
async function settingsFor(shopId: string) {
  const [settings, shop] = await Promise.all([
    db.selectFrom('shop_settings').selectAll().executeTakeFirstOrThrow(),
    db.selectFrom('shops').selectAll().where('id', '=', shopId).executeTakeFirstOrThrow(),
  ]);
  return toApiSettings({
    ...settings,
    shop_address: shop.address,
    shop_phone: shop.phone,
    shop_email: shop.email,
    opening_hours: shop.opening_hours,
    receipt_header_text: shop.receipt_header_text,
    receipt_footer_text: shop.receipt_footer_text,
    float_target: shop.float_target,
    card1_daily_limit: shop.card1_daily_limit,
    card1_weekly_limit: shop.card1_weekly_limit,
    card1_monthly_limit: shop.card1_monthly_limit,
    card2_daily_limit: shop.card2_daily_limit,
    card2_weekly_limit: shop.card2_weekly_limit,
    card2_monthly_limit: shop.card2_monthly_limit,
  });
}

router.get('/settings', requireStaff, requirePermission('settings.manage'), async (req, res) => {
  return res.json(await settingsFor(readShop(req) ?? req.user!.shopId ?? (await hubShopId())));
});

router.patch('/settings', requireStaff, requirePermission('settings.manage'), async (req, res) => {
  const parsed = settingsPatchBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  // jsonb columns (opening hours, social links, email templates) are sent
  // as JSON text: node-postgres would turn a JS array into a Postgres
  // array literal, which jsonb rejects.
  //
  // Two homes: the values every shop shares (brand, return window, retention,
  // email templates, cut-off) stay in shop_settings and only the owner changes them;
  // everything tied to one till (address, hours, receipt text, float, card limits)
  // belongs to a shop and is changed in that shop.
  const site: Updateable<ShopSettings> = {};
  const perShop: Updateable<Shops> = {};
  if (body.returnWindowDays !== undefined) site.return_window_days = body.returnWindowDays;
  if (body.idleLockMinutes !== undefined) site.idle_lock_minutes = body.idleLockMinutes;
  if (body.shopName !== undefined) site.shop_name = body.shopName;
  if (body.socialLinks !== undefined) site.social_links = JSON.stringify(body.socialLinks);
  if (body.nextDayCutoffTime !== undefined) site.next_day_cutoff_time = body.nextDayCutoffTime;
  if (body.belowCostPromptsForReason !== undefined)
    site.below_cost_prompts_for_reason = body.belowCostPromptsForReason;
  if (body.idDocumentRetentionDays !== undefined)
    site.id_document_retention_days = body.idDocumentRetentionDays;
  if (body.customerEmailTemplates !== undefined)
    site.customer_email_templates = JSON.stringify(body.customerEmailTemplates);

  if (body.floatTarget !== undefined) perShop.float_target = body.floatTarget;
  if (body.shopAddress !== undefined) perShop.address = body.shopAddress;
  if (body.shopPhone !== undefined) perShop.phone = body.shopPhone;
  if (body.shopEmail !== undefined) perShop.email = body.shopEmail;
  if (body.openingHours !== undefined) perShop.opening_hours = JSON.stringify(body.openingHours);
  if (body.receiptHeaderText !== undefined) perShop.receipt_header_text = body.receiptHeaderText;
  if (body.receiptFooterText !== undefined) perShop.receipt_footer_text = body.receiptFooterText;
  // Item 5 — `!== undefined` rather than a truthiness test, deliberately:
  // null must reach the column to clear a limit, and 0 is a legitimate
  // limit meaning "this machine takes nothing".
  if (body.card1DailyLimit !== undefined) perShop.card1_daily_limit = body.card1DailyLimit;
  if (body.card1WeeklyLimit !== undefined) perShop.card1_weekly_limit = body.card1WeeklyLimit;
  if (body.card1MonthlyLimit !== undefined) perShop.card1_monthly_limit = body.card1MonthlyLimit;
  if (body.card2DailyLimit !== undefined) perShop.card2_daily_limit = body.card2DailyLimit;
  if (body.card2WeeklyLimit !== undefined) perShop.card2_weekly_limit = body.card2WeeklyLimit;
  if (body.card2MonthlyLimit !== undefined) perShop.card2_monthly_limit = body.card2MonthlyLimit;

  if (Object.keys(site).length > 0 && req.user!.staffRole !== 'owner') {
    return res
      .status(403)
      .json({ error: 'Only the owner can change settings shared by every shop.' });
  }
  const shopId = await writeShop(req, res);
  if (!shopId) return;

  const { error } = await attempt(async () => {
    if (Object.keys(site).length > 0) {
      await db.updateTable('shop_settings').set(site).where('singleton', '=', true).execute();
    }
    if (Object.keys(perShop).length > 0) {
      await db.updateTable('shops').set(perShop).where('id', '=', shopId).execute();
    }
  });
  if (error) return res.status(400).json({ error: error.message });
  return res.json(await settingsFor(shopId));
});
