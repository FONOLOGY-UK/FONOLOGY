import { db } from './db.js';
import { hashPassword, verifyNothing, verifyPassword } from './password.js';

/** The `user_accounts` columns a password sign-in needs. */
export interface AccountForSignIn {
  id: string;
  password_hash: string | null;
  email_verified_at: string | null;
}

/** Emails are stored lower-cased and compared case-insensitively (citext). */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findAccountByEmail(email: string): Promise<AccountForSignIn | undefined> {
  return db
    .selectFrom('user_accounts')
    .select(['id', 'password_hash', 'email_verified_at'])
    .where('email', '=', normaliseEmail(email))
    .executeTakeFirst();
}

/**
 * Whether `password` is this account's password. An unknown account, or one
 * with no password (Google-only), costs the same time as a wrong password.
 * A correct password over an imported bcrypt hash is re-hashed to argon2id
 * on the spot.
 */
export async function checkAccountPassword(
  account: AccountForSignIn | undefined,
  password: string,
): Promise<boolean> {
  if (!account?.password_hash) {
    await verifyNothing(password);
    return false;
  }
  const { ok, needsRehash } = await verifyPassword(password, account.password_hash);
  if (ok && needsRehash) {
    const upgraded = await hashPassword(password);
    await db
      .updateTable('user_accounts')
      .set({ password_hash: upgraded })
      .where('id', '=', account.id)
      .execute()
      .catch((err) => {
        // The sign-in still succeeds; the next one tries again.
        // eslint-disable-next-line no-console
        console.error('[auth] could not upgrade a bcrypt hash for', account.id, err);
      });
  }
  return ok;
}
