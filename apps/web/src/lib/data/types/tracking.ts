import { z } from 'zod';
import { bookingSchema } from './repair';
import { orderSchema } from './order';

/**
 * Public order/booking tracking (the `/track` page). A reference resolves to
 * either a repair booking or a shop order — the UI renders the right timeline.
 */
export const trackingResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('booking'), booking: bookingSchema }),
  z.object({ kind: z.literal('order'), order: orderSchema }),
]);
export type TrackingResult = z.infer<typeof trackingResultSchema>;
