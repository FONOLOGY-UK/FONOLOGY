import { z } from 'zod';

/**
 * Cross-entity primitives shared by every domain type and by the
 * DataAdapter contract. Keep this file dependency-free (Zod only) so the
 * `packages/contracts` package Raja adds later can re-export it untouched.
 */

/** Opaque identifier. Backend may return uuid/cuid/int-as-string — all fit. */
export const idSchema = z.string().min(1);
export type Id = z.infer<typeof idSchema>;

/** ISO-8601 timestamp string, e.g. "2026-07-18T09:30:00.000Z". */
export const isoDateTimeSchema = z.string().datetime({ offset: true });

/** Calendar day, e.g. "2026-07-18" (no time component). */
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

/** UK mobile / landline, permissive on formatting (validated properly server-side). */
export const ukPhoneSchema = z
  .string()
  .trim()
  .regex(/^(?:\+?44|0)[\d\s-]{9,13}$/, 'Enter a valid UK phone number');

/** UK postcode, loosely validated for UX; the backend is the authority. */
export const ukPostcodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}$/, 'Enter a valid UK postcode');

export const emailSchema = z.string().trim().email('Enter a valid email address');

/** Standard envelope for a list endpoint that may paginate later. */
export interface Paginated<T> {
  items: T[];
  total: number;
}

export const paginatedSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), total: z.number().int().nonnegative() });
