'use client';

import { useCallback, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/**
 * Round 3 #5.1 — the in-app crop tool. Only ever shown for a file whose
 * natural size is bigger than 1500x1500 in either dimension (product-dialog
 * checks that before this ever opens); anything already within that bound
 * skips this entirely and the server pads it out to exactly 1500x1500 with
 * transparent pixels on its own (productImages.ts).
 *
 * Locked to a 1:1 crop — the PDP shows every photo in a square stage
 * (#5.2), so a non-square crop would just be re-padded oddly by the
 * server's own square canvas. Zoom/pan only; no free-form aspect.
 */

const MAX_OUTPUT = 1500;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load this image.'));
    img.src = src;
  });
}

async function cropToBlob(imageSrc: string, area: Area): Promise<Blob> {
  const img = await loadImage(imageSrc);
  // Square by construction (aspect=1 below) — capped at 1500 so the result
  // never needs the server to refuse it as still-too-large, even if the
  // selected region on a huge source photo is bigger than that.
  const size = Math.min(Math.round(area.width), MAX_OUTPUT);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not prepare the crop.');
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, size, size);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not prepare the crop.'))),
      'image/png',
    );
  });
}

export function ImageCropDialog({
  fileName,
  imageUrl,
  onCancel,
  onCropped,
}: {
  /** Original file name, shown so staff know which of a multi-file batch this is. */
  fileName: string;
  /** An object URL for the source file — caller owns and revokes it. */
  imageUrl: string;
  onCancel: () => void;
  onCropped: (blob: Blob) => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCropComplete = useCallback((_croppedArea: Area, croppedAreaPixels: Area) => {
    setArea(croppedAreaPixels);
  }, []);

  const confirm = async () => {
    if (!area) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await cropToBlob(imageUrl, area);
      onCropped(blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not prepare the crop.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent className="w-[min(560px,94vw)] max-w-none">
        <DialogHeader>
          <DialogTitle>Crop “{fileName}”</DialogTitle>
        </DialogHeader>

        <p className="text-muted -mt-2 text-sm">
          Larger than 1500×1500 — drag and zoom to choose the square that gets saved. Everything
          else stays uncropped; only this file needs it.
        </p>

        <div className="bg-void relative h-[360px] w-full overflow-hidden rounded-lg">
          <Cropper
            image={imageUrl}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="rect"
            showGrid
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>

        <label className="text-muted flex items-center gap-2.5 text-xs font-semibold">
          Zoom
          <input
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1"
            aria-label="Crop zoom"
          />
        </label>

        {error ? <p className="text-red-deep text-sm font-medium">{error}</p> : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Skip this photo
          </Button>
          <Button type="button" onClick={confirm} disabled={busy || !area}>
            {busy ? 'Preparing…' : 'Use this crop'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
