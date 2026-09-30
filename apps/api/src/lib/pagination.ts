import { z } from 'zod';

/**
 * Shared pieces for paginated list endpoints.
 *
 * New list endpoints return `{ items, total, limit, offset }`. The older
 * lists in this API return a bare array of the whole table with no paging —
 * that's a known weakness, not a pattern to copy; they're left alone rather
 * than retrofitted.
 */

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
