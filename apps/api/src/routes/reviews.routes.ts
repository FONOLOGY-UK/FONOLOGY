import { supabaseAdmin } from '../lib/supabase.js';
import { requireCustomer } from '../middleware/auth.js';
import { isRateLimited } from '../lib/rateLimit.js';
import { productReviewInputBodySchema } from '../schemas.js';
import { createRouter } from '../lib/router.js';

/**
 * PUBLIC reviews — the homepage marquee (Round 3 follow-up #4).
 *
 * Only ever returns `published` rows, oldest-added-field-first meaning:
 * ordered by `sort_order`, which is admin-controlled and independent of
 * `created_at` — see 0053_reviews.sql's own comment on why. No `published`
 * or `sortOrder` field is sent to the browser; the public `Review` shape
 * (apps/web/src/lib/data/types/review.ts) doesn't carry them; there's
 * nothing for an unpublished or hidden review to leak here even if this
 * table grows admin-only fields later.
 */

export const reviewsRouter = createRouter();

reviewsRouter.get('/', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('reviews')
    .select('id, name, device, body, rating')
    .eq('published', true)
    .order('sort_order', { ascending: true });
  if (error) return res.status(500).json({ error: 'Could not load reviews.' });

  // Cacheable, same reasoning as shop.routes.ts — this changes rarely and
  // every homepage render asks for it.
  res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');

  res.json(
    (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      device: row.device ?? '',
      text: row.body,
      rating: row.rating,
    })),
  );
});

/* ---------------------------------------------------------------------- */
/* Product reviews (Round 5 Phase 4 #21) — DELIBERATELY separate from the   */
/* homepage marquee above. See 0062_product_reviews.sql's own header for    */
/* why: different provenance (customer-submitted vs client-curated),        */
/* different moderation model (pending/approved vs published/unpublished).  */
/* ---------------------------------------------------------------------- */

/** "Sarah W." — same first-name-plus-last-initial style the homepage
 * testimonials already use (0053's seeded rows), applied here to a real
 * name on file rather than typed in by admin. Never the full surname. */
function displayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'A customer';
  if (parts.length === 1) return parts[0]!;
  const first = parts[0]!;
  const lastInitial = parts[parts.length - 1]!.charAt(0).toUpperCase();
  return `${first} ${lastInitial}.`;
}

/**
 * Approved reviews for one product, newest first. Public, no auth — same
 * posture as every other customer-facing catalogue read. Never exposes
 * customer_id, is_approved, approved_by/approved_at — only what a shopper
 * should see.
 */
reviewsRouter.get('/product/:productId', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('product_reviews')
    .select('id, rating, body, created_at, customers(name)')
    .eq('product_id', req.params.productId)
    .eq('is_approved', true)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Could not load reviews.' });

  res.json(
    (data ?? []).map((row) => {
      // supabase-js embeds a to-one FK as a single object without generated
      // Database types telling it so — same gap this codebase already
      // works around elsewhere (see orders.routes.ts's own comment on it).
      const customer = row.customers as unknown as { name: string } | null;
      return {
        id: row.id,
        rating: row.rating,
        body: row.body,
        reviewerName: displayName(customer?.name ?? ''),
        createdAt: row.created_at,
      };
    }),
  );
});

/**
 * What the PDP needs to decide what to show a SIGNED-IN customer: has this
 * account already reviewed the product (pending or approved — either way,
 * no second form), and — only relevant when they haven't — did they
 * actually buy it. Checked with the same customer_purchased_product() the
 * insert trigger itself uses, so this can never say "you may review this"
 * when the real insert would then refuse it.
 */
reviewsRouter.get('/product/:productId/eligibility', requireCustomer, async (req, res) => {
  const { data: existing } = await supabaseAdmin
    .from('product_reviews')
    .select('id, is_approved')
    .eq('product_id', req.params.productId)
    .eq('customer_id', req.user!.id)
    .maybeSingle();

  if (existing) {
    return res.json({ alreadyReviewed: true, isApproved: existing.is_approved, purchased: true });
  }

  const { data: purchased, error } = await supabaseAdmin.rpc('customer_purchased_product', {
    p_customer_id: req.user!.id,
    p_product_id: req.params.productId,
  });
  if (error) return res.status(500).json({ error: 'Could not check eligibility.' });

  return res.json({ alreadyReviewed: false, isApproved: false, purchased: Boolean(purchased) });
});

/**
 * Submit a review. requireCustomer — the storefront never requires an
 * account for anything else, but there is genuinely nothing to attribute a
 * review to without one. Purchase verification and the one-per-customer
 * rule are enforced by product_reviews_require_purchase() and the table's
 * own unique constraint (0062) — this route does NOT re-check either
 * itself, on purpose: the database is the one place that check can never
 * be bypassed by a future caller that forgets to run it.
 *
 * Rate-limited per customer (not per IP — the account is already known) as
 * basic anti-spam alongside the length cap in productReviewInputBodySchema
 * and the matching CHECK on the table itself.
 */
reviewsRouter.post('/product/:productId', requireCustomer, async (req, res) => {
  if (isRateLimited(`review:${req.user!.id}`, { max: 10, windowMs: 60 * 60_000 })) {
    return res.status(429).json({ error: 'Too many reviews submitted — please try again later.' });
  }

  const parsed = productReviewInputBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  const { data: row, error } = await supabaseAdmin
    .from('product_reviews')
    .insert({
      product_id: req.params.productId,
      customer_id: req.user!.id,
      rating: body.rating,
      body: body.body,
    })
    .select('id, rating, body, is_approved, created_at')
    .single();

  if (error) {
    // Surfaces the schema's own refusals cleanly: not purchased (trigger),
    // already reviewed (unique constraint), bad rating/length (CHECK) —
    // never re-derived here, same posture as complete_sale/create_order's
    // own error handling elsewhere in this app.
    if (error.code === '23505') {
      return res.status(409).json({ error: 'You’ve already reviewed this product.' });
    }
    return res.status(400).json({ error: error.message });
  }

  return res.status(201).json({
    id: row.id,
    rating: row.rating,
    body: row.body,
    isApproved: row.is_approved,
    createdAt: row.created_at,
  });
});
