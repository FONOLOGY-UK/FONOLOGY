import {
  Kysely,
  PostgresDialect,
  sql,
  type Expression,
  type RawBuilder,
  type Simplify,
} from 'kysely';
import pg from 'pg';
import { config } from '../config.js';
import type { DB } from '../db/types.js';

/**
 * The API's one database handle — every table query in this service goes
 * through `db`. It connects as `fonology_api` (BYPASSRLS, no DDL — see
 * apps/api/scripts/migrate.ts); RLS denies everyone else by design.
 *
 * VALUES COME BACK THE WAY SUPABASE RETURNED THEM. The routes were written
 * against supabase-js, which receives PostgREST's JSON — built by Postgres's
 * own to_json — and the web app's Zod schemas are the contract on top of that.
 * node-postgres's defaults differ, so the parsers below restore PostgREST's
 * shapes, and nothing downstream has to know the driver changed:
 *
 *   timestamptz  PostgREST '2026-09-30T11:20:43.023456+00:00'; pg would give
 *                a Date (milliseconds only, 'Z'). Kept as that exact string.
 *   date         '2026-09-30'; pg would give a local-midnight Date.
 *   int8         a number (count(*), sums); pg gives a string.
 *   numeric      a number (devices.price_multiplier); pg gives a string.
 *   enum[]       an array; pg gives the raw '{a,b}' text for an unknown oid —
 *                registered at startup by initDb(), since enum oids vary.
 *
 * The session TimeZone is pinned to UTC, as PostgREST's is, so the offset
 * is always +00:00.
 */

const { types } = pg;

const TIMESTAMPTZ = 1184;
const TIMESTAMPTZ_ARRAY = 1185;
const TIMESTAMP = 1114;
const DATE = 1082;
const DATE_ARRAY = 1182;
const INT8 = 20;
const NUMERIC = 1700;
const TEXT_ARRAY = 1009;

/** '2026-09-30 11:20:43.023456+00' → '2026-09-30T11:20:43.023456+00:00' (to_json's format). */
export function toJsonTimestamp(value: string): string {
  if (value === 'infinity' || value === '-infinity') return value;
  const iso = value.replace(' ', 'T');
  return /[+-]\d\d$/.test(iso) ? `${iso}:00` : iso;
}

// pg's typings only accept its built-in type ids; array and enum oids are real
// oids all the same.
const oid = (n: number) => n;
const setParser = (n: number, parse: (v: string) => unknown) => types.setTypeParser(oid(n), parse);

const parseTextArray = types.getTypeParser(oid(TEXT_ARRAY)) as (v: string) => string[];

setParser(TIMESTAMPTZ, toJsonTimestamp);
setParser(TIMESTAMPTZ_ARRAY, (v) => parseTextArray(v).map(toJsonTimestamp));
setParser(TIMESTAMP, (v) => v.replace(' ', 'T'));
setParser(DATE, (v) => v);
setParser(DATE_ARRAY, parseTextArray);
setParser(INT8, (v) => Number(v));
setParser(NUMERIC, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.databasePoolMax,
  options: '-c TimeZone=UTC',
});

export const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

/**
 * Registers the array parser for every enum type's array oid (job_status[],
 * permission[], …). Oids are assigned per database, so this asks rather than
 * hardcoding. Call once before serving requests.
 */
export async function initDb(): Promise<void> {
  const { rows } = await pool.query<{ typarray: number }>(
    "select t.typarray from pg_type t join pg_namespace n on n.oid = t.typnamespace where t.typtype = 'e' and n.nspname = 'public'",
  );
  for (const { typarray } of rows) setParser(typarray, parseTextArray);
}

/**
 * Calls a Postgres function the way `supabase.rpc(name, args)` did: named
 * arguments, and the result shaped as PostgREST shaped it —
 *   set-returning / RETURNS TABLE  → an array of row objects
 *   scalar (uuid, pence, jsonb, …) → the value itself
 *   void                           → null
 * `returnsSet` says which, since the call site knows the function it calls.
 */
export async function rpc<T = unknown>(
  name: string,
  args: Record<string, unknown> = {},
  opts: { returnsSet?: boolean; executor?: Kysely<DB> } = {},
): Promise<T> {
  const executor = opts.executor ?? db;
  const fn = sql.id(name);
  const params = Object.entries(args).map(([k, v]) => sql`${sql.id(k)} => ${toParam(v)}`);
  const call = sql`${fn}(${sql.join(params)})`;
  if (opts.returnsSet) {
    const { rows } = await sql`select * from ${call}`.execute(executor);
    return rows as T;
  }
  const { rows } = await sql<{ result: T }>`select ${call} as result`.execute(executor);
  return (rows[0]?.result ?? null) as T;
}

/**
 * supabase-js serialised every rpc argument to JSON, and PostgREST cast it to
 * the parameter's type — so a JS array or object arrived as a Postgres
 * array / jsonb. node-postgres would send a JS array as a Postgres array
 * literal (fine for text[]/uuid[], wrong for jsonb) and an object as JSON
 * text. Arrays of plain values go through as arrays; anything object-shaped
 * is sent as JSON text and left to Postgres's implicit cast from `unknown`.
 */
function toParam(v: unknown): unknown {
  if (v === undefined) return null;
  if (Array.isArray(v) && v.some((x) => x !== null && typeof x === 'object'))
    return JSON.stringify(v);
  if (
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    !(v instanceof Date) &&
    !Buffer.isBuffer(v)
  ) {
    return JSON.stringify(v);
  }
  return v;
}

/** A Postgres error as supabase-js's `{ code, message, details, hint }` shaped it. */
export interface DbError {
  code: string;
  message: string;
  details: string | null;
  hint: string | null;
}

export function isDbError(e: unknown): e is pg.DatabaseError {
  return e instanceof pg.DatabaseError;
}

/** Normalises anything thrown by a query into supabase-js's error shape. */
export function toDbError(e: unknown): DbError {
  if (isDbError(e)) {
    return {
      code: e.code ?? '',
      message: e.message,
      details: e.detail ?? null,
      hint: e.hint ?? null,
    };
  }
  return {
    code: '',
    message: e instanceof Error ? e.message : String(e),
    details: null,
    hint: null,
  };
}

/** Result of a query in supabase-js's `{ data, error }` form, for call sites that branch on it. */
export async function attempt<T>(
  run: () => Promise<T>,
): Promise<{ data: T; error: null } | { data: null; error: DbError }> {
  try {
    return { data: await run(), error: null };
  } catch (e) {
    if (!isDbError(e)) throw e;
    return { data: null, error: toDbError(e) };
  }
}

export type { Expression, RawBuilder, Simplify };
export { sql };
