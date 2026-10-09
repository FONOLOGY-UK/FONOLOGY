import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import bcrypt from 'bcryptjs';

/**
 * Account passwords: argon2id, @node-rs/argon2's defaults (m=19456 KiB, t=2,
 * p=1 — OWASP's recommended argon2id profile).
 *
 * Accounts imported from Supabase arrive with GoTrue's bcrypt hash
 * (`$2a$10$…`). Those still verify, and `needsRehash` tells the caller to
 * replace the hash with argon2id while it has the plaintext in hand — after
 * one sign-in nothing is left on bcrypt.
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2Hash(password);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<{ ok: boolean; needsRehash: boolean }> {
  if (hash.startsWith('$argon2')) {
    return { ok: await argon2Verify(hash, password).catch(() => false), needsRehash: false };
  }
  if (/^\$2[aby]\$/.test(hash)) {
    const ok = await bcrypt.compare(password, hash);
    return { ok, needsRehash: ok };
  }
  return { ok: false, needsRehash: false };
}

// A real argon2id hash of a random string, computed once. Verifying against it
// when no account matches makes "unknown email" take as long as "wrong
// password", so sign-in timing doesn't reveal which addresses have accounts.
let dummyHash: Promise<string> | null = null;
export async function verifyNothing(password: string): Promise<void> {
  dummyHash ??= argon2Hash(crypto.randomUUID());
  await argon2Verify(await dummyHash, password).catch(() => false);
}

/**
 * PIN hashing — argon2id like account passwords. Older PINs are bcrypt (`$2…`); those still verify and
 * `needsRehash` tells the caller to replace them while it has the PIN in hand. (bcryptjs is pure
 * JavaScript and ties up the event loop for every guess; argon2 runs on the native thread pool.)
 */
export async function hashPin(pin: string): Promise<string> {
  return argon2Hash(pin);
}

export async function verifyPin(
  pin: string,
  hash: string,
): Promise<{ ok: boolean; needsRehash: boolean }> {
  if (hash.startsWith('$argon2')) {
    return { ok: await argon2Verify(hash, pin).catch(() => false), needsRehash: false };
  }
  if (/^\$2[aby]\$/.test(hash)) {
    const ok = await bcrypt.compare(pin, hash);
    return { ok, needsRehash: ok };
  }
  return { ok: false, needsRehash: false };
}
