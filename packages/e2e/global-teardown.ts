import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMPLOYEE, OWNER } from './lib/env';

/**
 * Removes everything this run created, by handing the run tag to the
 * API-owned cleanup script.
 *
 * The cleanup lives in apps/api on purpose. Deleting rows needs the Supabase
 * service-role key, and apps/api is the only package that holds it — the
 * test package never gets database access of its own.
 *
 * Runs even when tests fail (Playwright calls teardown regardless), because
 * a half-finished run is exactly when fixtures are left lying around.
 */
export default async function globalTeardown(): Promise<void> {
  if (process.env.E2E_SKIP_CLEANUP === '1') {
    console.log(
      `\n  E2E_SKIP_CLEANUP=1 — leaving run ${process.env.E2E_RUN}'s fixtures in place.\n`,
    );
    return;
  }
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const cmd =
    `pnpm --filter @fonology/api exec tsx scripts/e2e-cleanup.ts` +
    ` --run ${process.env.E2E_RUN} --since ${process.env.E2E_STARTED}` +
    ` --owner ${OWNER.email} --employee ${EMPLOYEE.email}`;
  try {
    execSync(cmd, { cwd: repoRoot, stdio: 'inherit' });
  } catch {
    console.error(
      `\n  Cleanup did not complete. Fixtures from run ${process.env.E2E_RUN} may remain.` +
        `\n  It needs apps/api/.env.local (the dev service key). Run it by hand from the repo root:\n\n    ${cmd}\n`,
    );
  }
}
