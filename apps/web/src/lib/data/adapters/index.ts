import type { DataAdapter, DataSource } from './types';
import { mockAdapter } from './mock.adapter';
import { httpAdapter } from './http.adapter';

/**
 * Adapter selection. Controlled by NEXT_PUBLIC_DATA_SOURCE=mock|http.
 * Defaults to `mock` so the app runs with zero backend. This is the ONLY place
 * that decides which implementation is live; nothing else in the app imports a
 * concrete adapter.
 */
const source = (process.env.NEXT_PUBLIC_DATA_SOURCE ?? 'mock') as DataSource;

export const dataAdapter: DataAdapter = source === 'http' ? httpAdapter : mockAdapter;

export const activeDataSource: DataSource = source;

export type { DataAdapter, DataSource } from './types';

// The one concrete-adapter export allowed through this neutral barrel: not an
// adapter instance (still only ever reached via `dataAdapter` above), just the
// error shape `ApiError 4xx/5xx`-throwing methods are documented as raising
// (see adapters/types.ts's own JSDoc). Mock-mode methods never throw it, so a
// caller checking `instanceof ApiError` is inherently a no-op there, not a
// mode-specific branch — safe either way.
export { ApiError } from './http.adapter';
