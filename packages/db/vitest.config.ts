import { defineConfig } from 'vitest/config';

// PGlite tests run migrations and whole document flows; under the parallel monorepo `pnpm test` the 5 s default is
// too tight on slower machines.
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 120_000 } });
