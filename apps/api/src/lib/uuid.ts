const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True when Postgres would accept `value` as a uuid. A query with a malformed id throws 22P02, so
 * routes that look up `/things/:id` check first and answer "not found" instead of a 500.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
