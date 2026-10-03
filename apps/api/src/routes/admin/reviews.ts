import { attempt, db } from '../../lib/db.js';
import { requireStaff, requirePermission } from '../../middleware/auth.js';
import { reviewInputBodySchema } from '../../schemas.js';
import { createRouter } from '../../lib/router.js';
import { deletedCount } from './helpers.js';

export const adminReviewsRouter = createRouter();
const router = adminReviewsRouter;

/* ---------------------------------------------------------------------- */
/* Reviews — homepage testimonials (Round 3 follow-up #4)                   */
/* ---------------------------------------------------------------------- */
// Public reads live in reviews.routes.ts (published only, no id-agnostic
// fields leaked). Everything here is the management side: the full row,
// including unpublished ones, gated on reviews.manage — see 0053_reviews.sql
// for why that's an owner-tier permission rather than an everyday one.

function toApiReview(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    device: row.device ?? '',
    text: row.body,
    rating: row.rating,
    published: row.published,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

router.get('/reviews', requireStaff, requirePermission('reviews.manage'), async (_req, res) => {
  const { data, error } = await attempt(() =>
    db.selectFrom('reviews').selectAll().orderBy('sort_order', 'asc').execute(),
  );
  if (error) return res.status(500).json({ error: 'Could not load reviews.' });
  return res.json(data.map(toApiReview));
});

router.post('/reviews', requireStaff, requirePermission('reviews.manage'), async (req, res) => {
  const parsed = reviewInputBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  const { data: row, error } = await attempt(() =>
    db
      .insertInto('reviews')
      .values({
        name: body.name,
        device: body.device || null,
        body: body.text,
        rating: body.rating,
        published: body.published,
        sort_order: body.sortOrder,
        created_by: req.user!.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),
  );
  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json(toApiReview(row));
});

router.put('/reviews/:id', requireStaff, requirePermission('reviews.manage'), async (req, res) => {
  const parsed = reviewInputBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const body = parsed.data;

  const { data: row, error } = await attempt(() =>
    db
      .updateTable('reviews')
      .set({
        name: body.name,
        device: body.device || null,
        body: body.text,
        rating: body.rating,
        published: body.published,
        sort_order: body.sortOrder,
      })
      .where('id', '=', req.params.id ?? '')
      .returningAll()
      .executeTakeFirst(),
  );
  if (error) return res.status(400).json({ error: error.message });
  if (!row) return res.status(404).json({ error: 'Review not found — it may have been deleted.' });
  return res.json(toApiReview(row));
});

router.delete(
  '/reviews/:id',
  requireStaff,
  requirePermission('reviews.manage'),
  async (req, res) => {
    const { data: deleted, error } = await attempt(() =>
      db
        .deleteFrom('reviews')
        .where('id', '=', req.params.id ?? '')
        .execute(),
    );
    if (error) return res.status(400).json({ error: error.message });
    if (!deletedCount(deleted))
      return res.status(404).json({ error: 'Review not found — it may already be deleted.' });
    return res.status(204).end();
  },
);

/* ---------------------------------------------------------------------- */
/* Product reviews (Round 5 Phase 4 #21) — moderation                       */
/* ---------------------------------------------------------------------- */
// DELIBERATELY separate from the homepage-reviews block above — see
// 0062_product_reviews.sql's header. Same permission tier (reviews.manage,
// owner-only by default): this is still "what marketing content is public",
// just customer-submitted instead of client-curated. "Approve or delete",
// per the task — there is no third "rejected" state kept around.

/** Every product review with its product and customer alongside. */
function productReviews() {
  return db
    .selectFrom('product_reviews')
    .leftJoin('products', 'products.id', 'product_reviews.product_id')
    .leftJoin('customers', 'customers.id', 'product_reviews.customer_id')
    .selectAll('product_reviews')
    .select([
      'products.name as product_name',
      'products.slug as product_slug',
      'customers.name as customer_name',
      'customers.email as customer_email',
    ]);
}

function toApiProductReview(row: Record<string, unknown>) {
  return {
    id: row.id,
    productId: row.product_id,
    productName: (row.product_name as string | null) ?? '',
    productSlug: (row.product_slug as string | null) ?? '',
    customerName: (row.customer_name as string | null) ?? '',
    customerEmail: (row.customer_email as string | null) ?? '',
    rating: row.rating,
    body: row.body,
    isApproved: row.is_approved,
    createdAt: row.created_at,
  };
}

router.get(
  '/product-reviews',
  requireStaff,
  requirePermission('reviews.manage'),
  async (req, res) => {
    let query = productReviews().orderBy('product_reviews.created_at', 'desc');
    // ?status=pending|approved — the moderation queue defaults to showing
    // everything so the count on the tab and the list never disagree; the
    // screen itself is what defaults its own view to pending.
    if (req.query.status === 'pending')
      query = query.where('product_reviews.is_approved', '=', false);
    else if (req.query.status === 'approved')
      query = query.where('product_reviews.is_approved', '=', true);

    const { data, error } = await attempt(() => query.execute());
    if (error) return res.status(500).json({ error: 'Could not load product reviews.' });
    return res.json(data.map(toApiProductReview));
  },
);

router.post(
  '/product-reviews/:id/approve',
  requireStaff,
  requirePermission('reviews.manage'),
  async (req, res) => {
    const { data: row, error } = await attempt(async () => {
      const updated = await db
        .updateTable('product_reviews')
        .set({
          is_approved: true,
          approved_by: req.user!.id,
          approved_at: new Date().toISOString(),
        })
        .where('id', '=', req.params.id ?? '')
        .returning('id')
        .executeTakeFirst();
      return updated
        ? productReviews().where('product_reviews.id', '=', updated.id).executeTakeFirst()
        : undefined;
    });
    if (error) return res.status(400).json({ error: error.message });
    if (!row) return res.status(404).json({ error: 'Review not found.' });
    return res.json(toApiProductReview(row));
  },
);

router.delete(
  '/product-reviews/:id',
  requireStaff,
  requirePermission('reviews.manage'),
  async (req, res) => {
    const { data: deleted, error } = await attempt(() =>
      db
        .deleteFrom('product_reviews')
        .where('id', '=', req.params.id ?? '')
        .execute(),
    );
    if (error) return res.status(400).json({ error: error.message });
    if (!deletedCount(deleted))
      return res.status(404).json({ error: 'Review not found — it may already be deleted.' });
    return res.status(204).end();
  },
);
