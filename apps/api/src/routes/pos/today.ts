import { attempt, rpc } from '../../lib/db.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { shopDayNow } from './helpers.js';
import { createRouter } from '../../lib/router.js';
import { readShop } from '../../lib/shopScope.js';

export const posTodayRouter = createRouter();
const router = posTodayRouter;

/* ---------------------------------------------------------------------- */
/* Today's takings — employee view, hard-scoped to today                    */
/* ---------------------------------------------------------------------- */

/**
 * The shop's current trading day, per `shop_day()` — Europe/London, so it
 * survives BST and does not roll at UTC midnight.
 *
 * A screen must never work this out from the browser's clock: a machine set
 * to another timezone (or simply past midnight local while the shop day is
 * still yesterday) would disagree with the server about which day it is, and
 * "has today been closed?" would answer wrongly.
 *
 * Gated on `requireStaff` alone, deliberately. It carries no business data —
 * just a date — and tying it to any one permission would mean a member of
 * staff who can close the till can't ask which day they're closing.
 */
router.get('/shop-day', requireStaff, async (_req, res) => {
  const { data, error } = await attempt(() => shopDayNow());
  if (error) return res.status(500).json({ error: 'Could not read the trading day.' });
  return res.json({ date: data });
});

router.get('/today', requireStaff, requirePermission('sales.today'), async (req, res) => {
  // No query parameters are read at all — there is nothing a caller can
  // pass to widen this beyond today. pos_today_summary() takes zero
  // arguments and always means shop_day(now()) — see 0016_pos_today.sql.
  const [{ data, error }, today] = await Promise.all([
    attempt(() =>
      rpc<{ total: number; sales_count: number }[]>(
        'pos_today_summary',
        { p_shop_id: readShop(req) },
        { returnsSet: true },
      ),
    ),
    shopDayNow().catch(() => null),
  ]);
  const summary = data?.[0];
  if (error || !summary) return res.status(500).json({ error: 'Could not load today’s summary.' });
  return res.json({ date: today, total: summary.total, sales: summary.sales_count });
});

router.get('/today/report', requireStaff, requirePermission('sales.today'), async (req, res) => {
  const { data, error } = await attempt(() =>
    rpc<unknown>('pos_today_report', { p_shop_id: readShop(req) }),
  );
  if (error) return res.status(500).json({ error: 'Could not load today’s report.' });
  return res.json(data);
});
