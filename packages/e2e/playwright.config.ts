import { defineConfig } from '@playwright/test';
import { WEB } from './lib/env';

/**
 * One worker, in file order. The tests share one signed-in browser, and the
 * last one (item 4, the PIN switch) ENDS the owner's session, so they are
 * not safe to parallelise or reorder.
 *
 * Timeouts are generous because the target is a free-plan Render service:
 * slow to wake, not broken.
 */
export default defineConfig({
  testDir: './tests',
  workers: 1,
  fullyParallel: false,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'report' }]],
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  outputDir: './results',
  use: {
    baseURL: WEB,
    viewport: { width: 1366, height: 900 },
    actionTimeout: 45_000,
    navigationTimeout: 120_000,
    screenshot: 'on',
    trace: 'retain-on-failure',
  },
});
