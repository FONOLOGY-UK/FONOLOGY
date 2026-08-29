import { z } from 'zod';

/**
 * Public tracking (the `/track` page) — Round 5 Phase 3 #23.
 *
 * Used to resolve a reference + email to a full order, booking or sell
 * request, with an internal status timeline. Narrowed deliberately: an
 * Order ID alone (no email) now returns only courier + tracking number,
 * nothing else — see the route comment on GET /orders/:reference/tracking
 * for why (references are sequential and guessable; this keeps a bare
 * reference from being useless on its own for anything more than "is my
 * parcel with the courier yet").
 *
 * Repair and sell-request tracking no longer live on this public page —
 * Phase 1 #32 already removed the "track my request" links from the sell
 * and repair confirmation screens on the same reasoning (tracking is a
 * purchases-only feature); a signed-in customer's own repair/order history
 * is the account dashboard (#22) instead.
 */
export const orderTrackingResultSchema = z
  .object({
    courier: z.string().nullable(),
    trackingNumber: z.string().nullable(),
  })
  .nullable();
export type OrderTrackingResult = z.infer<typeof orderTrackingResultSchema>;
