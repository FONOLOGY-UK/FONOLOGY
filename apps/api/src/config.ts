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

/** The only value these two vars may take on before someone deliberately sets them. */
const LOCALHOST_DEFAULT = 'http://localhost:3000';

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: z.string().default(LOCALHOST_DEFAULT),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // The customer-facing origin, for building links that go INTO an email —
  // the API has no other way to know where the storefront actually lives.
  WEB_APP_URL: z.string().url().default(LOCALHOST_DEFAULT),

  // Brevo (transactional email). Optional: unset in an environment that
  // hasn't been given a key yet, and the email step degrades to "log and
  // skip" rather than crash the request that triggered it — see
  // lib/email.ts. Never required for the API to boot.
  BREVO_API_KEY: z.string().min(1).optional(),
  // The FROM address on every customer email. Defaulted to
  // hello@fonology.co.uk, which is not a real mailbox — the shop's address is
  // info@fonology.co.uk. A wrong sender means replies vanish and deliverability
  // suffers, and nothing would have surfaced it: mail sends "successfully"
  // from an address nobody reads. Corrected, and still overridable per
  // environment.
  BREVO_SENDER_EMAIL: z.string().email().default('info@fonology.co.uk'),
  BREVO_SENDER_NAME: z.string().default('Fonology'),

  // Stripe. ALL THREE ARE OPTIONAL, and that is deliberate: an environment
  // without Stripe keys must still boot. The API runs the till, the jobs
  // board and every repair in the shop — refusing to start because online
  // card payment is unconfigured would take the counter down over a feature
  // the counter does not use. Instead, lib/stripe.ts fails at the point of
  // use with a message that names the missing variable, and every other
  // route carries on. Same reasoning as BREVO_API_KEY above.
  //
  // The secret key is checked for its `sk_` prefix rather than just
  // non-emptiness so that pasting a publishable key into the wrong line
  // fails at boot with a readable message, instead of at the first real
  // checkout with a Stripe 401.
  STRIPE_SECRET_KEY: z
    .string()
    .startsWith('sk_', 'Must be a Stripe SECRET key (starts with sk_), not a publishable key.')
    .optional(),
  // Signs and verifies webhook bodies. Without it the webhook endpoint
  // rejects everything — see the route, which refuses rather than trusting an
  // unverified body.
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_').optional(),

  // Safari cross-site-cookie fix: shared secret with apps/web's own
  // `/api-proxy/*` route (same value on both Render services). Lets
  // lib/clientIp.ts trust that route's forwarded real-client-IP header for
  // rate limiting — see that file's comment for why trust proxy's hop
  // count can't just be bumped instead. Optional: unset means the header
  // is never trusted and every rate limiter falls back to plain `req.ip`,
  // exactly as before this existed — never required to boot.
  INTERNAL_PROXY_SECRET: z.string().min(16).optional(),
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
  webAppUrl: env.WEB_APP_URL,
  brevoApiKey: env.BREVO_API_KEY,
  brevoSenderEmail: env.BREVO_SENDER_EMAIL,
  brevoSenderName: env.BREVO_SENDER_NAME,
  stripeSecretKey: env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
  internalProxySecret: env.INTERNAL_PROXY_SECRET,
} as const;

/**
 * Boot guard for the HTTP SERVER ONLY. Call once, from server.ts, before listen.
 *
 * A production API serving traffic with either var still on its dev default is
 * not "unconfigured" the way a missing Brevo key is — it is an environment that
 * silently believes it is talking to localhost. CORS would reject the real
 * storefront origin outright, and WEB_APP_URL would put a dead localhost link
 * into every outbound email. Both are worse discovered by a customer than by a
 * crash at boot, so this still refuses to start.
 *
 * WHY IT IS NOT IN THE SCHEMA ANY MORE
 * It used to run inside the env schema, which meant it ran on *any* import of
 * this module — including the two cron jobs, which import it transitively via
 * printRetention/documentRetention and never serve a request or send an email.
 * Neither cron is given CORS_ORIGINS or WEB_APP_URL (they only receive the
 * fonology-shared env group), so both defaulted to localhost, tripped this
 * check and exited 1 on every single run. fonology-purge-print-jobs runs every
 * two minutes, so that was a failure email every two minutes for a job whose
 * actual work — deleting print jobs carrying customer PII past their retention
 * window — had silently not run since the services moved to Render.
 *
 * The rule is unchanged; it is only applied where the risk it describes exists.
 */
export function assertServerConfig(): void {
  const problems: string[] = [];
  if (!config.isProduction) return;
  if (config.corsOrigins.join(',') === LOCALHOST_DEFAULT) {
    problems.push(
      `CORS_ORIGINS must be the real storefront origin(s) in production — still the localhost default (${LOCALHOST_DEFAULT}).`,
    );
  }
  if (config.webAppUrl === LOCALHOST_DEFAULT) {
    problems.push(
      `WEB_APP_URL must be the real storefront origin in production — still the localhost default (${LOCALHOST_DEFAULT}).`,
    );
  }
  if (problems.length) {
    // eslint-disable-next-line no-console
    console.error(`[config] ${problems.join(' ')}`);
    process.exit(1);
  }
}
