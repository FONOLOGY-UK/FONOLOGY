'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Pencil, Plus, Star, Trash2, Check, X } from 'lucide-react';
import {
  useAdminReviews,
  useDeleteReview,
  useSaveReview,
  useAdminProductReviews,
  useApproveProductReview,
  useDeleteProductReview,
} from '@/lib/data/hooks';
import type { AdminReview, AdminReviewInput, AdminProductReview } from '@/lib/data/types';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { Field } from '@/components/admin/field';
import { PageHeader } from '@/components/admin/page-header';
import { StatusChip } from '@/components/admin/status-chip';
import { cn } from '@/lib/utils';

/**
 * Homepage reviews (Round 3 follow-up #4). Real content only — see
 * 0053_reviews.sql and reviews.tsx (storefront) for why: the DMCC Act 2024
 * bans publishing fabricated or unverifiable reviews, so this screen exists
 * for the client to maintain genuine reviews themselves, not to generate
 * plausible-looking ones.
 *
 * "Unpublish" rather than "delete" is the everyday action — a review pulled
 * from the homepage for now (a duplicate, one the client wants to hold back)
 * doesn't need to lose its text and rating forever. Delete is still here for
 * the case that genuinely is gone for good.
 */
export function ReviewsView() {
  // Round 5 Phase 4 #21: two DELIBERATELY separate systems sharing this one
  // screen — see 0062_product_reviews.sql. A simple pill toggle, not a new
  // Tabs primitive (nothing else in admin has one yet).
  const [tab, setTab] = useState<'testimonials' | 'product'>('testimonials');

  return (
    <div>
      <div className="border-line bg-paper-2/60 mb-5 inline-flex rounded-full border p-1 text-sm">
        <button
          type="button"
          onClick={() => setTab('testimonials')}
          className={cn(
            'rounded-full px-4 py-1.5 font-semibold transition-colors',
            tab === 'testimonials' ? 'bg-card text-ink shadow-sm' : 'text-muted',
          )}
        >
          Testimonials
        </button>
        <button
          type="button"
          onClick={() => setTab('product')}
          className={cn(
            'rounded-full px-4 py-1.5 font-semibold transition-colors',
            tab === 'product' ? 'bg-card text-ink shadow-sm' : 'text-muted',
          )}
        >
          Product Reviews
        </button>
      </div>
      {tab === 'testimonials' ? <TestimonialsPanel /> : <ProductReviewsPanel />}
    </div>
  );
}

/* ---- testimonials (the original screen, unchanged) -------------------------- */

