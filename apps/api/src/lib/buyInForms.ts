import crypto from 'node:crypto';
import multer from 'multer';
import { BUCKETS, objectExists, putObject, signedGetUrl } from './storage.js';

/**
 * Round 5 #12: the signed buy-in form upload has required a file since
 * product-dialog.tsx was built, but nothing was ever wired to persist it —
 * see this module's sibling, productImages.ts, for the identical pattern
 * this follows. The `buy-in-forms` Storage bucket has existed since
 * 0011_security.sql; the gap was entirely that nothing ever wrote to or
 * read from it.
 *
 * Private bucket, deliberately — unlike product photos, a signed buy-in
 * form can carry a supplier's name, address and a real signature. Only
 * `product-images` is readable without a key (lib/storage.ts), so a URL into
 * this bucket is meaningless without a short-lived signature minted here —
 * the browser never gets a stable link to save or share.
 */

const BUCKET = BUCKETS.buyInForms;

/** 8MB — same cap as product photos; a scanned form is a few hundred KB at most. */
export const MAX_FORM_BYTES = 8 * 1024 * 1024;

const ALLOWED_MIME_TO_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

export const uploadBuyInFormMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FORM_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!(file.mimetype in ALLOWED_MIME_TO_EXT)) {
      cb(new Error('Only a PDF, JPEG or PNG is accepted.'));
      return;
    }
    cb(null, true);
  },
}).single('file');

/**
 * Sanitised so the original filename survives (staff want to recognise
 * "which supplier's form is this" at a glance, unlike product photos where
 * the filename carries no information worth keeping) without ever trusting
 * it as a path — stripped to a safe character set and capped, then prefixed
 * with a UUID so two uploads named the same thing can never collide.
 */
function safeName(original: string): string {
  const stripped = original.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  return stripped || 'form';
}

export async function uploadBuyInForm(
  buffer: Buffer,
  mimetype: string,
  originalName: string,
): Promise<{ path: string }> {
  if (!(mimetype in ALLOWED_MIME_TO_EXT)) throw new Error('Unsupported file type.');

  const path = `${crypto.randomUUID()}-${safeName(originalName)}`;
  await putObject(BUCKET, path, buffer, mimetype);
  return { path };
}

/** Short-lived (60s) signed URL — this bucket has no public reads at all. Null if the file is gone. */
export async function signBuyInFormUrl(path: string): Promise<string | null> {
  try {
    if (!(await objectExists(BUCKET, path))) return null;
    return await signedGetUrl(BUCKET, path, 60);
  } catch {
    return null;
  }
}

/** The part of the stored path worth showing staff — the sanitised original
 * filename, without the UUID prefix that made it collision-proof. */
export function buyInFormDisplayName(path: string): string {
  // The prefix is a whole UUID, dashes included — cutting at the first dash
  // left four of its five groups on the front of the name.
  return path.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/, '');
}
