/**
 * Speed + robustness smoke of every menu view (see e2e/README.md, „Smoke of every view“): log in as the administrator,
 * pick the year and a firm, then open every view of the admin menu by its URL and record per view
 *   - the server response (TTFB) and the time until the page is ready (`readyMs`: navigation start → no request for
 *     500 ms, minus those 500 ms — the page is rendered, hydrated and its own fetches are done),
 *   - console errors, page errors, React hydration warnings, failed / 5xx requests, the error boundary,
 *   - a busy marker (`aria-busy="true"`, „Се вчитува…“) still on screen after the page settled.
 * Fails when a view has an error or is slower than `E2E_MAX_MS` (default 2000 ms). The table is written to
 * `test-results/smoke-all-views.json` (and printed).
 *
 * Env: E2E_FIRM (firm name to open; default: the first firm in the picker), E2E_YEAR (default: the preselected year),
 * E2E_MAX_MS, E2E_VIEWS=banka,nalozi (only these view ids), E2E_SKIP=… (view ids to leave out).
 * Run it against `next start` (production build) for meaningful timings — the dev server compiles each screen on its
 * first open, so its first visit is always slow.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { navFlat, navFor, hrefFor } from '../lib/nav';
import { ERROR_TEXT, chooseYear, login } from './helpers';

const MAX_MS = Number(process.env.E2E_MAX_MS ?? 2000);
/** Views that leave the firm or the session — not screens to time. */
const SKIP = new Set(['izlezF', ...(process.env.E2E_SKIP?.split(',') ?? [])]);

export interface ViewResult { id: string; label: string; path: string; at: number; status: number; ttfbMs: number; dclMs: number; readyMs: number; problems: string[] }

async function pickFirm(page: Page) {
  await page.goto('/');
  const picker = page.getByRole('heading', { name: /Изберете фирма/ });
  await expect(page.locator('#nav > .mg:visible, h1:has-text("Изберете фирма")').first()).toBeVisible();
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  if (!(await picker.count())) return;
  const name = process.env.E2E_FIRM;
  if (name) await page.getByText(name, { exact: true }).first().click();
  else await page.locator('main').getByRole('button').or(page.locator('main a[href]')).filter({ hasText: /\S/ }).first().click();
  await expect(picker).toHaveCount(0);
  await expect(page.locator('#nav > .mg').first()).toBeVisible();
}

test('every view opens fast and without errors', async ({ page }) => {
  test.setTimeout(60 * 60_000);
  const problems: string[] = [];
  const on = (m: string) => problems.push(m);
  const benign = (t: string) => /Download the React DevTools|\[Fast Refresh\]|\[HMR\]|favicon/.test(t);
  page.on('console', (m) => {
    const t = m.text();
    if (benign(t)) return;
    if (m.type() === 'error') on('console: ' + t.slice(0, 300));
    else if (m.type() === 'warning' && /hydrat/i.test(t)) on('hydration: ' + t.slice(0, 300));
  });
  page.on('pageerror', (e) => on('pageerror: ' + e.message.slice(0, 300)));
  page.on('requestfailed', (r) => { const f = r.failure()?.errorText ?? ''; if (!/ERR_ABORTED/.test(f)) on(`failed ${r.method()} ${r.url()} ${f}`); });
  page.on('response', (r) => { if (r.status() >= 500) on(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });

  await login(page);
  if (process.env.E2E_YEAR) { await page.goto('/'); await chooseYear(page, Number(process.env.E2E_YEAR)); }
  await pickFirm(page);
  problems.splice(0);

  const only = process.env.E2E_VIEWS?.split(',');
  const seen = new Set<string>();
  const views: { id: string; label: string }[] = [];
  for (const [, items] of navFor('admin')) for (const [id, label] of navFlat(items)) {
    if (seen.has(id) || SKIP.has(id) || (only && !only.includes(id))) continue;
    seen.add(id); views.push({ id, label });
  }

  const results: ViewResult[] = [];
  for (const v of views) {
    const path = hrefFor(v.id);
    problems.splice(0);
    const t0 = Date.now();
    let status = 0;
    try {
      const res = await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      status = res?.status() ?? 0;
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => on('network never idle (30 s)'));
    } catch (e) { on('navigation: ' + String((e as Error).message).split('\n')[0]); }
    // `networkidle` = 500 ms without requests: that quiet window is not part of the page's own time
    const readyMs = Math.max(0, Date.now() - t0 - 500);
    const { ttfbMs, dclMs } = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      return n ? { ttfbMs: Math.round(n.responseStart - n.requestStart), dclMs: Math.round(n.domContentLoadedEventEnd) } : { ttfbMs: -1, dclMs: -1 };
    }).catch(() => ({ ttfbMs: -1, dclMs: -1 }));
    // a year-end form of another kind of entity (zsNPO / zsTP for a company) answers 404 by design (legacy `ENT_V`)
    const notForFirm = status === 404 && /^\/zs/.test(path);
    if (notForFirm) for (let i = problems.length - 1; i >= 0; i--) if (/status of 404/.test(problems[i]!)) problems.splice(i, 1);
    if (new URL(page.url()).pathname.startsWith('/login')) on('logged out');
    if (await page.getByText(ERROR_TEXT).count()) on('error boundary „' + ERROR_TEXT + '“');
    // something still busy after the page settled: a form stuck in pending, a loader that never ends
    if (await page.locator('[aria-busy="true"]:visible, :text("Се вчитува…"):visible').count()) {
      await page.waitForTimeout(3000);
      if (await page.locator('[aria-busy="true"]:visible, :text("Се вчитува…"):visible').count()) on('busy marker still on screen');
    }
    if (readyMs > MAX_MS) on(`slow: ${readyMs} ms > ${MAX_MS} ms`);
    if (status >= 400 && !notForFirm) on(`HTTP ${status}`);
    const r = { id: v.id, label: v.label, path, at: t0, status, ttfbMs, dclMs, readyMs, problems: [...new Set(problems)] };
    results.push(r);
    console.log(`${r.problems.length ? '✗' : '✓'} ${String(readyMs).padStart(6)} ms  ttfb ${String(ttfbMs).padStart(5)}  ${path}${notForFirm ? '  (404: not for this firm)' : ''}  ${r.problems.join(' | ')}`);
  }

  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/smoke-all-views.json', JSON.stringify(results, null, 1));
  const bad = results.filter((r) => r.problems.length);
  expect(bad.map((r) => `${r.path}: ${r.problems.join(' | ')}`), `${bad.length} of ${results.length} views`).toEqual([]);
});
