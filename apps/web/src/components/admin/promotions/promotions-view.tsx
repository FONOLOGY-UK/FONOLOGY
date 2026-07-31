'use client';

import { useMemo, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Pencil, Plus, Store, Trash2, X } from 'lucide-react';
import {
  useAdminProducts,
  useDeletePromotionGroup,
  usePromotionGroups,
  useSavePromotionGroup,
} from '@/lib/data/hooks';
import type { PromotionGroup, PromotionGroupInput } from '@/lib/data/types';
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
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { Field } from '@/components/admin/field';
import { ProductPicker } from '@/components/admin/product-picker';
import { PageHeader } from '@/components/admin/page-header';
import { StatusChip } from '@/components/admin/status-chip';

/**
 * Promotions (item 7): tiered bulk pricing, applied AT THE COUNTER only.
 *
 * The database stores one `promotions` row per product; rows saved together
 * share a `group_id`. This screen works in groups — one card is one offer,
 * however many products it covers — and every write goes through
 * `POST /admin/promotions/bulk`, which applies the whole thing in a single
 * transaction. The per-product endpoints it used to call are retired: a loop
 * of independent inserts could leave half a range selling at bulk prices and
 * half at shelf prices, on real sales.
 *
 * Tiers apply to multiples of the SAME product. There is no mixed-basket
 * offer here and no UI that suggests one, because the till doesn't implement
 * one — "any 2 from this range" would be a promise the counter can't keep.
 *
 * The storefront never reads any of this: online prices are always the listed
 * price.
 */
export function PromotionsView() {
  const { data: groups, isPending, isError, refetch } = usePromotionGroups();
  const { data: products } = useAdminProducts();
  const savePromotion = useSavePromotionGroup();
  const deletePromotion = useDeletePromotionGroup();

  const [editing, setEditing] = useState<PromotionGroup | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<PromotionGroup | null>(null);

  const productName = (id: string) => products?.find((p) => p.id === id)?.name ?? 'Unknown product';

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  /**
   * Pausing is a full save of the same offer with `active` flipped — the
   * endpoint replaces the group wholesale, so the tiers and products must go
   * with it or they'd be wiped.
   */
  const toggleActive = (group: PromotionGroup) => {
    savePromotion.mutate({
      groupId: group.groupId,
      label: group.name,
      productIds: group.productIds,
      tiers: group.tiers,
      active: !group.active,
    });
  };

  return (
    <div>
      <PageHeader
        eyebrow="Catalogue"
        title="Promotions"
        description="Bulk price breaks for the counter."
        actions={
          <Button onClick={openNew}>
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
          <Skeleton className="h-[168px]" />
          <Skeleton className="h-[168px]" />
          <Skeleton className="h-[168px]" />
        </div>
      ) : groups && groups.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <PromotionCard
              key={group.groupId}
              group={group}
              productName={productName}
              busy={savePromotion.isPending}
              onToggle={() => toggleActive(group)}
              onEdit={() => {
                setEditing(group);
                setDialogOpen(true);
              }}
              onDelete={() => setDeleting(group)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          title="No promotions"
          description="Set a bulk price break the counter can offer — e.g. two screen protectors for less."
          action={<Button onClick={openNew}>New promotion</Button>}
        />
      )}

      <PromotionDialog
        key={editing?.groupId ?? 'new'}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        group={editing}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        title="Delete this promotion?"
        description={
          deleting
            ? `“${deleting.name}” stops applying at the till immediately, for all ${deleting.productIds.length} product${deleting.productIds.length === 1 ? '' : 's'} it covers.`
            : undefined
        }
        confirmLabel="Delete promotion"
        destructive
        loading={deletePromotion.isPending}
        onConfirm={() => {
          if (!deleting) return;
          deletePromotion.mutate(deleting.groupId, { onSuccess: () => setDeleting(null) });
        }}
      />
    </div>
  );
}

/* ---- one offer ------------------------------------------------------------- */

