import { supabaseAdmin } from '../lib/supabase.js';
import { requireStaff, requirePermission } from '../middleware/auth.js';
import { staffNamesFor } from '../lib/staffNames.js';
import { analyticsQueryBodySchema, transactionsQueryBodySchema } from '../schemas.js';

import { createRouter } from '../lib/router.js';

export const reportsRouter = createRouter();

/**
 * Everything below is gated behind analytics.view — the sensitive half of
 * this phase. Every figure comes from a schema view/function
 * (analytics_totals, analytics_series, busiest_times, revenue_by_category,
 * tender_totals) or a plain COUNT — never a sum of raw pence computed here.
 */
reportsRouter.get(
  '/analytics',
  requireStaff,
  requirePermission('analytics.view'),
  async (req, res) => {
    const parsed = analyticsQueryBodySchema.safeParse(req.query);
    if (!parsed.success)
      return res.status(400).json({ error: 'from and to (YYYY-MM-DD) are required.' });
    const { from, to } = parsed.data;

    // Exclusive day diff — matches analytics_series' own `(p_to - p_from) <= 62`
    // threshold exactly, so this label can never disagree with the actual
    // granularity of the series rows it's describing.
    const bucketDiffDays = Math.round(
      (new Date(to).getTime() - new Date(from).getTime()) / 86400000,
    );
    const rangeDays = bucketDiffDays + 1;
    const prevTo = new Date(new Date(from).getTime() - 86400000).toISOString().slice(0, 10);
    const prevFrom = new Date(new Date(from).getTime() - rangeDays * 86400000)
      .toISOString()
      .slice(0, 10);

    const [totals, prevTotals, series, byCategory, busiest, byTender, salesCount] =
      await Promise.all([
        supabaseAdmin.rpc('analytics_totals', { p_from: from, p_to: to }).single(),
        supabaseAdmin.rpc('analytics_totals', { p_from: prevFrom, p_to: prevTo }).single(),
        supabaseAdmin.rpc('analytics_series', { p_from: from, p_to: to }),
        supabaseAdmin.rpc('revenue_by_category', { p_from: from, p_to: to }),
        supabaseAdmin.rpc('busiest_times', { p_from: from, p_to: to }),
        supabaseAdmin.rpc('tender_totals', { p_from: from, p_to: to }),
        // A row count, not a money sum — the one thing analytics_totals doesn't
        // already give back. Filtered exactly like the view (amount > 0, the
        // trading-day range) so it can never disagree with `totals` above.
        supabaseAdmin
          .from('transactions')
          .select('id', { count: 'exact', head: true })
          .gt('amount', 0)
          .gte('at', `${from}T00:00:00`)
          .lte('at', `${to}T23:59:59.999`),
      ]);

    if (totals.error) return res.status(500).json({ error: totals.error.message });
    if (!totals.data) {
      // Reported once as an unreproducible empty response (8/8 manual checks
      // returned data) — this log is evidence-gathering only, not a fix. If it
      // fires again, the timestamp/range here is the reproduction case we need.
      console.error('[reports/analytics] analytics_totals returned no row', {
        from,
        to,
        at: new Date().toISOString(),
      });
    }

    const t = (totals.data ?? { revenue: 0, cost: 0, profit: 0, margin: 0 }) as {
      revenue: number;
      cost: number;
      profit: number;
      margin: number;
    };
    const pt = (prevTotals.data as { revenue: number; profit: number } | null) ?? {
      revenue: 0,
      profit: 0,
    };
    const count = salesCount.count ?? 0;

    return res.json({
      range: { from, to },
      bucket: bucketDiffDays <= 62 ? 'day' : 'month',
      revenue: t.revenue,
      cost: t.cost,
      profit: t.profit,
      margin: t.margin,
      sales: count,
      avgSale: count > 0 ? Math.round(t.revenue / count) : 0,
      prevRevenue: pt.revenue,
      prevProfit: pt.profit,
      series: ((series.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        date: r.bucket_date,
        label: r.bucket_label,
        shop: r.shop_revenue ?? 0,
        repair: r.repair_revenue ?? 0,
      })),
      byCategory: ((byCategory.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        // revenue_by_category() (migration 0045) returns category_id and its
        // label directly, joined from categories — no more hand-maintained
        // second copy of the same 7 labels to fall out of sync with it.
        category: r.category_id,
        label: r.category_label,
        revenue: r.revenue,
        units: r.units,
      })),
      busiest: ((busiest.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        day: r.weekday,
        hour: r.hour,
        count: r.sale_count,
      })),
      byTender: ((byTender.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        tender: r.tender,
        total: r.total,
        count: r.payment_count,
      })),
    });
  },
);

