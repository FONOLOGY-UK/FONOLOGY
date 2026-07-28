import bcrypt from 'bcryptjs';

/** PIN hashing — a 4-digit dashboard-lock PIN is hashed exactly like a password. */
export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}