function PromotionCard({
  group,
  productName,
  busy,
  onToggle,
  onEdit,
  onDelete,
}: {
  group: PromotionGroup;
  productName: (id: string) => string;
  busy: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const names = group.productIds.map(productName);
  const toggleId = `promo-active-${group.groupId}`;

  return (
    <article className="border-line bg-card flex flex-col rounded-lg border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-ink text-sm font-bold">{group.name || 'Untitled promotion'}</h2>
          {/* An offer can cover a whole range — name the first two and count
              the rest rather than wrapping to five lines. */}
          <p className="text-muted text-xs" title={names.join(', ')}>
            {names.slice(0, 2).join(', ')}
            {names.length > 2 ? ` + ${names.length - 2} more` : ''}
          </p>
        </div>
        {group.active ? (
          <StatusChip tone="success">Active</StatusChip>
        ) : (
          <StatusChip tone="neutral">Paused</StatusChip>
        )}
      </div>

      <ul className="my-3 grid gap-1.5">
        {[...group.tiers]
          .sort((a, b) => a.minQty - b.minQty)
          .map((tier) => (
            <li
              key={tier.minQty}
              className="bg-paper-2/60 tabular flex items-center justify-between rounded-md px-2.5 py-1.5 text-[13px]"
            >
              <span className="text-ink-2 font-semibold">Buy {tier.minQty}+</span>
              <span className="text-ink font-bold">
                {tier.unitPrice === 0 ? 'Free' : `${formatGBP(tier.unitPrice)} each`}
              </span>
            </li>
          ))}
      </ul>

      <p className="text-muted mb-3 text-[11px]">
        Per product —{' '}
        {group.tiers.length > 1 ? 'the tier quantity' : `${group.tiers[0]?.minQty ?? 2}`} of the
        same one. Mixing different products doesn’t combine.
      </p>

      <div className="mt-auto flex items-center justify-between">
        <label
          htmlFor={toggleId}
          className="flex cursor-pointer items-center gap-2 text-xs font-semibold"
        >
          <input
            id={toggleId}
            type="checkbox"
            className="accent-[var(--red)]"
            checked={group.active}
            disabled={busy}
            onChange={onToggle}
          />
          Active at the till
        </label>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            aria-label={`Edit ${group.name}`}
            onClick={onEdit}
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted hover:text-red-deep h-8 px-2"
            aria-label={`Delete ${group.name}`}
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
    </article>
  );
}

/* ---- create / edit dialog -------------------------------------------------- */

const tierFormSchema = z.object({
  minQty: z.string().min(1, 'Qty'),
  unitPounds: z.string().min(1, 'Price'),
});

const promoFormSchema = z
  .object({
    name: z.string().trim().min(2, 'Name the promotion'),
    productIds: z.array(z.string()).min(1, 'Pick at least one product'),
    active: z.boolean(),
    tiers: z.array(tierFormSchema).min(1, 'Add at least one tier'),
  })
  // Caught here as well as server-side so the owner sees it beside the field
  // rather than as a toast after a round trip. The database raises on these
  // too — this is convenience, not the guarantee.
  .superRefine((values, ctx) => {
    values.tiers.forEach((tier, i) => {
      const qty = Number(tier.minQty);
      if (!Number.isInteger(qty) || qty < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tiers', i, 'minQty'],
          message: 'Bulk pricing starts at 2 or more',
        });
      }
      const price = Number(tier.unitPounds);
      if (!Number.isFinite(price) || price < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tiers', i, 'unitPounds'],
          message: 'A tier price cannot be negative',
        });
      }
    });

    const quantities = values.tiers.map((t) => Number(t.minQty));
    quantities.forEach((qty, i) => {
      if (quantities.indexOf(qty) !== i) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tiers', i, 'minQty'],
          message: 'Two tiers share this quantity — which price applies would be arbitrary',
        });
      }
    });
  });

type PromoFormValues = z.infer<typeof promoFormSchema>;

