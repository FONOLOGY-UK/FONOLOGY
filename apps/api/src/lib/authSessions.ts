import { createHash, randomBytes } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { db } from './db.js';
import type { DB } from '../db/types.js';

/**
 * Sign-in sessions and emailed one-time links (0093).
 *
 * Both are random 256-bit tokens handed to the browser exactly once — in the
 * `fnl_session` cookie, or in a link in an email. The database keeps only the
 * SHA-256 of each, so a copy of `auth_sessions` / `auth_tokens` is not a set
 * of usable credentials. A plain hash, not a slow one, is right here: the
 * token is 256 random bits, so there is nothing to brute-force.
 */

/** How long a session lasts without being used. Each use pushes it out again. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Sessions are only re-stamped (and their cookie re-sent) this often, not on every request. */
const SESSION_TOUCH_MS = 60 * 60 * 1000;

const TOKEN_TTL_MS = {
  email_confirm: 24 * 60 * 60 * 1000,
  password_reset: 60 * 60 * 1000,
} as const;
export type TokenPurpose = keyof typeof TOKEN_TTL_MS;

/** 32 random bytes as base64url: 43 characters. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function tokenHash(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

function inFuture(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

/* ---------------------------------------------------------------------- */
/* Sessions                                                                */
/* ---------------------------------------------------------------------- */

/** Starts a session for an account and returns the token for its cookie. */
export async function createAuthSession(
  accountId: string,
  userAgent: string | undefined,
  executor: Kysely<DB> = db,
): Promise<string> {
  const token = newToken();
  await executor
    .insertInto('auth_sessions')
    .values({
      account_id: accountId,
      token_hash: tokenHash(token),
      expires_at: inFuture(SESSION_TTL_MS),
      user_agent: userAgent?.slice(0, 500) ?? null,
    })
    .execute();
  // Housekeeping for this account only: sessions that ended over a week ago
  // are no use to anyone, and nothing else ever deletes them.
  await executor
    .deleteFrom('auth_sessions')
    .where('account_id', '=', accountId)
    .where((eb) =>
      eb.or([
        eb('expires_at', '<', sql<string>`now() - interval '7 days'`),
        eb('revoked_at', '<', sql<string>`now() - interval '7 days'`),
      ]),
    )
    .execute()
    .catch(() => undefined);
  return token;
}

/** Everything one request needs to know about who a session cookie belongs to. */
export interface AuthPrincipalRow {
  account_id: string;
  last_used_at: string;
  /** Set when the account is a staff member. */
  staff_id: string | null;
  staff_name: string | null;
  staff_email: string | null;
  staff_role: string | null;
  staff_is_active: boolean | null;
  staff_idle_lock_minutes: number | null;
  /** The shop they work in; null for an owner who has none. */
  staff_shop_id: string | null;
  /** Their granted permissions — an empty array when they hold none. */
  staff_permissions: string[] | null;
  /** The live staff_sessions row for the staff cookie, when it matches this staff member. */
  staff_session_locked: boolean | null;
  staff_session_pos_only: boolean | null;
  staff_session_found: boolean;
  /** Set when the account is a customer. */
  customer_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
}

/**
 * The live session a cookie token belongs to, with its account's identity,
 * permissions and till-lock row — ONE indexed query, because this runs in
 * front of every request. Null when the token is unknown, revoked or expired.
 * `refreshed` is true when the session's expiry was just pushed out, so the
 * caller re-sends the cookie with a fresh max-age to match.
 *
 * `staffSessionId` is the staff_sessions cookie, already checked to be a uuid
 * (or null): it is only matched against a row of this very staff member that
 * has not ended.
 */
