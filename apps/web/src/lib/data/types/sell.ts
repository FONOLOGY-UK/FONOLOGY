import { z } from 'zod';
import { emailSchema, idSchema, ukPhoneSchema } from './common';
import { moneySchema } from './pricing';
import { contactMethodSchema } from './repair';

/**
 * Sell / trade-in domain (6.5) — NEW. Mirrors the repair flow: device →
 * condition → contact → submit. There is NO fixed price; the value card shows
 * an INDICATIVE estimate (or a "we'll quote you" state) and Fonology confirms
 * after inspection.
 *
 * The exact condition-grading field list is PENDING CLIENT CONFIRMATION — this
 * structure follows trade-in platforms (Mazuma / iDoctor). See NOTES.md.
 */

export const screenConditionSchema = z.enum(['flawless', 'good', 'cracked']);
export const bodyConditionSchema = z.enum(['flawless', 'good', 'worn']);
export const networkStatusSchema = z.enum(['unlocked', 'locked']);
export type ScreenCondition = z.infer<typeof screenConditionSchema>;
export type BodyCondition = z.infer<typeof bodyConditionSchema>;
export type NetworkStatus = z.infer<typeof networkStatusSchema>;

export const sellConditionSchema = z.object({
  storage: z.string().min(1, 'Pick a storage size'),
  screen: screenConditionSchema,
  body: bodyConditionSchema,
  powersOn: z.boolean(),
  network: networkStatusSchema,
  /** Box, charger, cable, etc. */
  accessories: z.array(z.string()),
});
export type SellCondition = z.infer<typeof sellConditionSchema>;

export const sellRequestInputSchema = z.object({
  deviceId: idSchema,
  /** Free-text model when device is "Something else". */
  deviceOther: z.string().optional(),
  condition: sellConditionSchema,
  name: z.string().trim().min(2, 'Please enter your name'),
  phone: ukPhoneSchema,
  email: emailSchema,
  preferredContact: contactMethodSchema,
  notes: z.string().max(1000).optional(),
});
export type SellRequestInput = z.infer<typeof sellRequestInputSchema>;

/**
 * The real trade-in lifecycle, matching the schema's `sell_request_status`
 * enum exactly:
 *
 *   submitted → quoted → accepted | declined → received → paid | rejected
 *
 * This previously read `received | quoted | accepted | paid | declined`, which
 * was wrong in two ways at once. It had no value for `submitted` (the initial
 * state) or `rejected` (inspected in the shop and found unfit), and it used
 * `received` for the INITIAL state where the database uses it for a much later
 * one — the device has physically arrived after the customer accepted. The
 * same word meant two different points in the flow on each side, so a real
 * response could not be parsed at all.
 *
 * `declined` and `rejected` are deliberately distinct: declined is the
 * CUSTOMER saying no to the quote; rejected is the SHOP saying no after
 * seeing the device.
 */
export const sellStatusSchema = z.enum([
  'submitted',
  'quoted',
  'accepted',
  'declined',
  'received',
  'paid',
  'rejected',
]);
export type SellStatus = z.infer<typeof sellStatusSchema>;

/** Queue column order — the single source for pipeline sequencing. */
export const SELL_STATUS_FLOW: SellStatus[] = [
  'submitted',
  'quoted',
  'accepted',
  'received',
  'paid',
];

/** Ends the line: nothing follows these. */
export const SELL_STATUS_CLOSED: SellStatus[] = ['declined', 'rejected'];

export function sellStatusLabel(status: SellStatus): string {
  switch (status) {
    case 'submitted':
      return 'Awaiting quote';
    case 'quoted':
      return 'Quoted';
    case 'accepted':
      return 'Customer accepted';
    case 'declined':
      return 'Customer declined';
    case 'received':
      return 'Device in shop';
    case 'paid':
      return 'Paid out';
    case 'rejected':
      return 'Rejected on inspection';
  }
}

/**
 * One trade-in request as the API returns it (`toApiSellRequest`).
 *
 * Note what is NOT here: any estimate or indicative price. The old shape had
 * an `estimate` captured at submission, which the real flow has no equivalent
 * for by design — there is no automatic grading or pricing anywhere. A request
 * carries no figure at all until a person sets `quotedAmount`, and the server
 * stamps `quotedBy`/`quotedAt` from the session at the same moment.
 *
 * `condition` is optional because the QUEUE deliberately omits it: the intake
 * jsonb is inspection detail for one request, not something the list shows.
 * `GET /sell/requests/:id` includes it.
 */
export const sellRequestSchema = z.object({
  id: idSchema,
  reference: z.string(),
  customerId: idSchema.nullable().optional(),
  name: z.string(),
  phone: z.string(),
  email: z.string(),
  preferredContact: contactMethodSchema,
  deviceId: idSchema.nullable(),
  deviceOther: z.string().nullable(),
  condition: sellConditionSchema.nullable().optional(),
  status: sellStatusSchema,
  /** Set by a person, in pence. Null until quoted. */
  quotedAmount: moneySchema.nullable(),
  /** Staff id and timestamp, both stamped server-side from the session. */
  quotedBy: idSchema.nullable(),
  quotedAt: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string().nullable().optional(),
});
export type SellRequest = z.infer<typeof sellRequestSchema>;

/** The paginated envelope `GET /sell/requests` returns. */
export const sellRequestPageSchema = z.object({
  items: z.array(sellRequestSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
export type SellRequestPage = z.infer<typeof sellRequestPageSchema>;

/**
 * Queue filters. Read from the URL on the SERVER page and passed down as
 * props — never via `useSearchParams()`, which suspends the component out of
 * prerendering and, on a route like this, never resumes.
 */
export const sellRequestQuerySchema = z.object({
  /** One or more statuses; the API takes them comma-separated. */
  status: z.array(sellStatusSchema).optional(),
  search: z.string().trim().optional(),
  sort: z.enum(['created-desc', 'created-asc', 'updated-desc']).optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
});
export type SellRequestQuery = z.infer<typeof sellRequestQuerySchema>;

/** What a person types to quote a request. Pence, positive. */
export const sellQuoteInputSchema = z.object({
  amount: moneySchema.positive('Enter what the shop will pay'),
});
export type SellQuoteInput = z.infer<typeof sellQuoteInputSchema>;

/**
 * The one-time acceptance link. The plaintext token comes back exactly once,
 * on creation — only its SHA-256 hash is stored, so it cannot be recovered
 * afterwards and must not be persisted anywhere client-side.
 */
export const sellAcceptTokenSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
  /** Whether the acceptance link was also emailed to the customer automatically. */
  emailSent: z.boolean().default(false),
});
export type SellAcceptToken = z.infer<typeof sellAcceptTokenSchema>;
