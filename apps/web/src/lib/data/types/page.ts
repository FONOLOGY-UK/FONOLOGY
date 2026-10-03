import { z } from 'zod';

/**
 * A page of a long list, as the API returns it when asked for one (`?limit=&offset=`):
 * the rows for this page, the true size of the whole filtered list, and whole-list figures
 * (`totals`) — so a screen can still show "£1,240 taken" and export everything while only holding
 * a page of rows.
 */
export function pageOf<T extends z.ZodTypeAny, S extends z.ZodRawShape>(item: T, totals: S) {
  return z.object({
    items: z.array(item),
    total: z.number().int(),
    limit: z.number().int(),
    offset: z.number().int(),
    totals: z.object(totals),
  });
}

/** What a screen sends to ask for one page. */
export interface PageRequest {
  limit: number;
  offset: number;
}

// The concrete pages the long-list screens ask for. Built here (not in each schema file) so the
// shape of "a page" stays defined in one place.
import { transactionSchema } from './finance';
import { bookingSchema } from './repair';
import { cashEntrySchema, dayCloseSchema, refundSchema } from './finance';
import { orderSchema } from './order';

export const pagedTransactionsSchema = pageOf(transactionSchema, {
  count: z.number(),
  in: z.number(),
  out: z.number(),
  net: z.number(),
});
export type PagedTransactions = z.infer<typeof pagedTransactionsSchema>;

export const pagedRefundsSchema = pageOf(refundSchema, { amount: z.number() });
export type PagedRefunds = z.infer<typeof pagedRefundsSchema>;

export const pagedCashEntriesSchema = pageOf(cashEntrySchema, {
  floatOpen: z.number(),
  pettyIn: z.number(),
  pettyOut: z.number(),
});
export type PagedCashEntries = z.infer<typeof pagedCashEntriesSchema>;

export const pagedDayClosesSchema = pageOf(dayCloseSchema, { variance: z.number() });
export type PagedDayCloses = z.infer<typeof pagedDayClosesSchema>;

export const pagedOrdersSchema = pageOf(orderSchema, { value: z.number() });
export type PagedOrders = z.infer<typeof pagedOrdersSchema>;

export const pagedBookingsSchema = pageOf(bookingSchema, { count: z.number() });
export type PagedBookings = z.infer<typeof pagedBookingsSchema>;
