import crypto from 'node:crypto';
import multer from 'multer';
import sharp from 'sharp';
import { supabaseAdmin } from './supabase.js';

/**
 * Real product-image upload (BUG-01 follow-up). Storage bucket is
 * `product-images` — public read (0011_security.sql), no insert/update/
 * delete policy at all: uploads go through this service-role connection,
 * which bypasses RLS entirely, exactly like every other write in this app.
 * A public bucket means public READS, not public writes — see the
 * migration's own comment.
 *
 * Same layered pattern as the ID-document flow this follows (see
 * documentRetention.ts): the API's service-role client is the only thing
 * that ever touches Storage directly, never the browser.
 */

const BUCKET = 'product-images';

/** 8MB — comfortably above a real phone photo, well below "something went wrong". */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const ALLOWED_MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * Memory storage, not disk — the file never touches this machine's
 * filesystem, only RAM, on its way to Storage. `fileFilter` rejects a
 * non-image content-type before the file is even read into memory; the size
 * limit is enforced by multer itself, before the handler ever runs.
 */
export const uploadProductImageMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!(file.mimetype in ALLOWED_MIME_TO_EXT)) {
      cb(new Error('Only JPEG, PNG, WebP or GIF images are accepted.'));
      return;
    }
    cb(null, true);
  },
}).single('file');

/**
 * Round 3 #5.1: every product photo is standardised to exactly 1500x1500
 * before it ever reaches Storage.
 *
 * `fit: 'contain'` on a canvas at exactly the target size, never a crop:
 * whichever of the image's two dimensions is proportionally further from
 * 1500 is scaled to exactly 1500, and the other is padded with transparent
 * pixels only by however much the aspect ratio actually requires — a 3:2
 * photo gets a little padding top and bottom, a 1:1 photo gets none at all.
 * An image LARGER than 1500x1500 in either dimension is refused outright —
 * the admin's own in-app crop tool (product-dialog.tsx) is what's supposed
 * to bring it under that bound before it's ever sent here, so a
 * still-oversized buffer reaching this function means that step was
 * skipped, not that this function should quietly crop it unasked.
 *
 * Round 3 followup #3: this used to also pass `withoutEnlargement: true`,
 * meaning a source smaller than 1500 in both dimensions (a phone
 * screenshot, say 390x844) kept its own real pixel size and was just
 * centred on the canvas — nowhere near 1500 on either axis, so almost the
 * entire square ended up transparent padding, and the actual photo read as
 * "tiny image floating in a huge empty box" once rendered (the PDP's own
 * square stage + object-fit: contain was just showing that file exactly as
 * it is; there was nothing wrong on the frontend to fix). Letting `fit:
 * 'contain'` upscale removes that — the tradeoff is that a genuinely tiny
 * source (well under 1500px) will look softer once stretched to fill the
 * frame, which is the right side to be wrong on: a slightly soft product
 * photo beats one lost in a sea of transparency.
 *
 * Padding needs a real alpha channel, which JPEG can't carry — every
 * processed image comes out as PNG regardless of what was uploaded, always
 * `image/png` / `.png` from here on, never the original mimetype/extension.
 */
const CANVAS_SIZE = 1500;

export class ImageTooLargeError extends Error {
  constructor() {
    super(`Image is larger than ${CANVAS_SIZE}x${CANVAS_SIZE} — crop it before saving.`);
    this.name = 'ImageTooLargeError';
  }
}

async function standardizeToCanvas(buffer: Buffer): Promise<Buffer> {
  const image = sharp(buffer, { failOn: 'none' });
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width === 0 || height === 0) throw new Error('Could not read this image.');
  if (width > CANVAS_SIZE || height > CANVAS_SIZE) throw new ImageTooLargeError();

  return image
    .resize(CANVAS_SIZE, CANVAS_SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      position: 'centre',
    })
    .png()
    .toBuffer();
}

/**
 * Uploads one already-validated buffer to the public bucket and returns its
 * public URL. The storage path is generated here, never taken from the
 * caller's filename — a user-supplied name is untrusted input (path
 * traversal, collisions, awkward characters) and carries no information
 * this app needs to keep.
 */
export async function uploadProductImage(
  buffer: Buffer,
  mimetype: string,
): Promise<{ url: string; path: string }> {
  if (!(mimetype in ALLOWED_MIME_TO_EXT)) throw new Error('Unsupported image type.');

  const standardized = await standardizeToCanvas(buffer);
  const path = `${crypto.randomUUID()}.png`;

  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, standardized, {
    contentType: 'image/png',
    upsert: false,
  });
  if (error) throw error;

  const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
}

/**
 * Removes one image from the bucket by its public URL (hardening pass after
 * BUG-15: a photo uploaded during product create/edit and never attached —
 * removed again before save, or the dialog cancelled outright — used to sit
 * in Storage forever with nothing pointing at it). The path is always the
 * last segment of the URL this same module generated in `uploadProductImage`
 * (a bare UUID + extension, never taken from user input either way), so
 * parsing it back out is safe and doesn't need a second round-trip to ask
 * Storage what the path was.
 *
 * Best-effort: a failure here leaves an orphaned file, exactly the pre-existing
 * behaviour, not a worse one — so callers fire this and move on rather than
 * blocking a UI action on it.
 */
export async function deleteProductImage(url: string): Promise<void> {
  const path = url.split('/').pop();
  if (!path) return;
  const { error } = await supabaseAdmin.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}
