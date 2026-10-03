'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Pencil, Plus } from 'lucide-react';
import { useAdminShops, useSaveShop } from '@/lib/data/hooks';
import type { AdminShop } from '@/lib/data/types';
import { Button } from '@/components/ui/button';
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
import { PageHeader } from '@/components/admin/page-header';
import { StatusChip } from '@/components/admin/status-chip';

/**
 * Shops. A new shop is data, not code: add it here, put its people on it from Staff, then switch
 * to it (top of the sidebar) to set its hours, receipt text, float and card limits in Settings.
 * Its stock starts empty — it pulls products from the master list as it trades.
 *
 * Closing a shop hides it from the switcher and stops its stock counting online; the history
 * stays. The shop that fulfils online orders, repairs and trade-ins can't be closed.
 */
export function ShopsView() {
  const { data: shops, isPending, isError, refetch } = useAdminShops();
  const save = useSaveShop();

  const [editing, setEditing] = useState<AdminShop | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Team"
        title="Shops"
        description="Each shop has its own stock, till, float, day close, card limits and printers. Switch between them with the picker at the top of the sidebar."
        actions={
          <Button onClick={openNew}>
            <Plus aria-hidden="true" />
            Add shop
          </Button>
        }
      />

      {isError ? (
        <div className="border-line bg-card rounded-lg border p-8 text-center">
          <p className="text-ink mb-3 text-sm font-semibold">Shops didn’t load.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      ) : isPending ? (
        <div className="grid gap-3">
          <Skeleton className="h-[72px]" />
          <Skeleton className="h-[72px]" />
        </div>
      ) : shops && shops.length > 0 ? (
        <div className="grid gap-2">
          {shops.map((shop) => (
            <article
              key={shop.id}
              className="border-line bg-card flex min-w-0 items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-ink text-sm font-bold">{shop.name}</h2>
                  <span className="bg-paper-2/60 text-muted tabular rounded-md px-2 py-0.5 text-[11px] font-semibold">
                    {shop.code}
                  </span>
                  {shop.isHub ? (
                    <StatusChip tone="accent">Online orders &amp; repairs</StatusChip>
                  ) : null}
                  {shop.isActive ? (
                    <StatusChip tone="success">Open</StatusChip>
                  ) : (
                    <StatusChip tone="neutral">Closed</StatusChip>
                  )}
                </div>
                <p className="text-muted mt-0.5 truncate text-xs">
                  {[shop.address, shop.phone].filter(Boolean).join(' · ') ||
                    'No address or phone yet'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {shop.isHub ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 px-2 text-xs"
                    disabled={save.isPending}
                    onClick={() =>
                      save.mutate({
                        id: shop.id,
                        name: shop.name,
                        code: shop.code,
                        isActive: !shop.isActive,
                      })
                    }
                  >
                    {shop.isActive ? (
                      <>
                        <EyeOff className="size-3.5" aria-hidden="true" />
                        Close
                      </>
                    ) : (
                      <>
                        <Eye className="size-3.5" aria-hidden="true" />
                        Reopen
                      </>
                    )}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                  aria-label={`Edit ${shop.name}`}
                  onClick={() => {
                    setEditing(shop);
                    setDialogOpen(true);
                  }}
                >
                  <Pencil className="size-3.5" />
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No shops yet"
          description="Add your first shop."
          action={<Button onClick={openNew}>Add shop</Button>}
        />
      )}

      <ShopDialog
        key={editing?.id ?? 'new'}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        shop={editing}
      />
    </div>
  );
}

const shopFormSchema = z.object({
  name: z.string().trim().min(2, 'Name the shop'),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,6}$/, 'The code is 1–6 letters or digits'),
  address: z.string().trim(),
  phone: z.string().trim(),
  email: z.string().trim().email('Enter a valid email').or(z.literal('')),
});
type ShopFormValues = z.infer<typeof shopFormSchema>;

function ShopDialog({
  open,
  onOpenChange,
  shop,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shop: AdminShop | null;
}) {
  const save = useSaveShop();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ShopFormValues>({
    resolver: zodResolver(shopFormSchema),
    defaultValues: {
      name: shop?.name ?? '',
      code: shop?.code ?? '',
      address: shop?.address ?? '',
      phone: shop?.phone ?? '',
      email: shop?.email ?? '',
    },
  });

  const submit = handleSubmit((values) => {
    save.mutate(
      {
        ...(shop ? { id: shop.id } : {}),
        name: values.name,
        code: values.code,
        address: values.address || null,
        phone: values.phone || null,
        email: values.email || null,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{shop ? 'Edit shop' : 'Add shop'}</DialogTitle>
          <DialogDescription>
            Opening hours, receipt text, float and card limits are set in Settings with this shop
            picked at the top of the sidebar.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <Field label="Name" htmlFor="shop-name" error={errors.name?.message}>
            <Input
              id="shop-name"
              autoFocus
              placeholder="e.g. Fonology Paisley"
              {...register('name')}
            />
          </Field>
          <Field
            label="Code"
            htmlFor="shop-code"
            error={errors.code?.message}
            hint="Goes in front of this shop’s receipt and job numbers, e.g. S2-FNL-10421. Changing it only affects numbers issued from now on."
          >
            <Input
              id="shop-code"
              className="tabular uppercase"
              maxLength={6}
              placeholder="S2"
              {...register('code')}
            />
          </Field>
          <Field label="Address" htmlFor="shop-address" error={errors.address?.message}>
            <Input id="shop-address" {...register('address')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone" htmlFor="shop-phone" error={errors.phone?.message}>
              <Input id="shop-phone" inputMode="tel" {...register('phone')} />
            </Field>
            <Field label="Email" htmlFor="shop-email" error={errors.email?.message}>
              <Input id="shop-email" type="email" {...register('email')} />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={save.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : shop ? 'Save changes' : 'Add shop'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
