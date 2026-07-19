'use client';

import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Pencil, Plus, Store, Trash2, X } from 'lucide-react';
import {
  useAdminProducts,
  useCreatePromotion,
  useDeletePromotion,
  usePromotions,
  useUpdatePromotion,
} from '@/lib/data/hooks';
import type { Promotion, PromotionInput } from '@/lib/data/types';
import { formatGBP, pounds } from '@/lib/data/types';
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
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { Field } from '@/components/admin/field';
import { PageHeader } from '@/components/admin/page-header';
import { StatusChip } from '@/components/admin/status-chip';

/**
 * Promotions (item 7): tiered bulk pricing, applied AT THE COUNTER only.
 * The storefront never reads this table — online prices stay the listed
 * price. POS (item 8) is where these fire.
 */
export function PromotionsView() {
  const { data: promotions, isPending, isError, refetch } = usePromotions();
  const { data: products } = useAdminProducts();
  const updatePromotion = useUpdatePromotion();
  const deletePromotion = useDeletePromotion();

  const [editing, setEditing] = useState<Promotion | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<Promotion | null>(null);

  const productName = (id: string) => products?.find((p) => p.id === id)?.name ?? id;

  const toggleActive = (promo: Promotion) => {
    updatePromotion.mutate({
      id: promo.id,
      input: {
        name: promo.name,
        productId: promo.productId,
        tiers: promo.tiers,
        active: !promo.active,
      },
    });
  };

  return (
    <div>
      <PageHeader
        eyebrow="Catalogue"
        title="Promotions"
        description="Bulk price breaks for the counter."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus aria-hidden="true" />
            New promotion
          </Button>
        }
      />

      <div className="border-line bg-blush text-ink-2 mb-4 flex items-center gap-2.5 rounded-lg border px-4 py-3 text-sm">
        <Store className="text-red-deep size-4 shrink-0" aria-hidden="true" />
        <p>
          <strong>Walk-in only.</strong> These prices apply at the till — never online. The shop
          site always charges the listed price.
        </p>
      </div>

      {isError ? (
        <div className="border-line bg-card rounded-lg border p-8 text-center">
          <p className="text-ink mb-3 text-sm font-semibold">Promotions didn’t load.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      ) : isPending ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-[148px]" />
          <Skeleton className="h-[148px]" />
          <Skeleton className="h-[148px]" />
        </div>
      ) : promotions && promotions.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {promotions.map((promo) => (
            <article
              key={promo.id}
              className="border-line bg-card flex flex-col rounded-lg border p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-ink text-sm font-bold">{promo.name}</h2>
                  <p className="text-muted text-xs">{productName(promo.productId)}</p>
                </div>
                {promo.active ? (
                  <StatusChip tone="success">Active</StatusChip>
                ) : (
                  <StatusChip tone="neutral">Paused</StatusChip>
                )}
              </div>
              <ul className="my-3 grid gap-1.5">
                {[...promo.tiers]
                  .sort((a, b) => a.minQty - b.minQty)
                  .map((tier, i) => (
                    <li
                      key={i}
                      className="bg-paper-2/60 tabular flex items-center justify-between rounded-md px-2.5 py-1.5 text-[13px]"
                    >
                      <span className="text-ink-2 font-semibold">Buy {tier.minQty}+</span>
                      <span className="text-ink font-bold">{formatGBP(tier.unitPrice)} each</span>
                    </li>
                  ))}
              </ul>
              <div className="mt-auto flex items-center justify-between">
                <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold">
                  <input
                    type="checkbox"
                    className="accent-[var(--red)]"
                    checked={promo.active}
                    onChange={() => toggleActive(promo)}
                  />
                  Active at the till
                </label>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2"
                    aria-label={`Edit ${promo.name}`}
                    onClick={() => {
                      setEditing(promo);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted hover:text-red-deep h-8 px-2"
                    aria-label={`Delete ${promo.name}`}
                    onClick={() => setDeleting(promo)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No promotions"
          description="Set a bulk price break the counter can offer — e.g. two screen protectors for less."
          action={
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              New promotion
            </Button>
          }
        />
      )}

      <PromotionDialog
        key={editing?.id ?? 'new'}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        promotion={editing}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        title="Delete this promotion?"
        description={
          deleting ? `“${deleting.name}” stops applying at the till immediately.` : undefined
        }
        confirmLabel="Delete promotion"
        destructive
        loading={deletePromotion.isPending}
        onConfirm={() => {
          if (!deleting) return;
          deletePromotion.mutate(deleting.id, { onSuccess: () => setDeleting(null) });
        }}
      />
    </div>
  );
}

/* ---- create / edit dialog -------------------------------------------------- */

const tierFormSchema = z.object({
  minQty: z.string().min(1, 'Qty'),
  unitPounds: z.string().min(1, 'Price'),
});
const promoFormSchema = z.object({
  name: z.string().trim().min(2, 'Name the promotion'),
  productId: z.string().min(1, 'Pick a product'),
  active: z.boolean(),
  tiers: z.array(tierFormSchema).min(1, 'Add at least one tier'),
});
type PromoFormValues = z.infer<typeof promoFormSchema>;

function PromotionDialog({
  open,
  onOpenChange,
  promotion,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  promotion: Promotion | null;
}) {
  const { data: products } = useAdminProducts();
  const createPromotion = useCreatePromotion();
  const updatePromotion = useUpdatePromotion();
  const pending = createPromotion.isPending || updatePromotion.isPending;

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<PromoFormValues>({
    resolver: zodResolver(promoFormSchema),
    defaultValues: promotion
      ? {
          name: promotion.name,
          productId: promotion.productId,
          active: promotion.active,
          tiers: promotion.tiers.map((t) => ({
            minQty: `${t.minQty}`,
            unitPounds: (t.unitPrice / 100).toFixed(2),
          })),
        }
      : { name: '', productId: '', active: true, tiers: [{ minQty: '2', unitPounds: '' }] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'tiers' });

  const submit = handleSubmit((values) => {
    const input: PromotionInput = {
      name: values.name,
      productId: values.productId,
      active: values.active,
      tiers: values.tiers.map((t) => ({
        minQty: Math.max(2, Math.round(Number(t.minQty) || 2)),
        unitPrice: pounds(Number(t.unitPounds) || 0),
      })),
    };
    const done = { onSuccess: () => onOpenChange(false) };
    if (promotion) updatePromotion.mutate({ id: promotion.id, input }, done);
    else createPromotion.mutate(input, done);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{promotion ? 'Edit promotion' : 'New promotion'}</DialogTitle>
          <DialogDescription>Tiered pricing the counter can offer. Walk-in only.</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4">
          <Field label="Name" htmlFor="promo-name" error={errors.name?.message}>
            <Input
              id="promo-name"
              autoFocus
              placeholder="e.g. Tempered glass multi-buy"
              {...register('name')}
            />
          </Field>
          <Field label="Product" htmlFor="promo-product" error={errors.productId?.message}>
            <Select id="promo-product" {...register('productId')}>
              <option value="">Choose a product…</option>
              {products?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {formatGBP(p.price)}
                </option>
              ))}
            </Select>
          </Field>

          <div>
            <p className="text-ink mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]">
              Tiers
            </p>
            <div className="grid gap-2">
              {fields.map((field, i) => (
                <div key={field.id} className="flex items-center gap-2">
                  <span className="text-muted text-xs font-semibold">Buy</span>
                  <Input
                    type="number"
                    min="2"
                    step="1"
                    className="tabular h-9 w-16"
                    aria-label="Minimum quantity"
                    {...register(`tiers.${i}.minQty`)}
                  />
                  <span className="text-muted text-xs font-semibold">+ at £</span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    className="tabular h-9 w-24"
                    aria-label="Unit price in pounds"
                    {...register(`tiers.${i}.unitPounds`)}
                  />
                  <span className="text-muted text-xs">each</span>
                  {fields.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      className="text-muted hover:text-red-deep ml-auto p-1"
                      aria-label="Remove tier"
                    >
                      <X className="size-4" />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => append({ minQty: '', unitPounds: '' })}
            >
              <Plus aria-hidden="true" />
              Add tier
            </Button>
          </div>

          <label className="flex items-center gap-2.5 text-sm font-semibold">
            <input type="checkbox" className="accent-[var(--red)]" {...register('active')} />
            Active at the till
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
              {pending ? 'Saving…' : promotion ? 'Save changes' : 'Create promotion'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
