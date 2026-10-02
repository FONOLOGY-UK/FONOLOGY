import { API, WEB, assertNotProduction } from './lib/env';

/**
 * Runs once before any test.
 *
 * 1. Refuses the live shop (unless it hasn't opened — see assertNotProduction).
 * 2. Mints the run tag every fixture is named with, and the start time
 *    cleanup scopes to. Environment variables set here are inherited by the
 *    workers, which is how the tests see them.
 * 3. Checks both services answer before the first test, so a server that
 *    isn't running is one clear message rather than fourteen failures.
 */
export default async function globalSetup(): Promise<void> {
  assertNotProduction();

  process.env.E2E_RUN = `PW${Date.now().toString().slice(-8)}`;
  process.env.E2E_STARTED = new Date().toISOString();
  console.log(`\n  e2e run ${process.env.E2E_RUN} against ${WEB} (API ${API})\n`);

  await ready(WEB);
  await ready(`${API}/health`);
}

async function ready(url: string): Promise<void> {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (res.ok) return;
      console.log(`  waiting for ${url} — ${res.status} (attempt ${attempt})`);
    } catch (error) {
      console.log(`  waiting for ${url} — ${(error as Error).message} (attempt ${attempt})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error(`${url} is not answering — is it running?`);
}
