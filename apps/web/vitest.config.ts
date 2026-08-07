import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Unit tests only. The scan-capture module is deliberately framework-agnostic
 * so its timing behaviour can be tested against a real DOM (jsdom) with
 * synthetic keyboard events, without React or a browser in the way.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
