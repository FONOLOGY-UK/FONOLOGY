#!/usr/bin/env node
/**
 * Creates the two local env files from the committed examples, filled in with the local dev stack's
 * defaults (`pnpm stack:up`): Postgres, Garage storage, Mailpit, and the two apps' own URLs. Nothing here is a secret — they are the fixed values the Docker stack
 * ships with.
 *
 * Leaves the Stripe test keys blank: those come from the person's own Stripe TEST account
 * (dashboard.stripe.com/test/apikeys, and `stripe listen` for the webhook secret). Without them the
 * storefront has no card form.
 *
 * Never overwrites an existing file.  pnpm setup:env
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const API_DEFAULTS = {
  DATABASE_URL: 'postgres://fonology_api:fonology_api@localhost:55432/fonology',
  S3_ENDPOINT: 'http://localhost:3900',
  S3_ACCESS_KEY_ID: 'GK0f0e1a2b3c4d5e6f70819a2b',
  S3_SECRET_ACCESS_KEY: '9b1e4c7a2d5f8e0b3a6c9d2f5e8b1a4c7d0e3f6a9b2c5d8e1f4a7b0c3d6e9f2a',
  SMTP_URL: 'smtp://localhost:1025',
};
const WEB_DEFAULTS = {
  NEXT_PUBLIC_API_BASE_URL: 'http://localhost:4000',
};

function build(example, defaults) {
  const seen = new Set();
  const lines = readFileSync(example, 'utf8')
    .split('\n')
    .map((line) => {
      const m = /^(#\s*)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
      if (!m) return line;
      const [, , key, value] = m;
      if (key in defaults) {
        seen.add(key);
        return `${key}=${defaults[key]}`;
      }
      return line;
    });
  for (const [key, value] of Object.entries(defaults))
    if (!seen.has(key)) lines.push(`${key}=${value}`);
  return lines.join('\n');
}

for (const [dir, defaults] of [
  ['apps/api', API_DEFAULTS],
  ['apps/web', WEB_DEFAULTS],
]) {
  const target = join(root, dir, '.env.local');
  if (existsSync(target)) {
    console.log(`[setup:env] ${dir}/.env.local already exists — left alone`);
    continue;
  }
  writeFileSync(target, build(join(root, dir, '.env.example'), defaults));
  console.log(`[setup:env] wrote ${dir}/.env.local`);
}

console.log(`
Next: add your Stripe TEST keys (they start sk_test_ / whsec_ / pk_test_):
  apps/api/.env.local  ->  STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
  apps/web/.env.local  ->  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
Never put a LIVE key (sk_live_) in either file.`);
