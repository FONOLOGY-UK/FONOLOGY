import { BUCKETS, deleteObject, listObjects } from './storage.js';
import { db, rpc, toDbError } from './db.js';

/**
 * ID-document retention purge. GDPR-driven: the retention window lives in
 * `shop_settings.id_document_retention_days` (never hardcoded here — see
 * `documents_due_for_deletion()`), and "safe to delete" means the document's
 * order has reached a terminal state (collected/shipped/cancelled — the same
 * states `order_status_allowed_next()` treats as final). A document on a
 * still-live order is never returned by that function, no matter its age.
 *
 * Deletion is two-part and ordered deliberately: the Storage object is
 * removed first, and the `order_documents` row only after that succeeds (or
 * the object was already gone — an S3 delete of a missing key succeeds). If the storage
 * removal genuinely fails, the DB row is left in place so the document isn't
 * silently orphaned — it stays visible and is retried on the next run.
 *
 * Called by `scripts/purge-documents.ts`, the scheduled entry point.
 */

const RETENTION_BUCKET = BUCKETS.idDocuments;
const RETENTION_ACTOR_LABEL = 'Document retention job';

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface DueDocument {
  id: string;
  order_id: string;
  reference: string;
  kind: string;
  storage_path: string;
  uploaded_at: string;
  order_status: string;
}

export interface PurgedDocument {
  id: string;
  orderReference: string;
  kind: string;
  storagePath: string;
  uploadedAt: string;
}

export interface PurgeError {
  id: string;
  storagePath: string;
  error: string;
}

export interface PurgeResult {
  checked: number;
  purged: PurgedDocument[];
  errors: PurgeError[];
}

export async function purgeExpiredDocuments(): Promise<PurgeResult> {
  let due: DueDocument[];
  try {
    due = await rpc<DueDocument[]>('documents_due_for_deletion', {}, { returnsSet: true });
  } catch (e) {
    throw new Error(`Could not list documents due for deletion: ${toDbError(e).message}`);
  }
  const result: PurgeResult = { checked: due.length, purged: [], errors: [] };

  for (const doc of due) {
    try {
      await deleteObject(RETENTION_BUCKET, doc.storage_path);
    } catch (e) {
      result.errors.push({ id: doc.id, storagePath: doc.storage_path, error: errorMessage(e) });
      continue;
    }

    try {
      await db.deleteFrom('order_documents').where('id', '=', doc.id).execute();
    } catch (e) {
      result.errors.push({
        id: doc.id,
        storagePath: doc.storage_path,
        error: toDbError(e).message,
      });
      continue;
    }

    await db
      .insertInto('audit_log')
      .values({
        actor_id: null,
        actor_label: RETENTION_ACTOR_LABEL,
        action: 'document.retention_purge',
        entity_type: 'order_document',
        entity_id: doc.id,
        before: {
          orderReference: doc.reference,
          kind: doc.kind,
          storagePath: doc.storage_path,
          uploadedAt: doc.uploaded_at,
          orderStatus: doc.order_status,
        },
        note: `Deleted by the retention job — past the retention window; order ${doc.reference} is ${doc.order_status}.`,
      })
      .execute()
      .catch(() => undefined);

    result.purged.push({
      id: doc.id,
      orderReference: doc.reference,
      kind: doc.kind,
      storagePath: doc.storage_path,
      uploadedAt: doc.uploaded_at,
    });
  }

  return result;
}

/**
 * Sweeps verification documents that were uploaded but never became an
 * order (audit finding CRIT-02, the retention half of it).
 *
 * The upload endpoint has to accept a file BEFORE the order exists — see
 * the sequencing note on `POST /orders/documents` — so an abandoned
 * checkout leaves a real driving licence in Storage with no
 * `order_documents` row pointing at it. `purgeExpiredDocuments` above can
 * never catch those: it works from `documents_due_for_deletion()`, which
 * walks the TABLE, and an orphan has no row. Without this, "we delete your
 * documents after 30 days" would be false for exactly the people who
 * changed their mind — the ones with the least reason to expect us to keep
 * anything.
 *
 * Anything unreferenced and older than the grace period goes. The grace
 * period only has to outlast a single checkout: the customer uploads, then
 * pays, within minutes. Six hours is far beyond that and still same-day.
 *
 * Deliberately compares against the whole `order_documents` table rather
 * than a time-bounded slice of it — a file is orphaned if NOTHING
 * references it, and a cheaper query that only looked at recent rows could
 * delete a document belonging to an older order.
 */
const ORPHAN_GRACE_MS = 6 * 60 * 60 * 1000;

export interface OrphanSweepResult {
  scanned: number;
  deleted: string[];
  errors: PurgeError[];
}

export async function purgeOrphanedOrderDocuments(): Promise<OrphanSweepResult> {
  const result: OrphanSweepResult = { scanned: 0, deleted: [], errors: [] };

  let referenced: Set<string>;
  try {
    const rows = await db.selectFrom('order_documents').select('storage_path').execute();
    referenced = new Set(rows.map((r) => r.storage_path));
  } catch (e) {
    result.errors.push({ id: 'order_documents', storagePath: '-', error: toDbError(e).message });
    return result;
  }

  const cutoff = Date.now() - ORPHAN_GRACE_MS;

  // Keys are minted as `<kind>/<uuid>.<ext>`, so the two kind folders are
  // the entire namespace this endpoint can write into.
  for (const folder of ['v5c', 'driving_licence']) {
    let objects: Awaited<ReturnType<typeof listObjects>>;
    try {
      objects = await listObjects(RETENTION_BUCKET, `${folder}/`);
    } catch (e) {
      result.errors.push({ id: folder, storagePath: folder, error: errorMessage(e) });
      continue;
    }

    for (const object of objects) {
      const path = object.key;
      result.scanned += 1;
      if (referenced.has(path)) continue;

      // Treat an unknown age as too young to delete: skipping a real orphan
      // costs one more sweep, deleting a live document costs a customer
      // their order.
      const createdAt = object.lastModified?.getTime() ?? Number.NaN;
      if (!Number.isFinite(createdAt) || createdAt > cutoff) continue;

      try {
        await deleteObject(RETENTION_BUCKET, path);
      } catch (e) {
        result.errors.push({ id: path, storagePath: path, error: errorMessage(e) });
        continue;
      }
      result.deleted.push(path);
    }
  }

  return result;
}
