import { supabaseAdmin } from '../lib/supabase.js';
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
