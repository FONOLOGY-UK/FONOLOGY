import { attempt, db } from '../../lib/db.js';
import type { Updateable } from 'kysely';
import type { ShopSettings } from '../../db/types.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { settingsPatchBodySchema } from '../../schemas.js';
import { createRouter } from '../../lib/router.js';

export const adminSettingsRouter = createRouter();
const router = adminSettingsRouter;

/* ---------------------------------------------------------------------- */
/* Settings — the single shop_settings row                                  */
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

router.get('/settings', requireStaff, requirePermission('settings.manage'), async (_req, res) => {
  const row = await db.selectFrom('shop_settings').selectAll().executeTakeFirstOrThrow();
  return res.json(toApiSettings(row));
});

router.patch('/settings', requireStaff, requirePermission('settings.manage'), async (req, res) => {
  const parsed = settingsPatchBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  // jsonb columns (opening hours, social links, email templates) are sent
  // as JSON text: node-postgres would turn a JS array into a Postgres
  // array literal, which jsonb rejects.
  const patch: Updateable<ShopSettings> = {};
  if (body.returnWindowDays !== undefined) patch.return_window_days = body.returnWindowDays;
  if (body.idleLockMinutes !== undefined) patch.idle_lock_minutes = body.idleLockMinutes;
  if (body.floatTarget !== undefined) patch.float_target = body.floatTarget;
  if (body.shopName !== undefined) patch.shop_name = body.shopName;
  if (body.shopAddress !== undefined) patch.shop_address = body.shopAddress;
  if (body.shopPhone !== undefined) patch.shop_phone = body.shopPhone;
  if (body.shopEmail !== undefined) patch.shop_email = body.shopEmail;
  if (body.openingHours !== undefined) patch.opening_hours = JSON.stringify(body.openingHours);
  if (body.socialLinks !== undefined) patch.social_links = JSON.stringify(body.socialLinks);
  if (body.nextDayCutoffTime !== undefined) patch.next_day_cutoff_time = body.nextDayCutoffTime;
  if (body.belowCostPromptsForReason !== undefined)
    patch.below_cost_prompts_for_reason = body.belowCostPromptsForReason;
  if (body.idDocumentRetentionDays !== undefined)
    patch.id_document_retention_days = body.idDocumentRetentionDays;
  if (body.receiptHeaderText !== undefined) patch.receipt_header_text = body.receiptHeaderText;
  if (body.receiptFooterText !== undefined) patch.receipt_footer_text = body.receiptFooterText;
  if (body.customerEmailTemplates !== undefined)
    patch.customer_email_templates = JSON.stringify(body.customerEmailTemplates);
  // Item 5 — `!== undefined` rather than a truthiness test, deliberately:
  // null must reach the column to clear a limit, and 0 is a legitimate
  // limit meaning "this machine takes nothing".
  if (body.card1DailyLimit !== undefined) patch.card1_daily_limit = body.card1DailyLimit;
  if (body.card1WeeklyLimit !== undefined) patch.card1_weekly_limit = body.card1WeeklyLimit;
  if (body.card1MonthlyLimit !== undefined) patch.card1_monthly_limit = body.card1MonthlyLimit;
  if (body.card2DailyLimit !== undefined) patch.card2_daily_limit = body.card2DailyLimit;
  if (body.card2WeeklyLimit !== undefined) patch.card2_weekly_limit = body.card2WeeklyLimit;
  if (body.card2MonthlyLimit !== undefined) patch.card2_monthly_limit = body.card2MonthlyLimit;

  const { data: row, error } = await attempt(() =>
    Object.keys(patch).length === 0
      ? db.selectFrom('shop_settings').selectAll().executeTakeFirstOrThrow()
      : db
          .updateTable('shop_settings')
          .set(patch)
          .where('singleton', '=', true)
          .returningAll()
          .executeTakeFirstOrThrow(),
  );
  if (error) return res.status(400).json({ error: error.message });
  return res.json(toApiSettings(row));
});
