'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCreateProduct, useUpdateProduct } from '@/lib/data/hooks';
import type { AdminProduct, ProductInput } from '@/lib/data/types';
import { pounds, productCategoryIdSchema, productKindSchema } from '@/lib/data/types';
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
import { Textarea } from '@/components/ui/textarea';
import { Field, UploadField } from '@/components/admin/field';

/**
 * Product create/edit (item 7, Inventory). One dialog, both modes. The
 * "Bought locally" toggle swaps the supplier field for a signed buy-in form
 * upload — a legal record for locally-purchased stock. Uploads are UI mocks
 * (filenames only) until Raja wires storage.
 */

const formSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter a product name'),
    sub: z.string().trim().min(2, 'The short line under the name'),
    category: productCategoryIdSchema,
    kind: productKindSchema,
    pricePounds: z.string().min(1, 'Enter a selling price'),
    costPounds: z.string().min(1, 'Enter the cost price'),
    stockQty: z.string().min(1, 'Enter the stock count'),
    restocking: z.boolean(),
    supplier: z.string().trim().optional(),
    localBuying: z.boolean(),
    buyInForm: z.string().nullable(),
    barcode: z.string().trim().optional(),
    description: z.string().trim().min(10, 'A sentence or two for the product page'),
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
  });
type FormValues = z.infer<typeof formSchema>;

const CATEGORY_OPTIONS = [
  { id: 'cases', label: 'Cases' },
  { id: 'power', label: 'Power' },
  { id: 'audio', label: 'Audio' },
  { id: 'protection', label: 'Protection' },
  { id: 'mounts', label: 'Mounts' },
  { id: 'vape', label: 'Vaping' },
  { id: 'plates', label: 'Number plates' },
] as const;

function toDefaults(product: AdminProduct | null): FormValues {
  if (!product) {
    return {
      name: '',
      sub: '',
      category: 'cases',
      kind: 'accessory',
      pricePounds: '',
      costPounds: '',
      stockQty: '0',
      restocking: false,
      supplier: '',
      localBuying: false,
      buyInForm: null,
      barcode: '',
      description: '',
      tag: '',
      compatibility: '',
      images: [],
    };
  }
  return {
    name: product.name,
    sub: product.sub,
    category: product.category,
    kind: product.kind,
    pricePounds: (product.price / 100).toFixed(2),
    costPounds: (product.costPrice / 100).toFixed(2),
    stockQty: `${product.stockQty}`,
    restocking: product.stockStatus === 'restocking',
    supplier: product.supplier ?? '',
    localBuying: product.localBuying,
    buyInForm: product.buyInForm,
    barcode: product.barcode ?? '',
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
  const pending = createProduct.isPending || updateProduct.isPending;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: toDefaults(product),
  });

  // Re-seed the form whenever a different product is opened.
  useEffect(() => {
    if (open) reset(toDefaults(product));
  }, [open, product, reset]);

  const localBuying = watch('localBuying');
  const stockQty = Number(watch('stockQty') || 0);
  const images = watch('images');

  const submit = handleSubmit((values) => {
    const input: ProductInput = {
      name: values.name,
      sub: values.sub,
      category: values.category,
      kind: values.kind,
      price: pounds(Number(values.pricePounds) || 0),
      costPrice: pounds(Number(values.costPounds) || 0),
      stockQty: Math.max(0, Math.round(Number(values.stockQty) || 0)),
      restocking: values.restocking,
      supplier: values.supplier,
      localBuying: values.localBuying,
      buyInForm: values.buyInForm ?? undefined,
      barcode: values.barcode,
      description: values.description,
      tag: values.tag,
      compatibility: values.compatibility,
      images: values.images,
    };
    const done = { onSuccess: () => onOpenChange(false) };
    if (product) updateProduct.mutate({ id: product.id, input }, done);
    else createProduct.mutate(input, done);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
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
            <Field label="Category" htmlFor="p-category">
              <Select id="p-category" {...register('category')}>
                {CATEGORY_OPTIONS.map((c) => (
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

          <div className="border-line rounded-ui border p-3">
            <label className="flex items-center gap-2.5 text-sm font-semibold">
              <input type="checkbox" className="accent-[var(--red)]" {...register('localBuying')} />
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

          <Field label="Description" htmlFor="p-desc" error={errors.description?.message}>
            <Textarea
              id="p-desc"
              placeholder="What goes on the product page."
              {...register('description')}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Badge (optional)" htmlFor="p-tag">
              <Input id="p-tag" placeholder="e.g. Bestseller" {...register('tag')} />
            </Field>
            <Field label="Compatibility (optional)" htmlFor="p-compat">
              <Input id="p-compat" placeholder="e.g. iPhone 13–15" {...register('compatibility')} />
            </Field>
          </div>

          <Field
            label="Photos"
            htmlFor="p-image"
            hint="Upload UI only for now — photography is wired with the backend"
          >
            <div className="grid gap-2">
              <UploadField
                id="p-image"
                value={null}
                onChange={(name) => {
                  if (name) setValue('images', [...images, name]);
                }}
                accept="image/*"
                emptyLabel="Add a photo…"
              />
              {images.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5">
                  {images.map((img, i) => (
                    <li
                      key={`${img}-${i}`}
                      className="bg-paper-2 text-ink-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs"
                    >
                      <span className="max-w-[140px] truncate">{img}</span>
                      <button
                        type="button"
                        className="text-muted hover:text-red-deep font-bold"
                        onClick={() =>
                          setValue(
                            'images',
                            images.filter((_, j) => j !== i),
                          )
                        }
                        aria-label={`Remove ${img}`}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </Field>

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
              {pending ? 'Saving…' : product ? 'Save changes' : 'Add product'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
