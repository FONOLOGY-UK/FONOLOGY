import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common';

/** A customer review shown in the storefront marquee rows. Only ever
 * published, real reviews reach this shape — see reviews.tsx's own comment
 * on why an empty list renders nothing rather than falling back to invented
 * copy. */
export const reviewSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  /** What was fixed/bought, e.g. "iPhone 14 screen". */
  device: z.string(),
  text: z.string().min(1),
  rating: z.number().int().min(1).max(5),
});
export type Review = z.infer<typeof reviewSchema>;

/**
 * Admin CRUD shape (Round 3 follow-up #4) — the public `reviewSchema` above
 * stays deliberately minimal (it's what the storefront bundle actually
 * needs); this extends it with the fields only the management screen cares
 * about. Same split as `AdminProduct` vs `Product` in inventory.ts.
 */
export const adminReviewInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name'),
  /** Optional on purpose — not every real review says what was fixed. */
  device: z.string().trim().optional(),
  text: z.string().trim().min(1, 'Enter the review text'),
  rating: z.number().int().min(1).max(5),
  published: z.boolean(),
  sortOrder: z.number().int(),
});
export type AdminReviewInput = z.infer<typeof adminReviewInputSchema>;

export const adminReviewSchema = adminReviewInputSchema.extend({
  id: idSchema,
  createdAt: isoDateTimeSchema,
});
export type AdminReview = z.infer<typeof adminReviewSchema>;
