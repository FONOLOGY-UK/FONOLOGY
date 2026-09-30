const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True when Postgres would accept `value` as a uuid. supabase-js turned a
 * malformed id into `{ data: null, error }` rather than throwing, so routes
 * that looked up `/things/:id` answered "not found"; a direct query throws
 * 22P02 instead. Checking first keeps those routes answering as they did.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