function TestimonialsPanel() {
  const { data: reviews, isPending, isError, refetch } = useAdminReviews();
  const saveReview = useSaveReview();
  const deleteReview = useDeleteReview();

  const [editing, setEditing] = useState<AdminReview | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<AdminReview | null>(null);

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const togglePublished = (review: AdminReview) => {
    saveReview.mutate({
      id: review.id,
      name: review.name,
      device: review.device,
      text: review.text,
      rating: review.rating,
      sortOrder: review.sortOrder,
      published: !review.published,
    });
  };

  const sorted = reviews ? [...reviews].sort((a, b) => a.sortOrder - b.sortOrder) : undefined;

  return (
    <div>
      <PageHeader
        eyebrow="Marketing"
        title="Reviews"
        description="What shows in “Strangers being very nice about us” on the homepage."
        actions={
          <Button onClick={openNew}>
            <Plus aria-hidden="true" />
            Add review
          </Button>
        }
      />

      {isError ? (
        <div className="border-line bg-card rounded-lg border p-8 text-center">
          <p className="text-ink mb-3 text-sm font-semibold">Reviews didn’t load.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      ) : isPending ? (
        <div className="grid gap-3">
          <Skeleton className="h-[120px]" />
          <Skeleton className="h-[120px]" />
          <Skeleton className="h-[120px]" />
        </div>
      ) : sorted && sorted.length > 0 ? (
        <div className="grid gap-3">
          {sorted.map((review) => (
            <ReviewRow
              key={review.id}
              review={review}
              busy={saveReview.isPending}
              onTogglePublished={() => togglePublished(review)}
              onEdit={() => {
                setEditing(review);
                setDialogOpen(true);
              }}
              onDelete={() => setDeleting(review)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          title="No reviews yet"
          description="Add a real review the shop has actually received — from Google, email, or in person."
          action={<Button onClick={openNew}>Add review</Button>}
        />
      )}

      <ReviewDialog
        key={editing?.id ?? 'new'}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        review={editing}
        nextSortOrder={(reviews?.length ?? 0) + 1}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        title="Delete this review?"
        description={
          deleting
            ? `“${deleting.name}”’s review is removed for good — if you might want it back later, Unpublish instead.`
            : undefined
        }
        confirmLabel="Delete review"
        destructive
        loading={deleteReview.isPending}
        onConfirm={() => {
          if (!deleting) return;
          deleteReview.mutate(deleting.id, { onSuccess: () => setDeleting(null) });
        }}
      />
    </div>
  );
}

/* ---- product reviews (Round 5 Phase 4 #21) ----------------------------------- */
// Customer-submitted, purchase-verified, pending -> approved/deleted. See
// 0062_product_reviews.sql's own header for why this is a separate table
// and screen from the testimonials above, not a merge.

function ProductReviewsPanel() {
  const [filter, setFilter] = useState<'pending' | 'approved'>('pending');
  const { data: reviews, isPending, isError, refetch } = useAdminProductReviews(filter);
  const approve = useApproveProductReview();
  const remove = useDeleteProductReview();
  const [deleting, setDeleting] = useState<AdminProductReview | null>(null);

  return (
    <div>
      <PageHeader
        eyebrow="Marketing"
        title="Product reviews"
        description="Customer-submitted reviews, verified against real purchase history. Approve to publish on the product page, or delete."
        actions={
          <div className="border-line inline-flex rounded-full border p-1 text-sm">
            <button
              type="button"
              onClick={() => setFilter('pending')}
              className={cn(
                'rounded-full px-3 py-1 font-semibold transition-colors',
                filter === 'pending' ? 'bg-paper-2 text-ink' : 'text-muted',
              )}
            >
              Pending
            </button>
            <button
              type="button"
              onClick={() => setFilter('approved')}
              className={cn(
                'rounded-full px-3 py-1 font-semibold transition-colors',
                filter === 'approved' ? 'bg-paper-2 text-ink' : 'text-muted',
              )}
            >
              Approved
            </button>
          </div>
        }
      />

      {isError ? (
        <div className="border-line bg-card rounded-lg border p-8 text-center">
          <p className="text-ink mb-3 text-sm font-semibold">Reviews didn’t load.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      ) : isPending ? (
        <div className="grid gap-3">
          <Skeleton className="h-[100px]" />
          <Skeleton className="h-[100px]" />
        </div>
      ) : reviews && reviews.length > 0 ? (
        <div className="grid gap-3">
          {reviews.map((review) => (
            <div key={review.id} className="border-line bg-card rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StarRow rating={review.rating} />
                    <span className="text-sm font-semibold">{review.customerName}</span>
                    <span className="text-muted text-xs">{review.customerEmail}</span>
                  </div>
                  <p className="text-muted mt-0.5 text-xs">
                    on{' '}
                    <a
                      href={`/shop/${review.productSlug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      {review.productName}
                    </a>{' '}
                    · {new Date(review.createdAt).toLocaleDateString('en-GB')}
                  </p>
                  <p className="text-ink-2 mt-2 text-sm">{review.body}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {!review.isApproved ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={approve.isPending}
                      onClick={() => approve.mutate(review.id)}
                    >
                      <Check className="size-3.5" aria-hidden="true" />
                      Approve
                    </Button>
                  ) : null}
                  <Button size="sm" variant="outline" onClick={() => setDeleting(review)}>
                    <X className="size-3.5" aria-hidden="true" />
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title={filter === 'pending' ? 'Nothing pending' : 'No approved reviews yet'}
          description={
            filter === 'pending'
              ? 'New customer reviews land here for approval.'
              : 'Approved reviews show on their product page.'
          }
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        title="Delete this review?"
        description={
          deleting ? `“${deleting.customerName}”’s review is removed for good.` : undefined
        }
        confirmLabel="Delete review"
        destructive
        loading={remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) });
        }}
      />
    </div>
  );
}

function StarRow({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className="size-3.5"
          fill={n <= rating ? 'var(--red)' : 'none'}
          stroke="var(--red)"
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

/* ---- one review ------------------------------------------------------------- */

function ReviewRow({
  review,
  busy,
  onTogglePublished,
  onEdit,
  onDelete,
}: {
  review: AdminReview;
  busy: boolean;
  onTogglePublished: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="border-line bg-card flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-ink text-sm font-bold">{review.name}</h2>
          {review.device ? (
            <span className="bg-paper-2/60 text-muted rounded-md px-2 py-0.5 text-[11px] font-semibold">
              {review.device}
            </span>
          ) : null}
          <span
            className="flex items-center gap-0.5"
            aria-label={`${review.rating} out of 5 stars`}
          >
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                className={cn('size-3', i < review.rating ? 'fill-ember text-ember' : 'text-line')}
                aria-hidden="true"
              />
            ))}
          </span>
          {review.published ? (
            <StatusChip tone="success">Published</StatusChip>
          ) : (
            <StatusChip tone="neutral">Unpublished</StatusChip>
          )}
        </div>
        <p className="text-ink-2 mt-2 text-sm">{review.text}</p>
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:flex-col sm:items-end">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2 text-xs"
          disabled={busy}
          onClick={onTogglePublished}
        >
          {review.published ? (
            <>
              <EyeOff className="size-3.5" aria-hidden="true" />
              Unpublish
            </>
          ) : (
            <>
              <Eye className="size-3.5" aria-hidden="true" />
              Publish
            </>
          )}
        </Button>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            aria-label={`Edit ${review.name}’s review`}
            onClick={onEdit}
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted hover:text-red-deep h-8 px-2"
            aria-label={`Delete ${review.name}’s review`}
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
    </article>
  );
}

/* ---- create / edit dialog ---------------------------------------------------- */

const reviewFormSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name'),
  device: z.string().trim().optional(),
  text: z.string().trim().min(1, 'Enter the review'),
  rating: z.string().min(1),
  sortOrder: z.string().min(1),
  published: z.boolean(),
});
type ReviewFormValues = z.infer<typeof reviewFormSchema>;

function ReviewDialog({
  open,
  onOpenChange,
  review,
  nextSortOrder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  review: AdminReview | null;
  /** Where a brand-new review lands by default — end of the current list. */
  nextSortOrder: number;
}) {
  const saveReview = useSaveReview();
  const pending = saveReview.isPending;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ReviewFormValues>({
    resolver: zodResolver(reviewFormSchema),
    defaultValues: review
      ? {
          name: review.name,
          device: review.device,
          text: review.text,
          rating: `${review.rating}`,
          sortOrder: `${review.sortOrder}`,
          published: review.published,
        }
      : {
          name: '',
          device: '',
          text: '',
          rating: '5',
          sortOrder: `${nextSortOrder}`,
          published: true,
        },
  });

  const submit = handleSubmit((values) => {
    const input: AdminReviewInput & { id?: string } = {
      ...(review ? { id: review.id } : {}),
      name: values.name,
      device: values.device,
      text: values.text,
      rating: Math.min(5, Math.max(1, Math.round(Number(values.rating)) || 5)),
      sortOrder: Math.round(Number(values.sortOrder)) || 0,
      published: values.published,
    };
    saveReview.mutate(input, { onSuccess: () => onOpenChange(false) });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(560px,94vw)] max-w-none">
        <DialogHeader>
          <DialogTitle>{review ? 'Edit review' : 'Add review'}</DialogTitle>
          <DialogDescription>
            A real review the shop has actually received. Quote it as given — don’t tidy the
            wording.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="rev-name" error={errors.name?.message}>
              <Input id="rev-name" autoFocus placeholder="e.g. Emma D." {...register('name')} />
            </Field>
            <Field label="Device / service (optional)" htmlFor="rev-device">
              <Input id="rev-device" placeholder="e.g. iPhone 13 screen" {...register('device')} />
            </Field>
          </div>

          <Field label="Review" htmlFor="rev-text" error={errors.text?.message}>
            <Textarea id="rev-text" rows={5} placeholder="What they said" {...register('text')} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Rating (1–5)" htmlFor="rev-rating" error={errors.rating?.message}>
              <Input
                id="rev-rating"
                type="number"
                min="1"
                max="5"
                step="1"
                className="tabular"
                {...register('rating')}
              />
            </Field>
            <Field
              label="Order on the homepage"
              htmlFor="rev-sort"
              hint="Lower numbers show first"
              error={errors.sortOrder?.message}
            >
              <Input
                id="rev-sort"
                type="number"
                step="1"
                className="tabular"
                {...register('sortOrder')}
              />
            </Field>
          </div>

          <label className="flex items-center gap-2.5 text-sm font-semibold">
            <input type="checkbox" className="accent-[var(--red)]" {...register('published')} />
            Published — shows on the homepage
          </label>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : review ? 'Save changes' : 'Add review'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
