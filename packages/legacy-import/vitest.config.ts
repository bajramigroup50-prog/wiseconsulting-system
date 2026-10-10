import { defineConfig } from 'vitest/config';

// The importer tests run migrations on PGlite (WASM Postgres) and whole firm imports.
export default defineConfig({ test: { testTimeout: 120_000, hookTimeout: 120_000, maxWorkers: 2 } });
