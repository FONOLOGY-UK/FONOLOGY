import { z } from 'zod';
import { idSchema } from './common';

/** A customer review shown in the storefront marquee rows. */
export const reviewSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  /** What was fixed/bought, e.g. "iPhone 14 screen". */
  device: z.string(),
  text: z.string().min(1),
  rating: z.number().int().min(1).max(5),
});
export type Review = z.infer<typeof reviewSchema>;
