import { supabaseAdmin } from './supabase.js';

/**
 * Names for a set of staff ids, in one query. Several screens attribute a row
 * to whoever handled it (cash entries, refunds, and now the counter-sales
 * transactions list — FEATURE-13) and resolving that server-side keeps the
 * client off `/admin/staff` (a different permission, and a heavier payload)
 * just to turn an id into a name.
 *
 * Extracted from pos.routes.ts, which had this local and unexported — moved
 * here rather than duplicated when reports.routes.ts needed the same lookup.
 */
export async function staffNamesFor(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const { data } = await supabaseAdmin.from('staff').select('id, name').in('id', unique);
  return new Map((data ?? []).map((s) => [s.id as string, s.name as string]));
}