/**
 * Human summary derived from real columns only (stream + sign of amount) —
 * there is no `description` column on `transactions`. Same pattern as B2's
 * `art` field: presentation text synthesised from real data, never invented.
 */
// trade_in_payouts.method allows 'bank_transfer' (its own, narrower CHECK) —
// the till's tender_method enum only has 'transfer'. Same concept, relabelled
// to the one the frontend's Tender enum already knows, never fabricated.
function mapTender(raw: string | null): string | null {
  return raw === 'bank_transfer' ? 'transfer' : raw;
}

function describeTransaction(stream: string, amount: number): string {
  const out = amount < 0;
  if (stream === 'trade-in') return 'Trade-in payout';
  if (stream === 'repair') return out ? 'Repair refund' : 'Repair payment';
  return out ? 'Refund' : 'Sale';
}

reportsRouter.get(
  '/transactions',
  requireStaff,
  requirePermission('payments.view'),
  async (req, res) => {
    const parsed = transactionsQueryBodySchema.safeParse(req.query);
    if (!parsed.success)
      return res.status(400).json({ error: 'from and to (YYYY-MM-DD) are required.' });
    const { from, to, staffId, tender } = parsed.data;

    const { data, error } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .gte('at', `${from}T00:00:00`)
      .lte('at', `${to}T23:59:59.999`)
      .order('at', { ascending: false });
    if (error) return res.status(500).json({ error: 'Could not load transactions.' });
    let rows = data ?? [];

    // A split-tender till sale has no single tender at the transactions-view
    // level (tender is null there — see 0013's `shop` branch from `sales`).
    // Every OTHER stream (repair, trade-in, refund, and shop rows sourced
    // from `orders`) already carries a real single tender or a real null, so
    // this join only ever matters for sale_payments legs specifically.
    const shopRowIds = rows
      .filter((t) => t.stream === 'shop' && t.tender === null)
      .map((t) => t.id as string);
    const legsBySaleId = new Map<string, string[]>();
    if (shopRowIds.length > 0) {
      const { data: legs } = await supabaseAdmin
        .from('sale_payments')
        .select('sale_id, tender')
        .in('sale_id', shopRowIds);
      for (const leg of legs ?? []) {
        const saleId = leg.sale_id as string;
        const list = legsBySaleId.get(saleId) ?? [];
        list.push(leg.tender as string);
        legsBySaleId.set(saleId, list);
      }
    }

    if (tender) {
      rows = rows.filter((t) => {
        if (t.tender === tender) return true;
        // Split-tender sale: matches if ANY leg was paid this way. A row
        // with no sale_payments legs at all (an order, not a sale — orders
        // never write to sale_payments) correctly matches nothing here.
        return (legsBySaleId.get(t.id as string) ?? []).includes(tender);
      });
    }
    if (staffId) {
      rows = rows.filter((t) => t.staff_id === staffId);
    }

    const names = await staffNamesFor(rows.map((t) => t.staff_id as string | null));

    return res.json(
      rows.map((t) => {
        const legs = legsBySaleId.get(t.id as string);
        return {
          id: t.id,
          at: t.at,
          stream: t.stream,
          reference: t.reference,
          description: describeTransaction(t.stream as string, t.amount as number),
          amount: t.amount,
          cost: t.cost,
          tender: mapTender(t.tender as string | null),
          // Only set for a split-tender till sale (tender itself is null in
          // that case) — the distinct methods it was actually paid across,
          // so the screen has something to show instead of a blank cell.
          tenders: legs ? [...new Set(legs.map((l) => mapTender(l)))] : null,
          staffId: t.staff_id ?? null,
          staffName: t.staff_id ? (names.get(t.staff_id as string) ?? null) : null,
          // No single category fits a multi-line basket transaction honestly —
          // see revenue_by_category (used by /reports/analytics) for the real
          // per-category breakdown. Always null here, never guessed.
          category: null,
        };
      }),
    );
  },
);
