'use client';

import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  useAdminCategories,
  useBuyInFormDownloadUrl,
  useCreateProduct,
  useDeleteProductImage,
  useUpdateProduct,
  useUploadBuyInForm,
  useUploadProductImage,
} from '@/lib/data/hooks';
import type { AdminProduct, ProductInput } from '@/lib/data/types';
import { pounds, productKindSchema } from '@/lib/data/types';
import { Download, Loader2 } from 'lucide-react';
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
import { Field } from '@/components/admin/field';
import { RichTextEditor, htmlToText, sanitizeHtml } from '@/components/admin/rich-text';
import { ImageCropDialog } from './image-crop-dialog';
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

/**
 * BUG-15 hardening: a real photo can be several MB and staff can select a
 * whole album at once. Twenty simultaneous multipart POSTs is twenty
 * multer memory buffers alive on the API at the same moment and twenty
 * connections queued behind the browser's per-origin cap either way — capping
 * how many are truly in flight keeps a big batch reliable instead of merely
 * possible. Everything still gets uploaded; this only changes how many run
 * at once, not the outcome.
 */
const MAX_CONCURRENT_UPLOADS = 4;

/** Round 3 #5.1: the server pads anything within this and rejects anything
 * over it — checked here first too, same reasoning as MAX_IMAGE_BYTES,
 * so an oversized file is routed straight to the crop tool instead of
 * making a round trip just to be told to crop it. */
const MAX_DIMENSION = 1500;

interface PendingUpload {
  key: string;
  name: string;
  file: File;
  status: 'queued' | 'uploading' | 'failed' | 'needs-crop';
  error?: string;
}

