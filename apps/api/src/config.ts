import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';

// Local dev only: populate process.env from apps/api/.env.local before
// reading it below. In production, Coolify injects real env vars directly
// (via Infisical) and this is a silent no-op — .env.local won't exist there,
// and dotenv doesn't error when the file is missing.
const here = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(here, '../.env.local') });

/**
 * THE single place this app reads process.env. Nothing else in this codebase
 * should touch process.env directly — that's what makes the swap from a
 * gitignored .env.local (local dev) to Infisical-injected env vars
 * (Coolify, production) a no-code-change operation. Everything downstream
 * imports the typed `config` object below, never process.env itself.
 *
 * Fails fast and loud on a missing variable — never falls back to a
 * placeholder that looks real.
 */

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

function loadConfig() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    // eslint-disable-next-line no-console
    console.error(
      `[config] Missing or invalid environment variable(s): ${missing}. ` +
        `Set them in apps/api/.env.local (copy from .env.example) or in your deployment's env source.`,
    );
    process.exit(1);
  }
  return parsed.data;
}

const env = loadConfig();

export const config = {
  supabaseUrl: env.SUPABASE_URL,
  supabaseAnonKey: env.SUPABASE_ANON_KEY,
  supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  port: env.PORT,
  corsOrigins: env.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  isProduction: env.NODE_ENV === 'production',
} as const;
