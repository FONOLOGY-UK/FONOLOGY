import { API, API_DIRECT, WEB, assertNotProduction } from './lib/env';

/**
 * Runs once before any test.
 *
 * 1. Refuses production.
 * 2. Mints the run tag every fixture is named with, and the start time
 *    cleanup scopes to. Environment variables set here are inherited by the
 *    workers, which is how the tests see them.
 * 3. Wakes the site. Render's free plan hibernates idle services, and while
 *    one wakes it answers 429 with `x-render-routing: hibernate-rate-limited`
 *    — which reads exactly like an app bug if the first test hits it.
 */
export default async function globalSetup(): Promise<void> {
  assertNotProduction();

  process.env.E2E_RUN = `PW${Date.now().toString().slice(-8)}`;
  process.env.E2E_STARTED = new Date().toISOString();
  console.log(`\n  e2e run ${process.env.E2E_RUN} against ${WEB}\n`);

  // BOTH services — they hibernate independently. The first version woke only
  // the web service, and the first sign-in then got Render's 429 from the API
  // behind the proxy. The API is woken at its OWN address, because requests
  // arriving through the proxy were seen not to wake it; the proxy path is
  // then checked, since that is the one the tests actually use.
  await wake(WEB);
  await wake(`${API_DIRECT}/health`);
  await wake(`${API}/health`);
}

async function wake(url: string): Promise<void> {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (res.ok) return;
      console.log(`  waking ${url} — ${res.status} (attempt ${attempt})`);
    } catch (error) {
      console.log(`  waking ${url} — ${(error as Error).message} (attempt ${attempt})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
  throw new Error(`${url} did not come up after 20 attempts.`);
}
