import type { Request } from 'express';
import { z } from 'zod';

/**
 * Shared pieces for paginated list endpoints.
 *
 * New list endpoints return `{ items, total, limit, offset }`. The older
 * lists in this API return a bare array of the whole table with no paging —
 * that's a known weakness, not a pattern to copy; they're left alone rather
 * than retrofitted.
 */

/**
 * The most rows an UNPAGED list request returns (newest first). The older lists answer a request with no
 * `limit` with the whole table, which grows for ever and is shipped on every poll; this keeps that behaviour
 * for every realistic shop while bounding the worst case. Screens that need more send `limit`/`offset`.
 */
export const UNPAGED_LIST_CAP = 2000;

/** `limit`/`offset` query fields, spread into an endpoint's own query schema. */
export const paginationFields = {
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
};

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export function page<T>(items: T[], total: number | null, limit: number, offset: number): Page<T> {
  return { items, total: total ?? 0, limit, offset };
}

/**
 * Opt-in paging for the older "return everything" lists (orders, refunds, cash, day closes,
 * repair requests, the payments ledger).
 *
 * A request that sends no `limit` gets exactly what it always got — a bare array — so no
 * existing screen changes behaviour. A request WITH `limit` (and optionally `offset`) gets a
 * page, `{ items, total, limit, offset, totals }`, where `total` and `totals` describe the WHOLE
 * filtered list and not just the page: a screen that pages can still show "£1,240 taken" and
 * export everything, because those figures come from the server, not from the rows in hand.
 */
export function optionalPaging(req: Request): { limit: number; offset: number } | null {
  if (req.query.limit === undefined) return null;
  const parsed = z.object(paginationFields).safeParse(req.query);
  return parsed.success
    ? { limit: parsed.data.limit, offset: parsed.data.offset }
    : { limit: 50, offset: 0 };
}

/** A page with its whole-list figures. */
export function pageWithTotals<T, R extends Record<string, number>>(
  items: T[],
  total: number | null,
  paging: { limit: number; offset: number },
  totals: R,
): Page<T> & { totals: R } {
  return { ...page(items, total, paging.limit, paging.offset), totals };
}
