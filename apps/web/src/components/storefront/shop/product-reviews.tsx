'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Star } from 'lucide-react';
import { usePathname } from 'next/navigation';
import {
  useSession,
  useProductReviews,
  useReviewEligibility,
  useSubmitProductReview,
} from '@/lib/data/hooks';
import { formatDay } from '@/lib/dates';
import { signInHref } from '@/lib/auth-redirect';
import { Button } from '@/components/ui/button';

/**
 * Round 5 Phase 4 #21. Customer-submitted, per-product reviews — DELIBERATELY
 * a different system from the homepage testimonials marquee (reviews.tsx),
 * see 0062_product_reviews.sql for why. Purchase verification and the
 * one-per-customer rule are both enforced server-side (the database itself,
 * not just this form) — what this component shows is just the honest
 * consequence of that: a guest or a customer who never bought this product
 * never sees a form to fill in, not because the UI hid a button, but
 * because there is genuinely nothing here for them to submit.
 */
export function ProductReviews({
  productId,
  productName,
}: {
  productId: string;
  productName: string;
}) {
  const { data: session } = useSession();
  const isCustomer = session?.kind === 'customer';
  const pathname = usePathname();

  const { data: reviews, isPending: reviewsPending } = useProductReviews(productId);
  const { data: eligibility } = useReviewEligibility(productId, isCustomer);

  const average =
    reviews && reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : null;

  return (
    <div className="pdp__block">
      <h2>
        Reviews
        {average != null ? (
          <span className="text-muted ml-2 text-sm font-normal">
            {average.toFixed(1)} out of 5 · {reviews!.length} review
            {reviews!.length === 1 ? '' : 's'}
          </span>
        ) : null}
      </h2>

      {reviewsPending ? (
        <p className="text-muted text-sm">Loading reviews…</p>
      ) : reviews && reviews.length > 0 ? (
        <ul className="mt-3 grid gap-4">
          {reviews.map((r) => (
            <li key={r.id} className="border-line border-b pb-4 last:border-0">
              <div className="flex items-center gap-2">
                <StarRow rating={r.rating} />
                <span className="text-sm font-semibold">{r.reviewerName}</span>
                <span className="text-muted text-xs">{formatDay(r.createdAt)}</span>
              </div>
              <p className="text-ink-2 mt-1.5 text-sm">{r.body}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted mt-2 text-sm">No reviews yet — be the first to leave one.</p>
      )}

      <div className="mt-5">
        {!session ? (
          <p className="text-muted text-sm">
            <Link href={signInHref(pathname)} className="link-arrow">
              Sign in
            </Link>{' '}
            to review this product, if you’ve bought it from us.
          </p>
        ) : !isCustomer ? null : eligibility?.alreadyReviewed ? (
          <p className="text-muted text-sm">
            {eligibility.isApproved
              ? 'You’ve already reviewed this product — thanks!'
              : 'Your review is in — pending approval before it shows publicly.'}
          </p>
        ) : eligibility?.purchased ? (
          <ReviewForm productId={productId} productName={productName} />
        ) : eligibility ? (
          <p className="text-muted text-sm">
            You can review this product once you’ve bought it from us.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function StarRow({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          width={size}
          height={size}
          fill={n <= rating ? 'var(--red)' : 'none'}
          stroke="var(--red)"
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

function ReviewForm({ productId, productName }: { productId: string; productName: string }) {
  const submit = useSubmitProductReview(productId);
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return (
      <p className="text-muted text-sm">
        Thanks — your review of {productName} is pending approval.
      </p>
    );
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim()) return;
        submit.mutate({ rating, body: body.trim() }, { onSuccess: () => setSubmitted(true) });
      }}
    >
      <p className="text-sm font-semibold">Leave a review</p>
      <div className="flex items-center gap-1" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={n === rating}
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
            onClick={() => setRating(n)}
            className="p-0.5"
          >
            <Star
              width={22}
              height={22}
              fill={n <= rating ? 'var(--red)' : 'none'}
              stroke="var(--red)"
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={2000}
        rows={4}
        placeholder="What did you think?"
        className="border-line rounded-ui border p-3 text-sm"
        aria-label="Review text"
      />
      <Button type="submit" size="sm" className="w-fit" disabled={!body.trim() || submit.isPending}>
        {submit.isPending ? 'Submitting…' : 'Submit review'}
      </Button>
    </form>
  );
}
