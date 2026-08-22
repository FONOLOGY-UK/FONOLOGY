'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  useAdminCategories,
  useCreateProduct,
  useUpdateProduct,
  useUploadProductImage,
} from '@/lib/data/hooks';
import type { AdminProduct, ProductInput } from '@/lib/data/types';
import { pounds, productKindSchema } from '@/lib/data/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field, UploadField } from '@/components/admin/field';
import { RichTextEditor, htmlToText, sanitizeHtml } from '@/components/admin/rich-text';
import { cn } from '@/lib/utils';

/**
 * Product create/edit (item 7, Inventory). One dialog, both modes. The
 * "Bought locally" toggle swaps the supplier field for a signed buy-in form
 * upload — a legal record for locally-purchased stock, still a UI mock
 * (filename only). Photos are real now (BUG-01 follow-up) — a real upload to
 * Supabase Storage via `useUploadProductImage()`, the form only ever holding
 * the real public URLs it comes back with.
 */

/** Matches the server's own cap (productImages.ts) — checked here too so a
 * too-large file never leaves the browser at all. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

interface PendingUpload {
  key: string;
  name: string;
  status: 'uploading' | 'failed';
  error?: string;
}

const formSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter a product name'),
    sub: z.string().trim().min(2, 'The short line under the name'),
    categoryId: z.string().min(1, 'Choose a category'),
    kind: productKindSchema,
    pricePounds: z.string().min(1, 'Enter a selling price'),
    costPounds: z.string().min(1, 'Enter the cost price'),
    stockQty: z.string().min(1, 'Enter the stock count'),
    restocking: z.boolean(),
    supplier: z.string().trim().optional(),
    localBuying: z.boolean(),
    buyInForm: z.string().nullable(),
    barcode: z.string().trim().optional(),
    lowStockAlert: z.boolean(),
    // Kept as a string like the other numeric inputs; only enforced when the
    // alert is on, so switching it off never blocks the save.
    lowStockThreshold: z.string(),
    inStoreOnly: z.boolean(),
    // Rich text: validate the readable words, not the markup.
    description: z
      .string()
      .refine((v) => htmlToText(v).length >= 10, 'A sentence or two for the product page'),
    tag: z.string().trim().optional(),
    compatibility: z.string().trim().optional(),
    images: z.array(z.string()),
  })
  .refine((v) => v.localBuying || (v.supplier && v.supplier.length > 1), {
    message: 'Enter the supplier name',
    path: ['supplier'],
  })
  .refine((v) => !v.localBuying || (v.buyInForm && v.buyInForm.length > 0), {
    message: 'Upload the signed buy-in form',
    path: ['buyInForm'],
  })
  .refine((v) => !v.lowStockAlert || Math.round(Number(v.lowStockThreshold) || 0) >= 1, {
    message: 'Enter the count to warn at (1 or more)',
    path: ['lowStockThreshold'],
  });
type FormValues = z.infer<typeof formSchema>;

function toDefaults(product: AdminProduct | null): FormValues {
  if (!product) {
    return {
      name: '',
      sub: '',
      // No sensible default — categories are admin-editable now (FEATURE-05),
      // not a fixed 7-value list to pick a first entry from. The select
      // shows a "Choose a category…" placeholder; formSchema's min(1)
      // blocks submitting without a real pick.
      categoryId: '',
      kind: 'accessory',
      pricePounds: '',
      costPounds: '',
      stockQty: '0',
      restocking: false,
      supplier: '',
      localBuying: false,
      buyInForm: null,
      barcode: '',
      lowStockAlert: true,
      lowStockThreshold: '5',
      inStoreOnly: false,
      description: '',
      tag: '',
      compatibility: '',
      images: [],
    };
  }
  return {
    name: product.name,
    sub: product.sub,
    // Falls back to '' (not product.category, the display slug) if an
    // older cached row predates categoryId — the select then shows the
    // placeholder rather than silently keeping a stale category on save.
    categoryId: product.categoryId ?? '',
    kind: product.kind,
    pricePounds: (product.price / 100).toFixed(2),
    costPounds: (product.costPrice / 100).toFixed(2),
    stockQty: `${product.stockQty}`,
    restocking: product.stockStatus === 'restocking',
    supplier: product.supplier ?? '',
    localBuying: product.localBuying,
    buyInForm: product.buyInForm,
    barcode: product.barcode ?? '',
    lowStockAlert: product.lowStockAlert,
    lowStockThreshold: `${product.lowStockThreshold}`,
    inStoreOnly: product.inStoreOnly ?? false,
    description: product.description,
    tag: product.tag ?? '',
    compatibility: product.compatibility ?? '',
    images: product.images,
  };
}

export function ProductDialog({
  open,
  onOpenChange,
  product,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create mode. */
  product: AdminProduct | null;
}) {
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const uploadImage = useUploadProductImage();
  const { data: categories } = useAdminCategories();
  const pending = createProduct.isPending || updateProduct.isPending;
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: toDefaults(product),
  });

  // Re-seed the form whenever a different product is opened.
  useEffect(() => {
    if (open) {
      reset(toDefaults(product));
      setPendingUploads([]);
    }
  }, [open, product, reset]);

  const localBuying = watch('localBuying');
  const lowStockAlert = watch('lowStockAlert');
  const stockQty = Number(watch('stockQty') || 0);
  const images = watch('images');

  /** One file, uploaded for real — client-side checks first so a rejected
   * file never even reaches the network, then the same checks the server
   * enforces regardless (productImages.ts). */
  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      const key = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
        setPendingUploads((p) => [
          ...p,
          { key, name: file.name, status: 'failed', error: 'Not a JPEG, PNG, WebP or GIF' },
        ]);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setPendingUploads((p) => [
          ...p,
          { key, name: file.name, status: 'failed', error: 'Larger than 8MB' },
        ]);
        continue;
      }
      setPendingUploads((p) => [...p, { key, name: file.name, status: 'uploading' }]);
      uploadImage.mutate(file, {
        onSuccess: (url) => {
          setValue('images', [...getValues('images'), url], { shouldValidate: true });
          setPendingUploads((p) => p.filter((u) => u.key !== key));
        },
        onError: (error) => {
          setPendingUploads((p) =>
            p.map((u) =>
              u.key === key
                ? { ...u, status: 'failed', error: error.message || 'Upload failed' }
                : u,
            ),
          );
        },
      });
    }
  };

  const submit = handleSubmit((values) => {
    const input: ProductInput = {
      name: values.name,
      sub: values.sub,
      categoryId: values.categoryId,
      kind: values.kind,
      price: pounds(Number(values.pricePounds) || 0),
      costPrice: pounds(Number(values.costPounds) || 0),
      stockQty: Math.max(0, Math.round(Number(values.stockQty) || 0)),
      restocking: values.restocking,
      supplier: values.supplier,
      localBuying: values.localBuying,
      buyInForm: values.buyInForm ?? undefined,
      barcode: values.barcode,
      lowStockAlert: values.lowStockAlert,
      lowStockThreshold: Math.max(1, Math.round(Number(values.lowStockThreshold) || 5)),
      inStoreOnly: values.inStoreOnly,
      description: sanitizeHtml(values.description),
      tag: values.tag,
      compatibility: values.compatibility,
      // Real public Storage URLs now (BUG-01 follow-up) — handleFiles()
      // only ever pushes a URL onto this array after a real upload has
      // actually succeeded, never a raw filename. Still passes through
      // productInputBodySchema's own `.url()` validation server-side
      // regardless — this isn't a substitute for that, just what makes it
      // stop being the only thing catching a bad value.
      images: values.images,
    };
    const done = { onSuccess: () => onOpenChange(false) };
    if (product) updateProduct.mutate({ id: product.id, input }, done);
    else createProduct.mutate(input, done);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Wider than the default dialog: this form has a lot of fields and the
          narrow column made it feel like a questionnaire. */}
      <DialogContent className="w-[min(1080px,94vw)] max-w-none">
        <DialogHeader>
          <DialogTitle>{product ? 'Edit product' : 'Add product'}</DialogTitle>
          <DialogDescription>
            {product
              ? `Editing ${product.name}. The shop page updates as soon as you save.`
              : 'New stock for the shelf and the online shop.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="p-name" error={errors.name?.message}>
              <Input
                id="p-name"
                autoFocus
                placeholder="e.g. Aegis Mag Case"
                {...register('name')}
              />
            </Field>
            <Field label="Short line" htmlFor="p-sub" error={errors.sub?.message}>
              <Input id="p-sub" placeholder="e.g. iPhone 15 / 15 Pro" {...register('sub')} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Category" htmlFor="p-category" error={errors.categoryId?.message}>
              <Select id="p-category" {...register('categoryId')}>
                <option value="" disabled>
                  Choose a category…
                </option>
                {(categories ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Kind"
              htmlFor="p-kind"
              hint="Vapes are in-store only; plates need ID checks"
            >
              <Select id="p-kind" {...register('kind')}>
                <option value="accessory">Accessory</option>
                <option value="vape">Vape (in-store only)</option>
                <option value="plate">Number plate</option>
              </Select>
            </Field>
            <Field label="Barcode" htmlFor="p-barcode" hint="Scan into this field">
              <Input
                id="p-barcode"
                className="tabular"
                placeholder="EAN / UPC"
                {...register('barcode')}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Selling price (£)" htmlFor="p-price" error={errors.pricePounds?.message}>
              <Input
                id="p-price"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                className="tabular"
                {...register('pricePounds')}
              />
            </Field>
            <Field label="Cost price (£)" htmlFor="p-cost" error={errors.costPounds?.message}>
              <Input
                id="p-cost"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                className="tabular"
                {...register('costPounds')}
              />
            </Field>
            <Field label="Stock count" htmlFor="p-qty" error={errors.stockQty?.message}>
              <Input
                id="p-qty"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                className="tabular"
                {...register('stockQty')}
              />
            </Field>
          </div>

          {stockQty === 0 ? (
            <label className="border-line bg-paper-2/50 rounded-ui flex items-center gap-2.5 border px-3 py-2.5 text-sm">
              <input type="checkbox" className="accent-[var(--red)]" {...register('restocking')} />
              <span>
                Show as <strong>“Restocking”</strong> on the shop (instead of “Out of stock”)
              </span>
            </label>
          ) : null}

          {/* Low-stock alert — per product, not a shop-wide dial. A cable that
              sells daily and a plate that sells monthly need different rules. */}
          <div className="border-line rounded-ui border p-3">
            <label className="flex items-center gap-2.5 text-sm font-semibold">
              <input
                type="checkbox"
                className="accent-[var(--red)]"
                {...register('lowStockAlert')}
              />
              Warn me when this product runs low
            </label>
            {lowStockAlert ? (
              <div className="mt-3 flex flex-wrap items-center gap-2.5 text-sm">
                <label htmlFor="p-lowstock" className="text-muted">
                  Warn at or below
                </label>
                <Input
                  id="p-lowstock"
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  className="tabular h-9 w-24"
                  {...register('lowStockThreshold')}
                />
                <span className="text-muted">in stock</span>
                {errors.lowStockThreshold ? (
                  <p role="alert" className="text-red-deep basis-full text-xs font-medium">
                    {errors.lowStockThreshold.message}
                  </p>
                ) : (
                  <p className="text-muted basis-full text-xs">
                    Flags the product in Inventory and on the dashboard. It never shows on the shop.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-muted mt-2 text-xs">
                No low-stock warning for this product, whatever the count drops to.
              </p>
            )}
          </div>

          {/* In-store only — a third, independent visibility state. Not the
              same as "Bought locally" (sourcing) and not the same as the vape
              kind (still listed online, just excluded from cart logic) —
              this hides the product from the storefront entirely while
              leaving it fully sellable at the till. */}
          <div className="border-line rounded-ui border p-3">
            <label className="flex items-center gap-2.5 text-sm font-semibold">
              <input type="checkbox" className="accent-[var(--red)]" {...register('inStoreOnly')} />
              In-store only
            </label>
            <p className="text-muted mt-2 text-xs">
              Hidden from the shop and search — customers can’t find or order it online. Still shows
              in Inventory and the till, and staff can sell it as normal.
            </p>
          </div>

          {/* Two columns on wide screens: sourcing + copy on the left,
              merchandising + photos on the right. */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="grid content-start gap-4">
              <div className="border-line rounded-ui border p-3">
                <label className="flex items-center gap-2.5 text-sm font-semibold">
                  <input
                    type="checkbox"
                    className="accent-[var(--red)]"
                    {...register('localBuying')}
                  />
                  Bought locally (no supplier)
                </label>
                <div className="mt-3">
                  {localBuying ? (
                    <Field
                      label="Signed buy-in form"
                      htmlFor="p-buyin"
                      error={errors.buyInForm?.message}
                      hint="Kept on record for locally-purchased stock"
                    >
                      <UploadField
                        id="p-buyin"
                        value={watch('buyInForm')}
                        onChange={(name) => setValue('buyInForm', name, { shouldValidate: true })}
                        accept="image/*,.pdf"
                        emptyLabel="Upload the signed form…"
                      />
                    </Field>
                  ) : (
                    <Field label="Supplier" htmlFor="p-supplier" error={errors.supplier?.message}>
                      <Input
                        id="p-supplier"
                        placeholder="e.g. Northline Trade Ltd"
                        {...register('supplier')}
                      />
                    </Field>
                  )}
                </div>
              </div>

              <Field
                label="Description"
                htmlFor="p-desc"
                error={errors.description?.message}
                hint="Paste from a doc or an AI tool — bold, italics and lists are kept."
              >
                <RichTextEditor
                  id="p-desc"
                  value={watch('description')}
                  onChange={(html) => setValue('description', html, { shouldValidate: true })}
                  placeholder="What goes on the product page."
                />
              </Field>
            </div>

            <div className="grid content-start gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Badge (optional)" htmlFor="p-tag">
                  <Input id="p-tag" placeholder="e.g. Bestseller" {...register('tag')} />
                </Field>
                <Field label="Compatibility (optional)" htmlFor="p-compat">
                  <Input
                    id="p-compat"
                    placeholder="e.g. iPhone 13–15"
                    {...register('compatibility')}
                  />
                </Field>
              </div>

              <Field label="Photos" htmlFor="p-image" hint="JPEG, PNG, WebP or GIF, up to 8MB each">
                <div className="grid gap-2">
                  <label
                    htmlFor="p-image"
                    className="border-input rounded-ui bg-card text-foreground hover:bg-secondary inline-flex h-10 w-fit cursor-pointer items-center gap-2 border px-3 text-sm transition-colors"
                  >
                    <span className="bg-paper-2 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase">
                      Upload
                    </span>
                    <span>Add a photo…</span>
                  </label>
                  <input
                    id="p-image"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    multiple
                    className="sr-only"
                    onChange={(e) => {
                      handleFiles(e.target.files);
                      e.target.value = ''; // lets the same file be re-picked after a failure
                    }}
                  />

                  {images.length > 0 || pendingUploads.length > 0 ? (
                    <ul className="flex flex-wrap gap-2">
                      {images.map((url, i) => (
                        <li key={url} className="group relative">
                          {/* eslint-disable-next-line @next/next/no-img-element -- real, arbitrary Supabase Storage URLs; next/image's remote-pattern allowlist isn't worth it for an admin-only thumbnail */}
                          <img
                            src={url}
                            alt=""
                            className="border-line size-16 rounded-md border object-cover"
                          />
                          <button
                            type="button"
                            className="bg-void text-bone absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full text-xs font-bold opacity-0 transition-opacity group-hover:opacity-100"
                            onClick={() =>
                              setValue(
                                'images',
                                images.filter((_, j) => j !== i),
                              )
                            }
                            aria-label="Remove photo"
                          >
                            ×
                          </button>
                        </li>
                      ))}
                      {pendingUploads.map((u) => (
                        <li
                          key={u.key}
                          className={cn(
                            'flex size-16 flex-col items-center justify-center rounded-md border p-1 text-center text-[10px] leading-tight',
                            u.status === 'failed'
                              ? 'border-red-deep/40 bg-red-tint text-red-deep'
                              : 'border-line bg-paper-2 text-muted',
                          )}
                          title={u.name}
                        >
                          {u.status === 'uploading' ? (
                            <span>Uploading…</span>
                          ) : (
                            <>
                              <span className="font-semibold">Failed</span>
                              <span className="truncate">{u.error}</span>
                              <button
                                type="button"
                                className="text-red-deep underline underline-offset-2"
                                onClick={() =>
                                  setPendingUploads((p) => p.filter((x) => x.key !== u.key))
                                }
                              >
                                Dismiss
                              </button>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </Field>
            </div>
          </div>

          <div className="border-line flex justify-end gap-2 border-t pt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || pendingUploads.some((u) => u.status === 'uploading')}
            >
              {pending
                ? 'Saving…'
                : pendingUploads.some((u) => u.status === 'uploading')
                  ? 'Uploading photos…'
                  : product
                    ? 'Save changes'
                    : 'Add product'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
