import crypto from 'node:crypto';
import multer from 'multer';
import { supabaseAdmin } from './supabase.js';

/**
 * Number-plate verification documents (independent audit finding CRIT-02).
 *
 * THE GAP THIS CLOSES
 * The checkout's "Verify your number plate" step captured
 * `e.target.files?.[0]?.name` — the FILENAME — and sent that string to
 * POST /orders, which wrote it straight into `order_documents.storage_path`.
 * No file was ever uploaded. Every plate order produced two rows pointing at
 * objects that did not exist, the staff approval screen could never display
 * anything, and the customer was shown "Uploaded" and a promise about secure
 * storage and 30-day deletion for a file that never left their browser.
 *
 * Everything around the upload already existed — the `order_documents`
 * table, this private bucket, signed-URL viewing, `log_document_view`
 * auditing, and the deployed 30-day purge job. Only the upload was missing.
 *
 * Shaped after buyInForms.ts deliberately rather than inventing a second
 * pattern: multer memory storage, the type and size caps enforced by the
 * middleware BEFORE any handler runs, a UUID-prefixed key so two uploads of
 * `licence.jpg` cannot collide, and the service-role client doing the write.
 *
 * WHAT IS DIFFERENT, AND WHY IT MATTERS
 * buy-in forms are uploaded by authenticated staff. These are uploaded by
 * an unauthenticated member of the public, mid-checkout, and they are
 * identity documents. So this module is stricter about what it accepts, the
 * route that uses it is rate limited, and abandoned uploads are swept (see
 * `purgeOrphanedOrderDocuments`) rather than accumulating forever — keeping
 * a stranger's driving licence indefinitely because they abandoned a basket
 * is exactly what the 30-day retention rule exists to prevent.
 */

const BUCKET = 'id-documents';

/** 8MB — same cap as buy-in forms and product photos. A licence photo from a
 *  phone is 2-4MB; a scanned V5C is smaller. */
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

/**
 * HEIC is included because it is not optional in practice: an iPhone
 * photographing a V5C produces HEIC by default, and this is a customer on a
 * phone at a checkout. Rejecting it would fail the single most likely real
 * upload in the flow.
 */
const ALLOWED_MIME_TO_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

export const uploadOrderDocumentMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    // Server-side type enforcement. The input's `accept` attribute is a
    // file-picker convenience and is not a control — anything can POST here.
    if (!(file.mimetype in ALLOWED_MIME_TO_EXT)) {
      cb(new Error('Please upload a PDF or a photo (JPEG, PNG, HEIC or WebP).'));
      return;
    }
    cb(null, true);
  },
}).single('file');

/** The two document kinds `order_documents.kind` accepts for a plate order. */
export const ORDER_DOCUMENT_KINDS = ['v5c', 'driving_licence'] as const;
export type OrderDocumentKind = (typeof ORDER_DOCUMENT_KINDS)[number];

export function isOrderDocumentKind(value: unknown): value is OrderDocumentKind {
  return typeof value === 'string' && (ORDER_DOCUMENT_KINDS as readonly string[]).includes(value);
}

/**
 * Storage keys this module mints, and the only shape it will accept back.
 *
 * `<kind>/<uuid>.<ext>` — no original filename anywhere in it. That is a
 * deliberate difference from buyInForms.ts, which keeps the filename so
 * staff can recognise a supplier's form: a customer's filename can itself
 * be identifying ("dave-smith-licence.jpg"), and nothing in the staff flow
 * needs it — the document is reached through the order, and its kind is
 * already a column.
 */
const KEY_PATTERN =
  /^(v5c|driving_licence)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z]{3,4}$/;

/**
 * Is this a key this module could have issued?
 *
 * The order-creation path takes storage keys from the CLIENT, so this is a
 * real trust boundary, not a formality. Without it a caller could put any
 * string into `order_documents.storage_path` — another order's document, or
 * a path crafted to point somewhere else in the bucket. Combined with the
 * existence check at the call site, the only keys that can be attached to
 * an order are ones this endpoint actually wrote.
 */
export function isPlausibleDocumentKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

export async function uploadOrderDocument(
  kind: OrderDocumentKind,
  buffer: Buffer,
  mimetype: string,
): Promise<{ path: string }> {
  const ext = ALLOWED_MIME_TO_EXT[mimetype];
  if (!ext) throw new Error('Unsupported file type.');

  const path = `${kind}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, buffer, {
    contentType: mimetype,
    upsert: false,
  });
  if (error) throw error;

  return { path };
}

/**
 * Does the object actually exist? Called before an order is created, so a
 * plate order can never be written against a document that isn't really
 * there — which is the precise failure this whole finding was about.
 */
export async function orderDocumentExists(path: string): Promise<boolean> {
  if (!isPlausibleDocumentKey(path)) return false;
  const slash = path.indexOf('/');
  const folder = path.slice(0, slash);
  const name = path.slice(slash + 1);
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).list(folder, {
    search: name,
    limit: 1,
  });
  if (error) return false;
  return (data ?? []).some((entry) => entry.name === name);
}

export async function deleteOrderDocument(path: string): Promise<void> {
  const { error } = await supabaseAdmin.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}
