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

/**
 * The live session a cookie token belongs to, or null. One indexed lookup.
 * `refreshed` is true when the session's expiry was just pushed out, so the
 * caller re-sends the cookie with a fresh max-age to match.
 */
export async function findAuthSession(
  token: string | null,
): Promise<{ accountId: string; refreshed: boolean } | null> {
  if (!token || !TOKEN_SHAPE.test(token)) return null;
  const hash = tokenHash(token);
  const row = await db
    .selectFrom('auth_sessions')
    .select(['account_id', 'last_used_at'])
    .where('token_hash', '=', hash)
    .where('revoked_at', 'is', null)
    .where('expires_at', '>', sql<string>`now()`)
    .executeTakeFirst();
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
  return { accountId: row.account_id, refreshed: stale };
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
