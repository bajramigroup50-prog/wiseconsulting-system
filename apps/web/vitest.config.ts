import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests next to the code + workflow tests in `test/flows` (server actions on PGlite, see test/harness.ts).
// `e2e/` is the Playwright suite (`pnpm --filter @wise/web e2e`), not vitest.
export default defineConfig({
  // tsconfig keeps JSX for Next (`preserve`); page components rendered in tests need the automatic runtime
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: [
      { find: /^@\//, replacement: fileURLToPath(new URL('./', import.meta.url)) },
      { find: /^server-only$/, replacement: fileURLToPath(new URL('./test/server-only.ts', import.meta.url)) },
    ],
  },
  test: {
    exclude: ['e2e/**', 'node_modules/**', '.next/**'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    maxWorkers: 4,
  },
});
