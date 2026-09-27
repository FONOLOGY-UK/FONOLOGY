import type { DataAdapter } from './types';
import { httpAdapter } from './http.adapter';

/**
 * The one place that names a concrete adapter; nothing else in the app
 * imports one. Components reach it only through `@/lib/data/hooks`.
 */
export const dataAdapter: DataAdapter = httpAdapter;

export type { DataAdapter } from './types';

// Not an adapter instance — just the error shape the adapter's methods throw
// on a 4xx/5xx (see adapters/types.ts), so callers can `instanceof` it.
export { ApiError } from './http.adapter';