/** Natural pixel size of an image file, without ever attaching it to the DOM. */
async function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
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
    // Rich text: validate the readable words, not the markup. Length check
    // moves into the cross-field .refine below (Round 5 #13) — it only
    // applies when the field is actually visible; an in-store-only product
    // hides Description entirely, and requiring 10 real characters in a
    // field nobody can see or edit was a genuine dead end for a brand-new
    // in-store-only product (nothing to untick to fix it).
    description: z.string(),
    tag: z.string().trim().optional(),
    compatibility: z.string().trim().optional(),
    images: z.array(z.string()),
  })
  // Keep in step with productInputSchema (types/inventory.ts) — same rule,
  // same wording. Naming the "Bought locally" tick-box matters: without it
  // the message reads as "this product must have a supplier", which isn't
  // true and leaves no clue what to do about it.
  .refine((v) => v.localBuying || (v.supplier && v.supplier.length > 1), {
    message: "Enter a supplier name, or tick 'Bought locally'",
    path: ['supplier'],
  })
  .refine((v) => !v.localBuying || (v.buyInForm && v.buyInForm.length > 0), {
    message: 'Upload the signed buy-in form',
    path: ['buyInForm'],
  })
  .refine((v) => v.inStoreOnly || htmlToText(v.description).length >= 10, {
    message: 'A sentence or two for the product page',
    path: ['description'],
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
  const deleteImage = useDeleteProductImage();
  const uploadBuyInForm = useUploadBuyInForm();
  const downloadBuyInForm = useBuyInFormDownloadUrl();
  const { data: categories } = useAdminCategories();
  const pending = createProduct.isPending || updateProduct.isPending;
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);

  // Work queue for MAX_CONCURRENT_UPLOADS, and a per-open "session" id so an
  // upload that was still in flight when the dialog was closed (or reopened
  // for a different product) can't land its result on whatever happens to
  // be open by the time it settles — see the `open` effect and pumpQueue below.
  const uploadQueueRef = useRef<{ key: string; file: File }[]>([]);
  const activeUploadsRef = useRef(0);
  const sessionRef = useRef(0);
  // Public URLs uploaded THIS session and not yet either removed or saved —
  // exactly the set that's orphaned in Storage if the dialog closes without
  // saving. Cleaned up in closeDialog(); cleared (not deleted) on a save.
  const sessionUploadedUrlsRef = useRef<Set<string>>(new Set());

  // Round 3 #5.1: files waiting for the crop tool, separate from the upload
  // queue — only one crop modal is ever open at once, regardless of how many
  // oversized files were picked in one go.
  const cropQueueRef = useRef<{ key: string; file: File }[]>([]);
  const [activeCrop, setActiveCrop] = useState<{ key: string; file: File; url: string } | null>(
    null,
  );
  // Round 3 #2 follow-up: pumpCropQueue used to gate on the `activeCrop`
  // STATE value, read through the closure captured when handleFiles kicked
  // off enqueueFile for each file. With several oversized files picked
  // together, their `getImageDimensions` awaits can all resolve before React
  // gets a chance to re-render and hand out a closure that's seen the first
  // one's setActiveCrop — so every one of them reads the same stale (null)
  // `activeCrop`, decides the crop modal is free, shifts a file off the
  // queue and calls setActiveCrop itself. Those calls all land in the same
  // batch, so only the LAST one's file actually ends up as activeCrop — the
  // others were already shifted out of cropQueueRef (never re-added) and
  // marked 'needs-crop' in pendingUploads, so they never get a dialog and
  // sit stuck forever. Exactly the shared-mutable-state-via-stale-closure
  // shape as the Round 2 upload bug — same fix: gate on a ref, which is
  // always current, never on state read through a closure.
  const activeCropRef = useRef<{ key: string; file: File; url: string } | null>(null);

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

  // Re-seed the form whenever a different product is opened. Bumping
  // sessionRef here is what stops a still-in-flight upload from an earlier
  // open landing its result on whatever product happens to be open now —
  // pumpQueue captures sessionRef.current at dequeue time and checks it's
  // unchanged before touching form state or pendingUploads on completion.
  useEffect(() => {
    if (open) {
      reset(toDefaults(product));
      setPendingUploads([]);
      uploadQueueRef.current = [];
      activeUploadsRef.current = 0;
      sessionUploadedUrlsRef.current.clear();
      sessionRef.current += 1;
      cropQueueRef.current = [];
      activeCropRef.current = null;
      setActiveCrop((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return null;
      });
    }
  }, [open, product, reset]);

  const localBuying = watch('localBuying');
  const lowStockAlert = watch('lowStockAlert');
  const stockQty = Number(watch('stockQty') || 0);
  const images = watch('images');
  const inStoreOnly = watch('inStoreOnly');

  /**
   * Pulls up to MAX_CONCURRENT_UPLOADS off the queue and starts them. Each
   * one is driven through `mutateAsync` and settled with `.then(onSuccess,
   * onError)` on THAT call's own promise — never the shared
   * `mutate(file, { onSuccess, onError })` form, which is what let one
   * upload's result get delivered under a different file's key when several
   * were in flight together (see the comment on useUploadProductImage).
   * Every branch — success, failure, or a session change while it was in
   * flight — ends by decrementing activeUploadsRef and calling pumpQueue
   * again, so the queue always keeps draining and a slot is never
   * permanently lost to a single bad upload.
   */
  const pumpQueue = () => {
    while (activeUploadsRef.current < MAX_CONCURRENT_UPLOADS && uploadQueueRef.current.length > 0) {
      const next = uploadQueueRef.current.shift();
      if (!next) break;
      const session = sessionRef.current;
      activeUploadsRef.current += 1;
      setPendingUploads((p) =>
        p.map((u) => (u.key === next.key ? { ...u, status: 'uploading', error: undefined } : u)),
      );
      uploadImage
        .mutateAsync(next.file)
        .then(
          (url) => {
            if (sessionRef.current !== session) {
              // The dialog closed (or moved to a different product) while this
              // was still in flight — it finished a moment too late to be in
              // sessionUploadedUrlsRef when closeDialog() ran its cleanup pass,
              // so it would otherwise sit in Storage forever attached to
              // nothing. Delete it now instead of ever attaching it.
              deleteImage.mutate(url);
              return;
            }
            sessionUploadedUrlsRef.current.add(url);
            setValue('images', [...getValues('images'), url], { shouldValidate: true });
            setPendingUploads((p) => p.filter((u) => u.key !== next.key));
          },
          (error: unknown) => {
            if (sessionRef.current !== session) return;
            const message =
              error instanceof Error && error.message ? error.message : 'Upload failed';
            setPendingUploads((p) =>
              p.map((u) => (u.key === next.key ? { ...u, status: 'failed', error: message } : u)),
            );
          },
        )
        .finally(() => {
          activeUploadsRef.current = Math.max(0, activeUploadsRef.current - 1);
          pumpQueue();
        });
    }
  };

  /** Opens the crop tool for the next file waiting on it, if none is open
   * already — only ever one modal at a time, regardless of batch size. Gates
   * on activeCropRef, not the `activeCrop` state — several enqueueFile calls
   * finishing close together all call this from closures made before any of
   * them had re-rendered, so a state read here would still show the old
   * (null) value for every one of them. The ref is set synchronously in the
   * same tick as the shift, so a second call in that tick sees it. */
  const pumpCropQueue = () => {
    if (activeCropRef.current || cropQueueRef.current.length === 0) return;
    const next = cropQueueRef.current.shift();
    if (!next) return;
    const entry = { key: next.key, file: next.file, url: URL.createObjectURL(next.file) };
    activeCropRef.current = entry;
    setActiveCrop(entry);
  };

  /**
   * Round 3 #5.1: routes one already-type/size-checked file to either the
   * normal upload queue (already within 1500x1500, the server pads it) or
   * the crop queue (bigger than that in either dimension — staff crop it
   * in-app first). Shared by handleFiles (new picks) and retryUpload (a
   * failed one going again) so neither path can skip the size check the
   * other applies.
   */
  const enqueueFile = async (key: string, file: File) => {
    let dims: { width: number; height: number };
    try {
      dims = await getImageDimensions(file);
    } catch {
      setPendingUploads((p) =>
        p.map((u) =>
          u.key === key ? { ...u, status: 'failed', error: 'Could not read this image' } : u,
        ),
      );
      return;
    }
    if (dims.width > MAX_DIMENSION || dims.height > MAX_DIMENSION) {
      setPendingUploads((p) =>
        p.map((u) => (u.key === key ? { ...u, status: 'needs-crop', error: undefined } : u)),
      );
      cropQueueRef.current.push({ key, file });
      pumpCropQueue();
      return;
    }
    setPendingUploads((p) =>
      p.map((u) => (u.key === key ? { ...u, status: 'queued', error: undefined } : u)),
    );
    uploadQueueRef.current.push({ key, file });
    pumpQueue();
  };

  /** One file, queued for real — client-side checks first so a rejected
   * file never even reaches the network, then the same checks the server
   * enforces regardless (productImages.ts). Valid files join the queue and
   * pumpQueue decides when each actually starts; oversized ones go to the
   * crop tool instead (enqueueFile). */
  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      const key = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
        setPendingUploads((p) => [
          ...p,
          { key, name: file.name, file, status: 'failed', error: 'Not a JPEG, PNG, WebP or GIF' },
        ]);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setPendingUploads((p) => [
          ...p,
          { key, name: file.name, file, status: 'failed', error: 'Larger than 8MB' },
        ]);
        continue;
      }
      setPendingUploads((p) => [...p, { key, name: file.name, file, status: 'queued' }]);
      void enqueueFile(key, file);
    }
  };

  /** Re-checks and re-queues a failed upload without making staff re-pick
   * the file — the File object is still sitting on the pending entry from
   * when it failed. Goes back through enqueueFile, not straight to the
   * upload queue: a failure from being too large still needs the crop
   * tool, not a second doomed attempt. */
  const retryUpload = (upload: PendingUpload) => {
    setPendingUploads((p) =>
      p.map((u) => (u.key === upload.key ? { ...u, status: 'queued', error: undefined } : u)),
    );
    void enqueueFile(upload.key, upload.file);
  };

  /** The crop tool produced a result — swap the original oversized file for
   * the cropped one and send it into the normal upload queue. */
  const onCropped = (blob: Blob) => {
    if (!activeCrop) return;
    const { key, url } = activeCrop;
    const croppedFile = new File([blob], activeCrop.file.name, { type: 'image/png' });
    URL.revokeObjectURL(url);
    activeCropRef.current = null;
    setActiveCrop(null);
    setPendingUploads((p) =>
      p.map((u) => (u.key === key ? { ...u, file: croppedFile, status: 'queued' } : u)),
    );
    uploadQueueRef.current.push({ key, file: croppedFile });
    pumpQueue();
    pumpCropQueue();
  };

  /** Staff chose not to crop this one — it's dropped, same as Dismiss on a
   * failed upload; nothing was ever uploaded for it. */
  const onCropCancelled = () => {
    if (!activeCrop) return;
    const { key, url } = activeCrop;
    URL.revokeObjectURL(url);
    activeCropRef.current = null;
    setActiveCrop(null);
    setPendingUploads((p) => p.filter((u) => u.key !== key));
    pumpCropQueue();
  };

  /** Drops a photo from the form. If this session uploaded it and it was
   * never saved anywhere else, also deletes it from Storage — otherwise
   * clicking × just leaves it as an orphan forever (BUG-15). A pre-existing
   * photo from the product being edited is only ever removed from the form
   * array here; the file itself stays exactly as valid as the still-saved
   * product until an actual save changes that. */
  const removeImage = (url: string) => {
    setValue(
      'images',
      images.filter((u) => u !== url),
    );
    if (sessionUploadedUrlsRef.current.has(url)) {
      sessionUploadedUrlsRef.current.delete(url);
      deleteImage.mutate(url);
    }
  };

  /**
   * The one place the dialog closes. `saved` distinguishes "the product was
   * actually created/updated" from every other way out (Cancel, backdrop,
   * Escape) — only the latter leaves this session's uploads orphaned.
   *
   * Bumping sessionRef here (not just on the next open) matters for an
   * upload that's still mid-flight right now: pumpQueue's success handler
   * checks the session on completion, so once it sees this one has moved
   * on, it deletes that image itself instead of attaching it to a form
   * that's gone — covering the timing gap the loop below can't (it only
   * sees uploads that had already finished by the time Cancel was clicked).
   */
  const closeDialog = (saved: boolean) => {
    if (!saved) {
      for (const url of sessionUploadedUrlsRef.current) deleteImage.mutate(url);
    }
    sessionUploadedUrlsRef.current.clear();
    sessionRef.current += 1;
    onOpenChange(false);
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
    const done = { onSuccess: () => closeDialog(true) };
    if (product) updateProduct.mutate({ id: product.id, input }, done);
    else createProduct.mutate(input, done);
  });

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => (next ? undefined : closeDialog(false))}>
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
              <Field
                label="Selling price (£)"
                htmlFor="p-price"
                error={errors.pricePounds?.message}
              >
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
              {/* Round 4 #BUG-09: the PUT handler for an edit (admin.routes.ts)
                  has always deliberately left stock_qty out of what it
                  writes — it only ever moves through stock_receive/
                  stock_consume/adjust, which is what keeps the
                  weighted-average cost genuinely correct instead of a
                  number someone could overwrite by hand. This field being
                  editable here was a UI/API contract gap, not a real save
                  path: typing a new count and saving looked like it worked,
                  then silently reverted to whatever the real count already
                  was. Read-only on edit; still a real, honoured field on
                  create (a brand new product has no stock history to
                  protect yet — see the POST handler's own stock_receive
                  call). */}
              <Field
                label="Stock count"
                htmlFor="p-qty"
                error={errors.stockQty?.message}
                hint={
                  product
                    ? 'Use the +/- in the inventory table to adjust this — it keeps the cost-per-unit average correct, which typing a number here can’t.'
                    : undefined
                }
              >
                <Input
                  id="p-qty"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  className={cn('tabular', product && 'bg-paper-2/60 cursor-not-allowed')}
                  readOnly={!!product}
                  aria-readonly={!!product}
                  {...register('stockQty')}
                />
              </Field>
            </div>

            {stockQty === 0 ? (
              <label className="border-line bg-paper-2/50 rounded-ui flex items-center gap-2.5 border px-3 py-2.5 text-sm">
                <input
                  type="checkbox"
                  className="accent-[var(--red)]"
                  {...register('restocking')}
                />
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
                      Flags the product in Inventory and on the dashboard. It never shows on the
                      shop.
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
                <input
                  type="checkbox"
                  className="accent-[var(--red)]"
                  {...register('inStoreOnly')}
                />
                In-store only
              </label>
              <p className="text-muted mt-2 text-xs">
                Hidden from the shop and search — customers can’t find or order it online. Still
                shows in Inventory and the till, and staff can sell it as normal.
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
                        {/* Round 5 #12: real upload now — a file picked here
                            goes to Storage immediately (same pattern as
                            Photos below), and the returned path is what
                            `buyInForm` actually holds and submits. Download
                            re-fetches from the server at click time, so it
                            always reflects what's really saved, not
                            whatever's mid-edit in this form. */}
                        <div className="flex items-center gap-2">
                          <label
                            htmlFor="p-buyin"
                            className="border-input rounded-ui bg-card text-foreground hover:bg-secondary inline-flex h-10 cursor-pointer items-center gap-2 border px-3 text-sm transition-colors"
                          >
                            <span className="bg-paper-2 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase">
                              {uploadBuyInForm.isPending ? 'Uploading…' : 'Upload'}
                            </span>
                            <span
                              className={cn(
                                'max-w-[160px] truncate',
                                !watch('buyInForm') && 'text-muted/70',
                              )}
                            >
                              {watch('buyInForm') ? 'Form on file' : 'Upload the signed form…'}
                            </span>
                          </label>
                          <input
                            id="p-buyin"
                            type="file"
                            accept="application/pdf,image/jpeg,image/png"
                            className="sr-only"
                            disabled={uploadBuyInForm.isPending}
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              e.target.value = '';
                              if (!file) return;
                              try {
                                const path = await uploadBuyInForm.mutateAsync(file);
                                setValue('buyInForm', path, { shouldValidate: true });
                              } catch {
                                // The mutation's own error state is enough —
                                // no toast infrastructure is threaded into
                                // this dialog for a single field.
                              }
                            }}
                          />
                          {watch('buyInForm') ? (
                            <button
                              type="button"
                              onClick={() => setValue('buyInForm', null, { shouldValidate: true })}
                              className="text-muted hover:text-red-deep text-xs underline underline-offset-2"
                            >
                              Remove
                            </button>
                          ) : null}
                          {product ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2"
                              disabled={downloadBuyInForm.isPending}
                              onClick={async () => {
                                try {
                                  const { signedUrl } = await downloadBuyInForm.mutateAsync(
                                    product.id,
                                  );
                                  window.open(signedUrl, '_blank', 'noopener,noreferrer');
                                } catch {
                                  // isError below carries the message.
                                }
                              }}
                            >
                              {downloadBuyInForm.isPending ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Download className="size-3.5" />
                              )}
                              Download
                            </Button>
                          ) : null}
                        </div>
                        {downloadBuyInForm.isError ? (
                          <p className="text-red-deep mt-1 text-xs">
                            {downloadBuyInForm.error.message}
                          </p>
                        ) : null}
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

                {/* Round 5 #13: none of Description/Badge/Compatibility ever
                    render anywhere for an in-store-only product either —
                    same reasoning Round 4 #FEAT-02 already applied to
                    Photos alone. `description`/`tag`/`compatibility` on the
                    form aren't cleared — ticking this off again brings back
                    whatever was already there, same as `images` does. */}
                {inStoreOnly ? (
                  <p className="border-line bg-paper-2/50 rounded-ui border px-3 py-2.5 text-xs">
                    <span className="text-ink font-semibold">In-store only</span> — the description,
                    badge and compatibility note aren’t shown anywhere for this product, so those
                    fields are hidden. Untick “In-store only” to edit them.
                  </p>
                ) : (
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
                )}
              </div>

              <div className="grid content-start gap-4">
                {inStoreOnly ? null : (
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
                )}

                {/* Round 4 #FEAT-02: in-store-only products never show on the
                    shop or search — there's nowhere a photo of one would
                    ever actually be seen, so the upload UI (and any photos
                    already attached) is hidden rather than asking staff to
                    fill in a field with no visible effect. `images` on the
                    form isn't cleared — ticking this off again brings back
                    whatever was already there. */}
                {inStoreOnly ? (
                  <p className="border-line bg-paper-2/50 rounded-ui border px-3 py-2.5 text-xs">
                    <span className="text-ink font-semibold">In-store only</span> — photos aren’t
                    shown anywhere for this product, so the upload field is hidden. Untick “In-store
                    only” to add or edit photos.
                  </p>
                ) : (
                  <Field
                    label="Photos"
                    htmlFor="p-image"
                    hint="JPEG, PNG, WebP or GIF, up to 8MB each"
                  >
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
                          {images.map((url) => (
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
                                onClick={() => removeImage(url)}
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
                              {u.status === 'queued' ? (
                                <span>Waiting…</span>
                              ) : u.status === 'uploading' ? (
                                <span>Uploading…</span>
                              ) : u.status === 'needs-crop' ? (
                                <span>Needs cropping…</span>
                              ) : (
                                <>
                                  <span className="font-semibold">Failed</span>
                                  <span className="truncate">{u.error}</span>
                                  <div className="flex gap-1.5">
                                    <button
                                      type="button"
                                      className="text-ink underline underline-offset-2"
                                      onClick={() => retryUpload(u)}
                                    >
                                      Retry
                                    </button>
                                    <button
                                      type="button"
                                      className="text-red-deep underline underline-offset-2"
                                      onClick={() =>
                                        setPendingUploads((p) => p.filter((x) => x.key !== u.key))
                                      }
                                    >
                                      Dismiss
                                    </button>
                                  </div>
                                </>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </Field>
                )}
              </div>
            </div>

            <div className="border-line flex justify-end gap-2 border-t pt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => closeDialog(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  pending ||
                  pendingUploads.some(
                    (u) =>
                      u.status === 'queued' ||
                      u.status === 'uploading' ||
                      u.status === 'needs-crop',
                  )
                }
              >
                {pending
                  ? 'Saving…'
                  : pendingUploads.some(
                        (u) =>
                          u.status === 'queued' ||
                          u.status === 'uploading' ||
                          u.status === 'needs-crop',
                      )
                    ? 'Uploading photos…'
                    : product
                      ? 'Save changes'
                      : 'Add product'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {activeCrop ? (
        <ImageCropDialog
          fileName={activeCrop.file.name}
          imageUrl={activeCrop.url}
          onCancel={onCropCancelled}
          onCropped={onCropped}
        />
      ) : null}
    </>
  );
}