function PromotionDialog({
  open,
  onOpenChange,
  group,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: PromotionGroup | null;
}) {
  const savePromotion = useSavePromotionGroup();
  const pending = savePromotion.isPending;

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<PromoFormValues>({
    resolver: zodResolver(promoFormSchema),
    defaultValues: group
      ? {
          name: group.name,
          productIds: group.productIds,
          active: group.active,
          tiers: group.tiers.map((t) => ({
            minQty: `${t.minQty}`,
            unitPounds: (t.unitPrice / 100).toFixed(2),
          })),
        }
      : { name: '', productIds: [], active: true, tiers: [{ minQty: '2', unitPounds: '' }] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'tiers' });
  const productIds = watch('productIds');

  const submit = handleSubmit((values) => {
    const input: PromotionGroupInput = {
      // Present on edit, absent on create — that's the whole create/replace
      // switch, and it's the group id, never a per-product row id.
      ...(group ? { groupId: group.groupId } : {}),
      label: values.name,
      productIds: values.productIds,
      active: values.active,
      // Sent as the complete list: whatever is here replaces what's stored,
      // so a tier removed above is genuinely gone after saving.
      tiers: values.tiers.map((t) => ({
        minQty: Math.round(Number(t.minQty)),
        unitPrice: pounds(Number(t.unitPounds) || 0),
      })),
    };
    savePromotion.mutate(input, { onSuccess: () => onOpenChange(false) });
  });

  const tierCountLabel = useMemo(
    () => (fields.length === 1 ? 'the tier quantity' : 'a tier quantity'),
    [fields.length],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(620px,94vw)] max-w-none">
        <DialogHeader>
          <DialogTitle>{group ? 'Edit promotion' : 'New promotion'}</DialogTitle>
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

          <ProductPicker
            value={productIds}
            onChange={(ids) => setValue('productIds', ids, { shouldValidate: true })}
            error={errors.productIds?.message}
          />

          <div>
            <p className="text-ink mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]">
              Tiers
            </p>
            <p className="text-muted mb-2 text-xs">
              Applies per product — buying {tierCountLabel} of any <em>one</em> selected product
              hits the price. Mixing different products doesn’t combine.
            </p>
            <div className="grid gap-2">
              {fields.map((field, i) => (
                <div key={field.id}>
                  <div className="flex items-center gap-2">
                    <span className="text-muted text-xs font-semibold">Buy</span>
                    <Input
                      type="number"
                      min="2"
                      step="1"
                      className="tabular h-9 w-16"
                      aria-label={`Tier ${i + 1} minimum quantity`}
                      {...register(`tiers.${i}.minQty`)}
                    />
                    <span className="text-muted text-xs font-semibold">+ at £</span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className="tabular h-9 w-24"
                      aria-label={`Tier ${i + 1} unit price in pounds`}
                      {...register(`tiers.${i}.unitPounds`)}
                    />
                    <span className="text-muted text-xs">each</span>
                    {fields.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => remove(i)}
                        className="text-muted hover:text-red-deep ml-auto p-1"
                        aria-label={`Remove tier ${i + 1}`}
                      >
                        <X className="size-4" />
                      </button>
                    ) : null}
                  </div>
                  {errors.tiers?.[i]?.minQty?.message || errors.tiers?.[i]?.unitPounds?.message ? (
                    <p className="text-red-deep mt-1 text-xs">
                      {errors.tiers[i]?.minQty?.message ?? errors.tiers[i]?.unitPounds?.message}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
            {errors.tiers?.message ? (
              <p className="text-red-deep mt-1 text-xs">{errors.tiers.message}</p>
            ) : null}
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
            <p className="text-muted mt-2 text-xs">
              £0 is allowed — that’s a buy-two-get-one-free. Saving replaces the whole list, so a
              tier removed here is removed at the till.
            </p>
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
              {pending ? 'Saving…' : group ? 'Save changes' : 'Create promotion'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
