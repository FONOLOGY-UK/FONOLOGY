import { z } from 'zod';
import { bookingSchema } from './repair';
import { orderSchema } from './order';
import { sellRequestSchema } from './sell';

/**
 * Public tracking (the `/track` page). A reference resolves to a shop order, a
 * mail-in repair request, or a sell request — the UI renders the right timeline
 * (6.7).
 */
export const trackingResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('booking'), booking: bookingSchema }),
  z.object({ kind: z.literal('order'), order: orderSchema }),
  z.object({ kind: z.literal('sell'), sell: sellRequestSchema }),
]);
export type TrackingResult = z.infer<typeof trackingResultSchema>;
