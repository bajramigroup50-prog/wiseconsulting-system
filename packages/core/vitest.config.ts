import { defineConfig } from 'vitest/config';

// Golden tests replay legacy code in node:vm and can exceed the 5 s default when the whole monorepo tests in parallel.
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000 } });
