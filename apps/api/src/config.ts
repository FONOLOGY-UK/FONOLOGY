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
  // S3-compatible object storage (Garage). Locally the stack's S3 API on
  // :3900 with the dev key from scripts/dev-stack.mjs. Buckets are made by
  // src/scripts/storage-setup.ts.
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1).default('garage'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  // Where a BROWSER reaches the S3 API, for the short-lived signed links to
  // private files (ID documents, buy-in forms). Defaults to S3_ENDPOINT, which
  // is right locally; on a server whose API talks to storage over a private
  // network, this is the public hostname instead.
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  // The public base URL product photos are served from (the product-images
  // bucket's website endpoint): http://localhost:3902 locally.
  STORAGE_PUBLIC_URL: z.string().url(),
  // Postgres, as the fonology_api role (src/scripts/migrate.ts creates it).
  // Locally: postgres://fonology_api:fonology_api@localhost:55432/fonology
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: z.string().default(LOCALHOST_DEFAULT),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // WHICH DEPLOYMENT THIS IS — the live shop, or anything else. Separate from
  // NODE_ENV, which is how the code runs (the API image always sets
  // production). Required whenever NODE_ENV=production: a live server that
  // forgot to say so must not quietly count as "development" and let the
  // test-data guards below wave test writes through.
  APP_ENV: z.enum(['development', 'production']).optional(),
  // Pre-launch only: lets the test suites and seed scripts write to a
  // production database, and lets the API run there with a Stripe TEST key.
  // Removed on opening day — see the go-live notes in CLAUDE.md.
  ALLOW_TEST_WRITES: z.enum(['true', 'false']).optional(),

  // The customer-facing origin, for building links that go INTO an email —
  // the API has no other way to know where the storefront actually lives.
  WEB_APP_URL: z.string().url().default(LOCALHOST_DEFAULT),

  // SMTP for transactional email, e.g. smtp://localhost:1025 for the local
  // stack's Mailpit. When set it is used instead of Brevo's HTTP API.
  SMTP_URL: z.string().url().optional(),

  // Where browsers reach THIS API — Google sends the visitor back to
  // ${API_PUBLIC_URL}/auth/google/callback, which must also be listed as an
  // authorised redirect URI on the Google OAuth client.
  API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
  // Google sign-in. Optional: without both, GET /auth/providers reports
  // Google unavailable and the storefront hides the option's redirect.
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),

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
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.APP_ENV) {
    // eslint-disable-next-line no-console
    console.error(
      '[config] APP_ENV must be set (production, or development) when NODE_ENV=production.',
    );
    process.exit(1);
  }
  return parsed.data;
}

const env = loadConfig();

export const config = {
  s3: {
    endpoint: env.S3_ENDPOINT,
    publicEndpoint: env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
  storagePublicUrl: env.STORAGE_PUBLIC_URL.replace(/\/$/, ''),
  databaseUrl: env.DATABASE_URL,
  databasePoolMax: env.DATABASE_POOL_MAX,
  port: env.PORT,
  corsOrigins: env.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  isProduction: env.NODE_ENV === 'production',
  appEnv: env.APP_ENV ?? 'development',
  allowTestWrites: env.ALLOW_TEST_WRITES === 'true',
  webAppUrl: env.WEB_APP_URL,
  apiPublicUrl: env.API_PUBLIC_URL.replace(/\/$/, ''),
  smtpUrl: env.SMTP_URL,
  google:
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
      : null,
  brevoApiKey: env.BREVO_API_KEY,
  brevoSenderEmail: env.BREVO_SENDER_EMAIL,
  brevoSenderName: env.BREVO_SENDER_NAME,
  stripeSecretKey: env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
  internalProxySecret: env.INTERNAL_PROXY_SECRET,
} as const;

/**
 * Scripts that write test data (seed, e2e, cleanup) call this first: refused
 * on the live shop's deployment unless ALLOW_TEST_WRITES=true.
 */
export function assertTestWritesAllowed(script: string): void {
  if (config.appEnv === 'production' && !config.allowTestWrites) {
    // eslint-disable-next-line no-console
    console.error(
      `[${script}] refusing: APP_ENV=production and ALLOW_TEST_WRITES is not true — this would write test data into the live shop.`,
    );
    process.exit(2);
  }
}

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
 * It is not part of the env schema on purpose: the scheduled jobs import this
 * module too, never serve a request, and are not given CORS_ORIGINS or
 * WEB_APP_URL — checking these there made every run exit 1 and the retention
 * purges silently stop.
 *
 * Also refuses a Stripe LIVE key outside production, and a TEST key in
 * production unless ALLOW_TEST_WRITES says this is pre-launch testing.
 */
export function assertServerConfig(): void {
  const problems: string[] = [];
  const stripeKey = config.stripeSecretKey ?? '';
  if (config.appEnv !== 'production' && stripeKey.startsWith('sk_live_')) {
    problems.push(
      'STRIPE_SECRET_KEY is a LIVE key outside production (APP_ENV is not production) — real cards would be charged.',
    );
  }
  if (
    config.appEnv === 'production' &&
    stripeKey.startsWith('sk_test_') &&
    !config.allowTestWrites
  ) {
    problems.push(
      'STRIPE_SECRET_KEY is a TEST key in production — customers could not pay. (Set ALLOW_TEST_WRITES=true only while testing before opening.)',
    );
  }
  if (config.appEnv === 'production' && config.allowTestWrites) {
    // eslint-disable-next-line no-console
    console.warn(
      '[config] ALLOW_TEST_WRITES is ON in production — test data may be written. Remove it before the shop opens.',
    );
  }
  if (!config.isProduction) {
    if (problems.length) {
      // eslint-disable-next-line no-console
      console.error(`[config] ${problems.join(' ')}`);
      process.exit(1);
    }
    return;
  }
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
  if (config.google && new URL(config.apiPublicUrl).hostname === 'localhost') {
    problems.push(
      "API_PUBLIC_URL must be the API's real public origin in production when Google sign-in is configured — Google would send visitors back to localhost.",
    );
  }
  if (problems.length) {
    // eslint-disable-next-line no-console
    console.error(`[config] ${problems.join(' ')}`);
    process.exit(1);
  }
}
