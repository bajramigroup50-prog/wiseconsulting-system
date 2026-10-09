import { defineConfig } from 'vitest/config';

// PGlite tests run migrations and whole document flows. Under the parallel monorepo `pnpm test` the 5 s default is
// too tight, and one PGlite (WASM Postgres) per CPU core can exhaust memory and crash a worker — cap the workers.
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 120_000, maxWorkers: 4 } });
