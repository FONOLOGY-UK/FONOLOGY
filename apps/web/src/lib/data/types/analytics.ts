import { z } from 'zod';
import { isoDateSchema } from './common';
import { moneySchema } from './pricing';
import { productCategoryIdSchema } from './product';
import { tenderSchema } from './finance';

/**
 * Analytics (item 7, Analytics module + Reports). Everything here is DERIVED —
 * the backend (or the mock adapter) aggregates settled transactions into this
 * summary for a date range. The UI never aggregates raw rows itself, so Raja
 * can compute these server-side without touching a component.
 */

/** Inclusive date range the dashboard is looking at. */
export const analyticsQuerySchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

/** One bucket of the revenue series. Bucket size is the adapter's choice —
 *  daily for short ranges, monthly for long ones (`bucket` says which). */
export const revenuePointSchema = z.object({
  /** Bucket start date. */
  date: isoDateSchema,
  /** Short axis label, e.g. "Mon 14" or "Mar". */
  label: z.string(),
  shop: moneySchema,
  repair: moneySchema,
});
export type RevenuePoint = z.infer<typeof revenuePointSchema>;

export const categoryRevenueSchema = z.object({
  category: productCategoryIdSchema,
  label: z.string(),
  revenue: moneySchema,
  units: z.number().int(),
});
export type CategoryRevenue = z.infer<typeof categoryRevenueSchema>;

/** Footfall cell for the busiest-periods heatmap. day: 0 = Monday. */
export const busyCellSchema = z.object({
  day: z.number().int().min(0).max(6),
  hour: z.number().int().min(0).max(23),
  count: z.number().int(),
});
export type BusyCell = z.infer<typeof busyCellSchema>;

export const tenderTotalSchema = z.object({
  tender: tenderSchema,
  total: moneySchema,
  count: z.number().int(),
});
export type TenderTotal = z.infer<typeof tenderTotalSchema>;

export const analyticsSummarySchema = z.object({
  range: analyticsQuerySchema,
  bucket: z.enum(['day', 'month']),

  /** Headlines for the range. Money in pence, margin as a 0–1 fraction. */
  revenue: moneySchema,
  cost: moneySchema,
  profit: moneySchema,
  margin: z.number(),
  sales: z.number().int(),
  avgSale: moneySchema,

  /** Same-length window immediately before the range, for deltas. */
  prevRevenue: moneySchema,
  prevProfit: moneySchema,

  series: z.array(revenuePointSchema),
  byCategory: z.array(categoryRevenueSchema),
  busiest: z.array(busyCellSchema),
  byTender: z.array(tenderTotalSchema),
});
export type AnalyticsSummary = z.infer<typeof analyticsSummarySchema>;
