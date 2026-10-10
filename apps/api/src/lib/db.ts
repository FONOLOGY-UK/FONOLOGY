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
 * src/scripts/migrate.ts); RLS denies everyone else by design.
 *
 * VALUE SHAPES. The web app's Zod schemas are the contract with this API, and they expect JSON-style
 * values, so the parsers below set them (node-postgres's defaults differ):
 *
 *   timestamptz  '2026-09-30T11:20:43.023456+00:00' (Postgres's to_json format); pg would give a Date.
 *   date         '2026-09-30'; pg would give a local-midnight Date.
 *   int8         a number (count(*), sums); pg gives a string.
 *   numeric      a number (devices.price_multiplier); pg gives a string.
 *   enum[]       an array; pg gives the raw '{a,b}' text for an unknown oid —
 *                registered at startup by initDb(), since enum oids vary.
 *
 * The session TimeZone is pinned to UTC, so the offset is always +00:00.
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
function toJsonTimestamp(value: string): string {
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
  // No single statement may hold a pooled connection (and a till's request) for longer than this; a runaway
  // query is cancelled and the request fails cleanly instead of starving every other request of connections.
  statement_timeout: 60_000,
});

// An idle pooled connection can be dropped by the database or a network device (a restart, a failover).
// pg then emits 'error' on the POOL; with no listener Node treats that as an uncaught exception and the
// whole API - every till in the shop - exits. Log it; the pool discards the dead connection and opens a new
// one on the next query.
pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[db] idle connection error (the pool will replace it):', err.message);
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
 * Calls a Postgres function with named arguments (`fn(a => $1, b => $2)`). The result is shaped by
 * `returnsSet`, which the call site knows from the function it calls —
 *   set-returning / RETURNS TABLE  → an array of row objects
 *   scalar (uuid, pence, jsonb, …) → the value itself
 *   void                           → null
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
 * Runs `fn` in one transaction that tells the database who is acting, so the change log
 * (0104, Log B) can put a name against a plain UPDATE of a product or variant. The setting is
 * transaction-local (`set_config(..., true)`): it ends at commit and never leaks to the next
 * request on the same pooled connection. Use `trx` for every statement inside.
 */
export async function withActor<T>(
  staffId: string,
  fn: (trx: Kysely<DB>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.staff_id', ${staffId}, true)`.execute(trx);
    return fn(trx);
  });
}

/**
 * Arguments to rpc(). node-postgres sends a JS array as a Postgres array literal (right for text[] /
 * uuid[], wrong for jsonb) and an object as JSON text. So arrays of plain values pass through as
 * arrays, and anything object-shaped is sent as JSON text, which Postgres casts to the parameter type.
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

/** A database error as the routes see it: client-safe message plus the codes callers branch on. */
export interface DbError {
  code: string;
  message: string;
  details: string | null;
  hint: string | null;
  /**
   * The violated constraint or unique index (23505 and friends). Branch on THIS to say which rule was
   * broken - `message` is the client-safe text and no longer names the table or constraint.
   */
  constraint: string | null;
}

export function isDbError(e: unknown): e is pg.DatabaseError {
  return e instanceof pg.DatabaseError;
}

/**
 * SQLSTATE 22003 (numeric_value_out_of_range): a figure too big for its column,
 * e.g. £99,999,999 typed into a quote overflows `integer` pence. Routes pass DB
 * messages through because the ones raised by our own functions are written for
 * staff — but Postgres's own wording for this one ("value "9999999900" is out of
 * range for type integer") is not, and it shows pence, not pounds.
 */
const OUT_OF_RANGE = '22003';

/** SQLSTATE of `RAISE EXCEPTION` — the messages OUR database functions write for staff to read. */
const RAISED_BY_OUR_FUNCTIONS = 'P0001';

const GENERIC_DB_MESSAGE =
  'That could not be saved. Nothing was changed - please check the details and try again.';

/**
 * What a client may be told about a database error. Messages our own functions raise are written for
 * people and are passed through. Everything else (constraint violations, bad input syntax, permission
 * errors ...) carries table, column and constraint names - internals a browser has no business seeing - so
 * it is replaced by a generic line and the real error goes to the server log. Callers branch on `code`,
 * which is unchanged.
 */
function clientSafeDbMessage(e: pg.DatabaseError): string {
  if (e.code === OUT_OF_RANGE) return 'That amount is too large.';
  if (e.code === RAISED_BY_OUR_FUNCTIONS) return e.message;
  // Also ours: a RAISE in one of our PL/pgSQL functions (Postgres ends `where` with "at RAISE")
  // that names no constraint. Several use another SQLSTATE so callers can branch on it - the quote
  // floor and the unpaid-job hand-over raise check_violation, shop codes 22023 - and their words
  // are written for staff ("below the shop price for this repair (£85.00)"). A real constraint
  // violation always names its constraint, so it still gets the generic line below.
  if (!e.constraint && / at RAISE$/m.test(e.where ?? '')) return e.message;
  // eslint-disable-next-line no-console
  console.error(`[db] ${e.code ?? '?'} ${e.message}${e.detail ? ` — ${e.detail}` : ''}`);
  return GENERIC_DB_MESSAGE;
}

/** Normalises anything thrown by a query into a DbError. */
export function toDbError(e: unknown): DbError {
  if (isDbError(e)) {
    return {
      code: e.code ?? '',
      message: clientSafeDbMessage(e),
      details: e.detail ?? null,
      hint: e.hint ?? null,
      constraint: e.constraint ?? null,
    };
  }
  return {
    code: '',
    message: e instanceof Error ? e.message : String(e),
    details: null,
    hint: null,
    constraint: null,
  };
}

/** Runs a query and returns `{ data, error }` instead of throwing a database error, for call sites that branch on it. */
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
