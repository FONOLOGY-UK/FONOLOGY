import { supabaseAdmin } from '../lib/supabase.js';
import { createRouter } from '../lib/router.js';

/**
 * PUBLIC shop details — the one endpoint on this API with no auth at all.
 *
 * WHY IT EXISTS
 * Every shop fact the customer sees (address, phone, opening hours, the
 * returns window) lives in `shop_settings`, and 0009 states plainly that
 * "every screen, receipt and policy page reads this row". But the only way to
 * read that row was `GET /admin/settings`, which requires `settings.manage` —
 * a MANAGEMENT permission. So:
 *
 *   - the storefront, which has no session at all, could not read any of it,
 *     and carried five separate hardcoded copies instead;
 *   - the TILL could not read it either. Counter staff hold `pos.operate` but
 *     not `settings.manage`, so a receipt reading `settings.returnWindowDays`
 *     silently rendered nothing for exactly the people who print receipts,
 *     while owners saw it working perfectly.
 *
 * WHAT IS AND IS NOT PUBLIC
 * Only facts the shop already prints on its own door and receipts. Explicitly
 * NOT the whole settings row:
 *
 *   floatTarget      — how much cash is in the till each morning. Not public.
 *   idleLockMinutes  — operational, tells an attacker how long an unattended
 *                      screen stays open.
 *   customerEmailTemplates, cardMachineLabels, printerConfig — internal.
 *
 * Adding a field here makes it world-readable with no way to take it back
 * once it is cached. Default to leaving things out.
 */

export const shopRouter = createRouter();

shopRouter.get('/', async (_req, res) => {
  const { data: row } = await supabaseAdmin
    .from('shop_settings')
    .select(
      'shop_name, shop_address, shop_phone, shop_email, opening_hours, return_window_days, next_day_cutoff_time, id_document_retention_days, receipt_header_text, receipt_footer_text',
    )
    .single();

  if (!row) return res.status(503).json({ error: 'Shop details are unavailable.' });

  // Cacheable: these change perhaps twice a year, and the storefront asks for
  // them on every server render. The client-side hook layers its own
  // staleTime on top; this header is what lets a CDN or Next's fetch cache do
  // the real work.
  res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');

  res.json({
    shopName: row.shop_name,
    shopAddress: row.shop_address,
    shopPhone: row.shop_phone,
    shopEmail: row.shop_email,
    openingHours: row.opening_hours ?? [],
    returnWindowDays: row.return_window_days,
    nextDayCutoffTime: row.next_day_cutoff_time,
    idDocumentRetentionDays: row.id_document_retention_days,
    receiptHeaderText: row.receipt_header_text,
    receiptFooterText: row.receipt_footer_text,
  });
});
