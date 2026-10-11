import { defineConfig } from '@playwright/test';

/**
 * End-to-end suite against a running dev server (see e2e/README.md). Uses the locally installed Chrome
 * (`E2E_CHANNEL=msedge` for Edge) — no browser download.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 15 * 60_000,
  expect: { timeout: 20_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3107',
    channel: process.env.E2E_CHANNEL ?? 'chrome',
    headless: process.env.E2E_HEADED ? false : true,
    viewport: { width: 1366, height: 800 },
    locale: 'mk-MK',
    actionTimeout: 30_000,
    navigationTimeout: 120_000,
    trace: 'off',
  },
});
