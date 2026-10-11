/**
 * Flow 12 — navigation smoke in a real browser: log in, create + select a firm, open every menu group and every
 * submenu (flyouts must be on-screen), click through every item and fail on console / hydration errors, 5xx
 * responses and the error boundary text. Then the firm editor: upload a PNG to logo / signature / stamp.
 */
import { expect, test, type Page } from '@playwright/test';
import { ERROR_TEXT, login, newFirm, openFirm, watch } from './helpers';

// 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function groupButtons(page: Page) {
  return page.locator('#nav > .mg > button');
}

async function openGroup(page: Page, i: number) {
  const b = (await groupButtons(page)).nth(i);
  if ((await b.getAttribute('aria-haspopup')) !== 'true') return null;
  if ((await b.getAttribute('aria-expanded')) !== 'true') await b.click();
  const dd = page.locator('#nav .dd');
  await expect(dd).toBeVisible();
  return dd;
}

test('every menu item opens without errors', async ({ page }) => {
  test.setTimeout(90 * 60_000); // ~180 screens, each compiled on first open by the dev server
  const w = watch(page);
  await login(page);
  const firmName = await newFirm(page, `Е2Е НАВИГАЦИЈА ДООЕЛ ${Date.now() % 100000}`, '4030' + String(Date.now()).slice(-9));
  await page.goto('/');
  expect(w.take()).toEqual([]);

  const failures: string[] = [];
  const fail = (m: string) => { failures.push(m); console.log('✗ ' + m); };
  const nGroups = await (await groupButtons(page)).count();
  expect(nGroups).toBeGreaterThan(5);
  const visited = new Set<string>();
  const states = new Set<string>();
  const stateKeys = new Set<string>();

  for (let g = 0; g < nGroups; g++) {
    const gName = (await (await groupButtons(page)).nth(g).innerText()).trim();
    // E2E_GROUPS=Финанс,Плата — only these menu groups (faster local runs)
    if (process.env.E2E_GROUPS && !process.env.E2E_GROUPS.split(',').some((x) => gName.includes(x))) continue;
    const dd = await openGroup(page, g);
    if (!dd) {
      // single-item group: a plain button
      await (await groupButtons(page)).nth(g).click();
      await page.waitForLoadState('networkidle').catch(() => {});
      if (await page.getByText(ERROR_TEXT).count()) fail(`${gName}: error boundary`);
      for (const e of w.take()) fail(`${gName}: ${e}`);
      continue;
    }
    // collect the items: direct ones and those inside submenus (path = [submenu index | -1, item index])
    const direct = await dd.locator(':scope > button[role=menuitem]').allInnerTexts();
    const subs = dd.locator(':scope > .dsub');
    const nSubs = await subs.count();
    const targets: { sub: number; idx: number; label: string }[] = direct.map((label, idx) => ({ sub: -1, idx, label: label.trim() }));
    for (let s = 0; s < nSubs; s++) {
      const sb = subs.nth(s).locator(':scope > button');
      const sLabel = (await sb.innerText()).trim();
      await sb.click();
      const fly = subs.nth(s).locator('.fly');
      await expect(fly).toBeVisible();
      const box = await fly.boundingBox();
      const vp = page.viewportSize()!;
      if (!box || box.x < 0 || box.y < 0 || box.x + box.width > vp.width + 1 || box.y + box.height > vp.height + 1) fail(`${gName} › ${sLabel}: flyout off-screen ${JSON.stringify(box)}`);
      const items = await fly.locator('button[role=menuitem]').allInnerTexts();
      items.forEach((label, idx) => targets.push({ sub: s, idx, label: `${sLabel} › ${label.trim()}` }));
      await sb.click(); // close
    }

    for (const t of targets) {
      console.log(`→ ${gName} › ${t.label}`);
      const before = page.url();
      try {
        const d2 = await openGroup(page, g);
        let btn;
        if (t.sub < 0) btn = d2!.locator(':scope > button[role=menuitem]').nth(t.idx);
        else {
          const sb = d2!.locator(':scope > .dsub').nth(t.sub).locator(':scope > button');
          if ((await sb.getAttribute('aria-expanded')) !== 'true') await sb.click();
          btn = d2!.locator(':scope > .dsub').nth(t.sub).locator('.fly button[role=menuitem]').nth(t.idx);
        }
        await btn.click({ timeout: 15_000 });
      } catch (e) {
        fail(`${gName} › ${t.label}: cannot click the menu item (${String((e as Error).message).split(String.fromCharCode(10))[0]})`);
        await page.goto('/');
        continue;
      }
      await page.waitForURL((u) => u.href !== before, { timeout: 120_000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
      const path = new URL(page.url()).pathname;
      if (path.startsWith('/login')) { fail(`${gName} › ${t.label}: logged out (${path})`); await login(page); await openFirm(page, firmName); continue; }
      // „Излез“ from the firm returns to the firm picker: pick the firm again
      if (await page.getByRole('heading', { name: /Изберете фирма/ }).count()) { w.take(); await openFirm(page, firmName); continue; }
      visited.add(path);
      if (await page.getByText(ERROR_TEXT).count()) fail(`${gName} › ${t.label} (${path}): error boundary`);
      for (const e of w.take()) fail(`${gName} › ${t.label} (${path}): ${e}`);
      // the screen's own states (+ Нов / ?edit / ?banks=1 …): links to the same path with a query, visited below
      for (const h of await page.locator(`#main a[href^="${path}?"]`).evaluateAll((A) => A.map((a) => a.getAttribute('href') ?? ''))) {
        if (/[?&](del|delete|dl|download|print|pdf|csv|xlsx)=/i.test(h)) continue;
        // one link per pattern: `?edit=<id>` of the 30 cities is one state, not 30
        const key = h.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id').replace(/=\d+/g, '=:n');
        if (!stateKeys.has(key)) { stateKeys.add(key); states.add(h); }
      }
    }
    await page.keyboard.press('Escape');
  }
  console.log(`visited ${visited.size} screens`);

  // second pass: every in-screen state link found above (new / edit forms, tabs, filters) — nested forms, function
  // props to client components and similar render errors show up only there
  const L = [...states].slice(0, Number(process.env.E2E_MAX_STATES ?? 400));
  console.log(`visiting ${L.length} screen states`);
  for (const h of L) {
    console.log(`→ ${h}`);
    try {
      await page.goto(h);
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    } catch (e) { fail(`${h}: ${String((e as Error).message).split(String.fromCharCode(10))[0]}`); continue; }
    if (new URL(page.url()).pathname.startsWith('/login')) { fail(`${h}: logged out`); await login(page); await openFirm(page, firmName); continue; }
    if (await page.getByText(ERROR_TEXT).count()) fail(`${h}: error boundary`);
    for (const e of w.take()) fail(`${h}: ${e}`);
  }
  expect(failures, failures.join('\n')).toEqual([]);
});

test('firm editor: logo / signature / stamp upload', async ({ page }) => {
  const w = watch(page);
  await login(page);
  await page.goto('/firmi');
  await page.getByRole('link', { name: 'Измени' }).first().click();
  const form = page.locator('form.firmcard');
  await expect(form).toBeVisible();
  // the image fields sit on one of the tabs
  for (const tab of await page.getByRole('tab').all()) {
    await tab.click();
    if (await form.locator('input[type=file]').first().isVisible()) break;
  }
  const files = form.locator('input[type=file]');
  const n = await files.count();
  expect(n).toBeGreaterThanOrEqual(3);
  for (let i = 0; i < 3; i++) {
    await files.nth(i).setInputFiles({ name: `slika${i}.png`, mimeType: 'image/png', buffer: PNG });
  }
  await expect(form.locator('img[src^="/api/files/"]')).toHaveCount(3);
  await expect(form.getByText(/не може да се прочита/)).toHaveCount(0);
  await form.getByRole('button', { name: 'Во ред · зачувај' }).click();
  await expect(page.getByText('Фирмата е зачувана.')).toBeVisible();
  // the stored image is served back
  const src = await form.locator('img[src^="/api/files/"]').first().getAttribute('src');
  const r = await page.request.get(src!, { maxRedirects: 5 });
  expect(r.status()).toBe(200);
  expect(w.take()).toEqual([]);
});
