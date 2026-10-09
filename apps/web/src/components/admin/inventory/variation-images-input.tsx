'use client';

import Image from 'next/image';
import { useRef, useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { useUploadProductImage } from '@/lib/data/hooks';
import { Button } from '@/components/ui/button';
import { ImageCropDialog } from './image-crop-dialog';

/** Same limits as the product photos (product-dialog.tsx / the API's productImages.ts). */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_DIMENSION = 1500;
const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/**
 * Pictures for one variation or many (0107). Uploads through the same endpoint as product
 * photos — a picture too big on either side goes through the same crop tool first — and hands
 * back public URLs. Saving them against variations is the caller's job.
 */
export function VariationImagesInput({
  urls,
  onChange,
  disabled = false,
}: {
  urls: string[];
  onChange: (urls: string[]) => void;
  disabled?: boolean;
}) {
  const upload = useUploadProductImage();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [crop, setCrop] = useState<{ file: File; url: string } | null>(null);
  const queue = useRef<File[]>([]);
  // The newest list, for uploads that finish after a re-render.
  const latest = useRef(urls);
  latest.current = urls;

  const push = (url: string) => {
    latest.current = [...latest.current, url];
    onChange(latest.current);
  };

  const send = async (file: File) => {
    setBusy((n) => n + 1);
    try {
      push(await upload.mutateAsync(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That picture didn’t upload.');
    } finally {
      setBusy((n) => n - 1);
    }
  };

  /** Next file: straight up if it fits, otherwise through the crop tool (one at a time). */
  const next = async () => {
    const file = queue.current.shift();
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const big = bitmap.width > MAX_DIMENSION || bitmap.height > MAX_DIMENSION;
      bitmap.close();
      if (big) {
        setCrop({ file, url: URL.createObjectURL(file) });
        return; // continues once the crop is done or skipped
      }
    } catch {
      // Unreadable here — let the server decide.
    }
    await send(file);
    void next();
  };

  const pick = (files: FileList | null) => {
    setError(null);
    for (const f of Array.from(files ?? [])) {
      if (!ACCEPTED.has(f.type)) setError(`${f.name} isn’t a JPEG, PNG, WebP or GIF.`);
      else if (f.size > MAX_IMAGE_BYTES) setError(`${f.name} is larger than 8MB.`);
      else queue.current.push(f);
    }
    if (!crop) void next();
  };

  const closeCrop = () => {
    if (crop) URL.revokeObjectURL(crop.url);
    setCrop(null);
  };

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {urls.map((url, i) => (
          <div
            key={url}
            className="border-line rounded-ui relative size-20 overflow-hidden border bg-white"
          >
            <Image src={url} alt="" fill sizes="80px" className="object-cover" />
            {i === 0 ? (
              <span className="bg-ink/80 absolute bottom-0 left-0 right-0 text-center text-[10px] font-semibold text-white">
                Main
              </span>
            ) : null}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(urls.filter((u) => u !== url))}
              className="bg-paper/90 hover:text-red-deep absolute right-1 top-1 rounded-full p-0.5"
              aria-label="Remove this picture"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          className="size-20 flex-col gap-1 p-0 text-[11px]"
          disabled={disabled || busy > 0}
          onClick={() => fileRef.current?.click()}
        >
          {busy > 0 ? <Loader2 className="animate-spin" /> : <ImagePlus />}
          {busy > 0 ? 'Uploading' : 'Add'}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          hidden
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {error ? (
        <p role="alert" className="text-red-deep text-xs font-medium">
          {error}
        </p>
      ) : null}
      {crop ? (
        <ImageCropDialog
          fileName={crop.file.name}
          imageUrl={crop.url}
          onCancel={() => {
            closeCrop();
            void next();
          }}
          onCropped={(blob) => {
            const file = new File([blob], crop.file.name, { type: blob.type || 'image/jpeg' });
            closeCrop();
            void send(file).then(() => next());
          }}
        />
      ) : null}
    </div>
  );
}
