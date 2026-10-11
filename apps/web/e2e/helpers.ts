import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';

/** Test credentials: env first, then apps/web/.env.local (local only, never committed). */
function envLocal(): Record<string, string> {
  try {
    const txt = readFileSync(fileURLToPath(new URL('../.env.local', import.meta.url)), 'utf8');
    return Object.fromEntries(txt.split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  } catch { return {}; }
}
const E = envLocal();
export const ADMIN = {
  user: process.env.E2E_USER ?? E.ADMIN_USERNAME ?? 'admin',
  pass: process.env.E2E_PASSWORD ?? E.ADMIN_PASSWORD ?? '',
};

export const ERROR_TEXT = 'Се појави грешка';

/** Collects console errors, page errors and 5xx responses; `take()` returns and clears them. */
export function watch(page: Page) {
  const errs: string[] = [];
  const ignore = (t: string) =>
    /Download the React DevTools|\[Fast Refresh\]|\[HMR\]|favicon|ERR_ABORTED|net::ERR_|Failed to load resource: the server responded with a status of 404/.test(t);
  page.on('console', (m) => { if (m.type() === 'error' && !ignore(m.text())) errs.push('console: ' + m.text().slice(0, 600)); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + (e.stack ?? e.message).slice(0, 600)));
  page.on('response', (r) => { if (r.status() >= 500) errs.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });
  return { take: () => errs.splice(0) };
}

export async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[name=username]').fill(ADMIN.user);
  await page.locator('input[name=password]').fill(ADMIN.pass);
  await page.getByRole('button', { name: 'Најави се' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await chooseYear(page);
}

/** After the login the year screen comes first: continue in the preselected (calendar) year, or `year`. */
export async function chooseYear(page: Page, year?: number) {
  const yp = page.locator('#yearPicker');
  await expect(yp.or(page.locator('#nav > .mg, h1:has-text("Изберете фирма")')).first()).toBeVisible();
  if (!(await yp.count())) return;
  if (year) await yp.getByRole('listitem').filter({ hasText: new RegExp(`^${year}`) }).click();
  else await yp.getByRole('button', { name: /Продолжи во/ }).click();
  await expect(yp).toHaveCount(0);
}

/** Creates a firm through the full firm form (VAT monthly) and opens it. Returns its name. */
export async function newFirm(page: Page, name: string, edb: string) {
  await page.goto('/firmi?nova');
  const f = page.locator('form.firmcard');
  await f.locator('input[name=name]').fill(name);
  await f.locator('input[name=edb]').fill(edb);
  await f.locator('input[name=embs]').fill('7' + edb.slice(-6));
  await f.locator('input[name=address]').fill('ул. Тест 1');
  await f.locator('input[name=city]').fill('Скопје');
  await f.locator('input[name=bank]').fill('300000000012345');
  // VAT tab: monthly period
  const ddvTab = page.getByRole('tab', { name: /ДДВ/ });
  if (await ddvTab.count()) await ddvTab.first().click();
  await f.locator('select[name=vatPeriod]').selectOption('month');
  await f.getByRole('button', { name: 'Во ред · зачувај' }).click();
  await expect(page.getByText(/Фирмата е креирана|Отвори ја фирмата/).first()).toBeVisible();
  await openFirm(page, name);
  return name;
}

/** Selects the firm in the full-screen picker (or does nothing when it is already the current firm). */
export async function openFirm(page: Page, name: string) {
  await page.goto('/');
  const picker = page.getByRole('heading', { name: /Изберете фирма/ });
  await expect(page.locator('#nav > .mg:visible, h1:has-text("Изберете фирма")').first()).toBeVisible();
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  if (await picker.count()) {
    await page.getByText(name, { exact: true }).first().click();
    await expect(picker).toHaveCount(0);
  }
  await expect(page.locator('#nav > .mg').first()).toBeVisible();
}

export async function noErrorBoundary(page: Page) {
  await expect(page.getByText(ERROR_TEXT)).toHaveCount(0);
}
