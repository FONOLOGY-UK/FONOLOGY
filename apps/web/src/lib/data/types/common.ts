import { z } from 'zod';

/**
 * Cross-entity primitives shared by every domain type and by the
 * DataAdapter contract. Keep this file dependency-free (Zod only) so it can
 * move into a shared package untouched.
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

/**
 * Every UK postcode area (the letters at the start), plus the Channel Islands and the Isle of Man,
 * which the delivery zones cover. The shape check alone let "Hw1a1aa" through (a real order from
 * "Rawalpindi, Pakistan", 12 Nov 2026): "HW" looks like an area but no such area exists.
 * Two copies that must match: apps/api/src/schemas.ts and apps/web/src/lib/data/types/common.ts.
 */
const UK_POSTCODE_AREAS = new Set([
  'AB',
  'AL',
  'B',
  'BA',
  'BB',
  'BD',
  'BH',
  'BL',
  'BN',
  'BR',
  'BS',
  'BT',
  'CA',
  'CB',
  'CF',
  'CH',
  'CM',
  'CO',
  'CR',
  'CT',
  'CV',
  'CW',
  'DA',
  'DD',
  'DE',
  'DG',
  'DH',
  'DL',
  'DN',
  'DT',
  'DY',
  'E',
  'EC',
  'EH',
  'EN',
  'EX',
  'FK',
  'FY',
  'G',
  'GL',
  'GU',
  'GY',
  'HA',
  'HD',
  'HG',
  'HP',
  'HR',
  'HS',
  'HU',
  'HX',
  'IG',
  'IM',
  'IP',
  'IV',
  'JE',
  'KA',
  'KT',
  'KW',
  'KY',
  'L',
  'LA',
  'LD',
  'LE',
  'LL',
  'LN',
  'LS',
  'LU',
  'M',
  'ME',
  'MK',
  'ML',
  'N',
  'NE',
  'NG',
  'NN',
  'NP',
  'NR',
  'NW',
  'OL',
  'OX',
  'PA',
  'PE',
  'PH',
  'PL',
  'PO',
  'PR',
  'RG',
  'RH',
  'RM',
  'S',
  'SA',
  'SE',
  'SG',
  'SK',
  'SL',
  'SM',
  'SN',
  'SO',
  'SP',
  'SR',
  'SS',
  'ST',
  'SW',
  'SY',
  'TA',
  'TD',
  'TF',
  'TN',
  'TQ',
  'TR',
  'TS',
  'TW',
  'UB',
  'W',
  'WA',
  'WC',
  'WD',
  'WF',
  'WN',
  'WR',
  'WS',
  'WV',
  'YO',
  'ZE',
]);

/** A real-looking UK postcode: the right shape AND a postcode area that exists. */
export function isUkPostcode(raw: string): boolean {
  const v = raw.trim().toUpperCase().replace(/\s+/g, ' ');
  const m = /^([A-Z]{1,2})\d[A-Z\d]? ?\d[A-Z]{2}$/.exec(v);
  return !!m && UK_POSTCODE_AREAS.has(m[1]!);
}

/** UK postcode: shape and a real postcode area; the backend checks the same. */
export const ukPostcodeSchema = z.string().trim().refine(isUkPostcode, 'Enter a valid UK postcode');

export const emailSchema = z.string().trim().email('Enter a valid email address');

/** Standard envelope for a list endpoint that may paginate later. */
export interface Paginated<T> {
  items: T[];
  total: number;
}
