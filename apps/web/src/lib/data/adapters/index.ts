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
