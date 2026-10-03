/** Rows a DELETE removed — the count of `numDeletedRows` across a Kysely delete result. */
export function deletedCount(result: { numDeletedRows: bigint }[]): number {
  return result.reduce((n, r) => n + Number(r.numDeletedRows), 0);
}
