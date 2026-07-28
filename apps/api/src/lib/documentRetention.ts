import { supabaseAdmin } from './supabase.js';

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
 * the object was already gone — Storage's `remove()` doesn't error on a
 * missing key, confirmed against dev before relying on it). If the storage
 * removal genuinely fails, the DB row is left in place so the document isn't
 * silently orphaned — it stays visible and is retried on the next run.
 *
 * One function, two callers: `POST /orders/documents/purge` (manual/admin)
 * and `scripts/purge-documents.ts` (the scheduled entry point) both call
 * this directly — there is no separate "scheduled" code path to drift from
 * the "manual" one.
 */

const RETENTION_BUCKET = 'id-documents';
const RETENTION_ACTOR_LABEL = 'Document retention job';

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
  const { data: candidates, error: selectErr } = await supabaseAdmin.rpc(
    'documents_due_for_deletion',
  );
  if (selectErr) {
    throw new Error(`Could not list documents due for deletion: ${selectErr.message}`);
  }

  const due = (candidates ?? []) as DueDocument[];
  const result: PurgeResult = { checked: due.length, purged: [], errors: [] };

  for (const doc of due) {
    const { error: removeErr } = await supabaseAdmin.storage
      .from(RETENTION_BUCKET)
      .remove([doc.storage_path]);
    if (removeErr) {
      result.errors.push({ id: doc.id, storagePath: doc.storage_path, error: removeErr.message });
      continue;
    }

    const { error: deleteErr } = await supabaseAdmin
      .from('order_documents')
      .delete()
      .eq('id', doc.id);
    if (deleteErr) {
      result.errors.push({ id: doc.id, storagePath: doc.storage_path, error: deleteErr.message });
      continue;
    }

    await supabaseAdmin.from('audit_log').insert({
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
    });

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
