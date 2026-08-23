import crypto from 'node:crypto';
import multer from 'multer';
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
  const ext = ALLOWED_MIME_TO_EXT[mimetype];
  const path = `${crypto.randomUUID()}.${ext}`;

  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, buffer, {
    contentType: mimetype,
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
