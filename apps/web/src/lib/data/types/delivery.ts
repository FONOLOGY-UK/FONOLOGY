import { z } from 'zod';
import { moneySchema } from './pricing';

/**
 * Admin Delivery screen — `GET /admin/delivery` (apps/api/src/routes/admin/delivery.ts).
 * Rates per zone, the remote postcode list and the free-delivery threshold, all rows read by
 * delivery_quote() (0102). Collect isn't listed: it is always free and always offered.
 */
export const deliveryRateSchema = z.object({
  id: z.string(),
  method: z.enum(['standard', 'next-day']),
  price: moneySchema,
  available: z.boolean(),
});
export type DeliveryRate = z.infer<typeof deliveryRateSchema>;

export const deliveryZoneSchema = z.object({
  id: z.string(),
  code: z.string(),
  label: z.string(),
  rates: z.array(deliveryRateSchema),
});
export type DeliveryZone = z.infer<typeof deliveryZoneSchema>;

export const deliveryPrefixSchema = z.object({
  prefix: z.string(),
  zoneId: z.string(),
});
export type DeliveryPrefix = z.infer<typeof deliveryPrefixSchema>;

export const adminDeliverySchema = z.object({
  freeDeliveryThreshold: moneySchema.nullable(),
  zones: z.array(deliveryZoneSchema),
  prefixes: z.array(deliveryPrefixSchema),
});
export type AdminDelivery = z.infer<typeof adminDeliverySchema>;
