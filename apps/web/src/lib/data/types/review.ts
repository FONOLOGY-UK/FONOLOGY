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

/* ---------------------------------------------------------------------- */
/* Product reviews (Round 5 Phase 4 #21) — DELIBERATELY separate from the   */
/* homepage marquee above (Review/AdminReview). Customer-submitted, per-    */
/* product, purchase-verified server-side, moderated. See                  */
/* 0062_product_reviews.sql for why these stay two different systems.      */
/* ---------------------------------------------------------------------- */

/** One approved review on a product's own page. Only ever what an
 * anonymous shopper should see — no customer id, no moderation fields. */
export const productReviewSchema = z.object({
  id: idSchema,
  rating: z.number().int().min(1).max(5),
  body: z.string().min(1),
  /** "Sarah W." — first name + last initial, server-formatted from the
   * real name on file (never the full surname). */
  reviewerName: z.string().min(1),
  createdAt: isoDateTimeSchema,
});
export type ProductReview = z.infer<typeof productReviewSchema>;

/** Submission form payload. */
export const productReviewInputSchema = z.object({
  rating: z.number().int().min(1, 'Pick a rating').max(5),
  body: z
    .string()
    .trim()
    .min(1, 'Say a little about the product')
    .max(2000, 'Keep it under 2000 characters'),
});
export type ProductReviewInput = z.infer<typeof productReviewInputSchema>;

/**
 * What GET /reviews/product/:id/eligibility answers for a signed-in
 * customer — drives whether the PDP shows the review form, a "pending
 * approval" note, the review itself, or nothing (never purchased).
 */
export const reviewEligibilitySchema = z.object({
  alreadyReviewed: z.boolean(),
  isApproved: z.boolean(),
  purchased: z.boolean(),
});
export type ReviewEligibility = z.infer<typeof reviewEligibilitySchema>;

/** Admin moderation queue row — every field the screen needs to show and
 * act on one submitted review, across every product. */
export const adminProductReviewSchema = z.object({
  id: idSchema,
  productId: idSchema,
  productName: z.string(),
  productSlug: z.string(),
  customerName: z.string(),
  customerEmail: z.string(),
  rating: z.number().int().min(1).max(5),
  body: z.string(),
  isApproved: z.boolean(),
  createdAt: isoDateTimeSchema,
});
export type AdminProductReview = z.infer<typeof adminProductReviewSchema>;