export async function findAuthPrincipal(
  token: string | null,
  staffSessionId: string | null,
): Promise<{ row: AuthPrincipalRow; refreshed: boolean } | null> {
  if (!token || !TOKEN_SHAPE.test(token)) return null;
  const hash = tokenHash(token);
  const { rows } = await sql<AuthPrincipalRow>`
    select s.account_id, s.last_used_at,
           st.id as staff_id, st.name as staff_name, st.email as staff_email,
           st.role::text as staff_role, st.is_active as staff_is_active,
           st.idle_lock_minutes as staff_idle_lock_minutes, st.shop_id as staff_shop_id,
           (select coalesce(array_agg(p.permission::text), '{}'::text[])
              from staff_permissions p where p.staff_id = st.id) as staff_permissions,
           ss.locked as staff_session_locked, ss.pos_only as staff_session_pos_only,
           (ss.id is not null) as staff_session_found,
           c.id as customer_id, c.name as customer_name, c.email as customer_email
      from auth_sessions s
      left join staff st on st.id = s.account_id
      left join staff_sessions ss
             on ss.id = ${staffSessionId}::uuid and ss.staff_id = st.id and ss.ended_at is null
      left join customers c on c.id = s.account_id
     where s.token_hash = ${hash} and s.revoked_at is null and s.expires_at > now()
  `.execute(db);
  const row = rows[0];
  if (!row) return null;

  const stale = Date.now() - Date.parse(row.last_used_at) > SESSION_TOUCH_MS;
  if (stale) {
    await db
      .updateTable('auth_sessions')
      .set({ last_used_at: sql`now()`, expires_at: inFuture(SESSION_TTL_MS) })
      .where('token_hash', '=', hash)
      .execute()
      .catch(() => undefined);
  }
  return { row, refreshed: stale };
}

/** Ends the session a cookie token belongs to. A no-op for an unknown token. */
export async function revokeAuthSession(token: string | null): Promise<void> {
  if (!token || !TOKEN_SHAPE.test(token)) return;
  await db
    .updateTable('auth_sessions')
    .set({ revoked_at: sql`now()` })
    .where('token_hash', '=', tokenHash(token))
    .where('revoked_at', 'is', null)
    .execute();
}

/** Ends every session an account has — after a password reset. */
export async function revokeAllAuthSessions(
  accountId: string,
  executor: Kysely<DB> = db,
): Promise<void> {
  await executor
    .updateTable('auth_sessions')
    .set({ revoked_at: sql`now()` })
    .where('account_id', '=', accountId)
    .where('revoked_at', 'is', null)
    .execute();
}

/* ---------------------------------------------------------------------- */
/* One-time tokens: email confirmation, password reset                     */
/* ---------------------------------------------------------------------- */

/** Issues a single-use token for an emailed link. Returns the raw token. */
export async function createOneTimeToken(
  accountId: string,
  purpose: TokenPurpose,
  executor: Kysely<DB> = db,
): Promise<string> {
  const token = newToken();
  await executor
    .insertInto('auth_tokens')
    .values({
      account_id: accountId,
      purpose,
      token_hash: tokenHash(token),
      expires_at: inFuture(TOKEN_TTL_MS[purpose]),
    })
    .execute();
  await executor
    .deleteFrom('auth_tokens')
    .where('account_id', '=', accountId)
    .where('expires_at', '<', sql<string>`now() - interval '7 days'`)
    .execute()
    .catch(() => undefined);
  return token;
}

/** The account a token would act for, without using it up. */
export async function peekOneTimeToken(
  token: string,
  purpose: TokenPurpose,
): Promise<string | null> {
  if (!TOKEN_SHAPE.test(token)) return null;
  const row = await db
    .selectFrom('auth_tokens')
    .select('account_id')
    .where('token_hash', '=', tokenHash(token))
    .where('purpose', '=', purpose)
    .where('used_at', 'is', null)
    .where('expires_at', '>', sql<string>`now()`)
    .executeTakeFirst();
  return row?.account_id ?? null;
}

/**
 * Uses a token up and returns its account, or null if it is unknown, expired,
 * already used or for another purpose. A single UPDATE … RETURNING, so two
 * clicks racing on the same link cannot both succeed. Every other unused token
 * of the same purpose for that account is used up with it — an older reset
 * email stops working once a newer one has been used.
 */
export async function consumeOneTimeToken(
  token: string,
  purpose: TokenPurpose,
  executor: Kysely<DB> = db,
): Promise<string | null> {
  if (!TOKEN_SHAPE.test(token)) return null;
  const row = await executor
    .updateTable('auth_tokens')
    .set({ used_at: sql`now()` })
    .where('token_hash', '=', tokenHash(token))
    .where('purpose', '=', purpose)
    .where('used_at', 'is', null)
    .where('expires_at', '>', sql<string>`now()`)
    .returning('account_id')
    .executeTakeFirst();
  if (!row) return null;
  await executor
    .updateTable('auth_tokens')
    .set({ used_at: sql`now()` })
    .where('account_id', '=', row.account_id)
    .where('purpose', '=', purpose)
    .where('used_at', 'is', null)
    .execute();
  return row.account_id;
}
