/**
 * Walkthrough for the accountant (docs/demo/prenos-2027): year-end close of 2026 and the carry-over of the balances
 * into 2027 on the demo firm „ДЕМО ПРОИЗВОДСТВО ДООЕЛ“ (seeded by test/demo/prenos-seed.test.ts).
 *
 * Not part of the regular suite: runs only with `E2E_DEMO_OUT=<dir>` (numbered full-page PNGs). With
 * `E2E_DEMO_FRAMES=<dir>` the screen is also recorded through the Chrome DevTools screencast (JPEG frames + their
 * time stamps in frames.json) — e2e/demo-video.mjs turns them into a video without ffmpeg.
 * The browser's own confirmation dialogs cannot be photographed, so the step first cancels the dialog, shows its
 * exact text in an overlay for the picture, then repeats the click and accepts.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { ADMIN } from './helpers';

const OUT = process.env.E2E_DEMO_OUT ?? '';
const FRAMES = process.env.E2E_DEMO_FRAMES ?? '';
const FIRM = 'ДЕМО ПРОИЗВОДСТВО ДООЕЛ';
const STEP = Number(process.env.E2E_DEMO_STEP_MS ?? 800);

test.skip(!OUT, 'demo walkthrough: set E2E_DEMO_OUT');
test.use({ viewport: { width: 1440, height: 900 } });

let n = 0;
let recording = true;
const captions: [string, string][] = [];

/**
 * The local PGlite dev database can mix up overlapping queries („unnamed prepared statement does not exist“, see
 * e2e/README.md — production runs Postgres); a screen that hit it shows the error box: load it again.
 */
async function healthy(page: Page) {
  for (let i = 0; i < 3 && await page.getByText('Се појави грешка').count(); i++) {
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  }
  await expect(page.getByText('Се појави грешка')).toHaveCount(0);
}

async function shot(page: Page, name: string, caption: string, opts: { fullPage?: boolean; clip?: Locator } = {}) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  if (!(await page.locator('#demoConfirm').count())) await healthy(page);
  const file = `${String(++n).padStart(2, '0')}-${name}.png`;
  recording = false;
  try {
    if (opts.clip) await opts.clip.screenshot({ path: join(OUT, file) });
    else await page.screenshot({ path: join(OUT, file), fullPage: opts.fullPage ?? true });
  } finally { recording = true; }
  captions.push([file, caption]);
  await page.waitForTimeout(STEP);
}

/** Red outline on the element about to be used, so the video shows where the click goes. */
async function mark(el: Locator) {
  await el.scrollIntoViewIfNeeded();
  await el.evaluate((e: HTMLElement) => { e.dataset.demoMark = '1'; e.style.outline = '3px solid #e5383b'; e.style.outlineOffset = '2px'; e.style.boxShadow = '0 0 0 6px rgba(229,56,59,.25)'; });
  await el.page().waitForTimeout(STEP);
}
async function unmark(page: Page) {
  await page.evaluate(() => document.querySelectorAll<HTMLElement>('[data-demo-mark]').forEach((e) => { e.style.outline = ''; e.style.boxShadow = ''; delete e.dataset.demoMark; })).catch(() => {});
}
async function click(el: Locator) { await mark(el); await el.click(); await unmark(el.page()); }

/** Draws a browser-style dialog with `msg` over the page (the real one blocks the page and cannot be photographed). */
async function showDialog(page: Page, msg: string, cancel: boolean) {
  await page.evaluate(([m, c]) => {
    const o = document.createElement('div');
    o.id = 'demoConfirm';
    o.innerHTML = `<div style="position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:99999;display:flex;align-items:flex-start;justify-content:center;padding-top:90px;font:14px system-ui,Segoe UI,sans-serif">
      <div style="background:#fff;color:#202124;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.35);width:560px;padding:22px 24px 18px">
        <div style="font-weight:600;margin-bottom:10px">${location.host} вели</div>
        <div class="demoMsg" style="white-space:pre-wrap;line-height:1.45"></div>
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px">
          ${c ? '<span style="padding:7px 18px;border:1px solid #dadce0;border-radius:6px;color:#1a73e8">Откажи</span>' : ''}
          <span style="padding:7px 22px;border-radius:6px;background:#1a73e8;color:#fff;outline:3px solid #e5383b;outline-offset:2px">OK</span>
        </div></div></div>`;
    (o.querySelector('.demoMsg') as HTMLElement).textContent = m as string;
    document.body.appendChild(o);
  }, [msg, cancel] as const);
  await page.waitForTimeout(STEP * 2);
}
const hideDialog = (page: Page) => page.evaluate(() => document.getElementById('demoConfirm')?.remove());

/** A native confirm(): cancel it once to read its text, show the text for the picture, then repeat and accept. */
async function confirmStep(page: Page, act: () => Promise<unknown>, name: string, caption: string) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await healthy(page);
  let msg = '';
  page.once('dialog', (d) => { msg = d.message(); void d.dismiss(); });
  await act();
  await expect.poll(() => msg).not.toBe('');
  await showDialog(page, msg, true);
  await shot(page, name, caption, { fullPage: false });
  await hideDialog(page);
  page.once('dialog', (d) => { void d.accept(); });
  await act();
  return msg;
}

test('year-end 2026 → carry-over into 2027 (demo walkthrough)', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  mkdirSync(OUT, { recursive: true });
  // the Next.js dev-server badge (bottom left) is not part of the program
  await page.addInitScript(() => {
    const css = 'nextjs-portal{display:none!important}';
    const add = () => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); };
    if (document.head) add(); else document.addEventListener('DOMContentLoaded', add);
  });
  const frames: { f: string; t: number }[] = [];
  if (FRAMES) {
    mkdirSync(FRAMES, { recursive: true });
    const cdp = await page.context().newCDPSession(page);
    let i = 0;
    cdp.on('Page.screencastFrame', (e) => {
      void cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {});
      if (!recording) return;
      const f = `${String(++i).padStart(5, '0')}.jpg`;
      writeFileSync(join(FRAMES, f), Buffer.from(e.data, 'base64'));
      frames.push({ f, t: e.metadata.timestamp ?? Date.now() / 1000 });
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 82, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1 });
  }

  try {
    // 1. login
    await page.goto('/login');
    await page.locator('input[name=username]').fill(ADMIN.user);
    await page.locator('input[name=password]').fill(ADMIN.pass);
    await shot(page, 'najava', 'Најава во програмата (корисник и лозинка).');
    await click(page.getByRole('button', { name: 'Најави се' }));
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));

    // 2. year screen: 2026
    const yp = page.locator('#yearPicker');
    await expect(yp).toBeVisible();
    await shot(page, 'izbor-godina', 'По најавата прво се избира годината – избираме 2026.');
    const y26 = yp.getByRole('listitem').filter({ hasText: /^2026/ });
    if (await y26.count()) await click(y26.first());
    else await click(yp.getByRole('button', { name: /Продолжи во/ }));
    await expect(yp).toHaveCount(0);

    // 3. firm
    await page.goto('/');
    const picker = page.getByRole('heading', { name: /Изберете фирма/ });
    await expect(page.locator('#nav > .mg:visible, h1:has-text("Изберете фирма")').first()).toBeVisible();
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    if (await picker.count()) {
      await shot(page, 'izbor-firma', 'Листа на фирми за 2026 – ја отвораме „ДЕМО ПРОИЗВОДСТВО ДООЕЛ“.');
      await click(page.getByText(FIRM, { exact: true }).first());
      await expect(picker).toHaveCount(0);
    }
    await expect(page.locator('#firmName')).toHaveText(FIRM);
    await shot(page, 'firma-2026', 'Фирмата е отворена во 2026 (горе: фирма и година).');

    // 4. Завршна сметка по фази
    await page.goto('/zsProc');
    await expect(page.locator('a[href="/mbyllja"]').first()).toBeVisible();
    await shot(page, 'zavrsna-smetka-fazi', 'Финансово › Завршна сметка – по фази: годината 2026 уште не е затворена, контролата е чиста.');

    // 5. Затворање
    await click(page.locator('.card', { has: page.locator('h2', { hasText: '3. Затворање' }) }).locator('a[href="/mbyllja"]').first());
    await page.waitForURL(/\/mbyllja/);
    await expect(page.getByRole('button', { name: 'Затвори ја годината 2026' })).toBeVisible();
    await shot(page, 'zatvoranje-pred', 'Затворање на година 2026: контроли, резултат (класи 4 и 7 → 8000), данок на добивка и нето добивка → 951.');

    const closeBtn = page.getByRole('button', { name: 'Затвори ја годината 2026' });
    await mark(closeBtn);
    const msg = await confirmStep(page, () => closeBtn.click(), 'zatvoranje-potvrda', 'Потврда пред затворањето: износот на данокот и нето резултатот, и дека салдата ќе се пренесат во 2027.');
    expect(msg).toContain('31.12.2026');
    await unmark(page);
    // the result comes as the browser's alert(): read it, show it for the picture
    let done = '';
    page.once('dialog', (d) => { done = d.message(); void d.accept(); });
    await expect.poll(() => done, { timeout: 120_000 }).not.toBe('');
    expect(done).toContain('пренесени');
    await page.waitForLoadState('networkidle').catch(() => {});
    await showDialog(page, done, false);
    await shot(page, 'zatvoranje-poraka', 'Пораката по затворањето: резултатот, данокот и колку ставки се пренесени во 2027 (должи = побарува).', { fullPage: false });
    await hideDialog(page);
    const ok = page.locator('.callout.good').filter({ hasText: /е затворена/ }).first();
    await expect(ok).toBeVisible({ timeout: 60_000 });
    await shot(page, 'zatvoranje-uspeh', 'Годината 2026 е затворена (налог 999 на 31.12.2026); копчињата сега се „Пресметај повторно“ и „Поништи затворање“.');

    // 6. Пренос на салда
    await click(page.getByRole('link', { name: /Пренос во 2027/ }).first());
    await page.waitForURL(/\/prenos/);
    await expect(page.getByText('Контрола на преносот 2026 → 2027')).toBeVisible();
    await shot(page, 'prenos-neprenseni', 'Пренос на салда, филтер „Непренесени и разлики“: класите 4/7 и контата со салдо нула не се пренесуваат – со причина.');
    await click(page.getByRole('link', { name: 'Пренесени', exact: true }));
    await page.waitForURL(/f=carried/);
    await shot(page, 'prenos-preneseni', 'Филтер „Пренесени“: секое конто и секој партнер – салдо 31.12.2026 = почетна 01.01.2027 (✓ пренесено).');
    await click(page.getByRole('link', { name: 'Сите', exact: true }));
    await page.waitForURL(/f=all/);
    await shot(page, 'prenos-site', 'Филтер „Сите“: целата евиденција на преносот.');
    const totals = page.locator('#carryEv .card').first();
    await totals.scrollIntoViewIfNeeded();
    await mark(totals);
    await shot(page, 'prenos-kontrola-vkupno', 'Контрола: Вкупно затворање = Вкупно почетна, должи = побарува, актива = пасива.', { clip: totals });
    await unmark(page);
    const pdf = page.locator('#carryEv').getByRole('button', { name: /PDF/ }).first();
    const xls = page.locator('#carryEv').getByRole('button', { name: /Excel/ }).first();
    await mark(pdf);
    await mark(xls);
    await shot(page, 'prenos-pdf-excel', 'Копчињата „PDF“ и „Excel“ ја печатат / извезуваат евиденцијата на преносот.', { fullPage: false });
    await unmark(page);
    // the Excel file itself (saved next to the pictures; the PDF is made by the server's PDF service and opens in a new tab)
    const dl = page.waitForEvent('download', { timeout: 60_000 });
    await xls.click();
    await (await dl).saveAs(join(OUT, 'prenos-2026-2027.xlsx'));

    // 7. switch the year to 2027
    await page.goto('/prenos?f=all');
    const ys = page.locator('#yearSel');
    await mark(ys);
    await confirmStep(page, () => ys.selectOption('2027'), 'promena-godina-potvrda', 'Промена на година горе десно: програмот бара потврда „Да се премине во година 2027?“.');
    await unmark(page);
    await expect(page.locator('#yearSel')).toHaveValue('2027');
    await page.waitForLoadState('networkidle').catch(() => {});

    // 8. Почетна состојба 2027
    await page.goto('/pocetna');
    await expect(page.locator('#yearSel')).toHaveValue('2027');
    await shot(page, 'pocetna-2027', 'Почетна состојба 2027: пренесените салда од 31.12.2026 (налог 0 на 01.01.2027), по конто и по партнер.');

    // 9. Налози 2027
    await page.goto('/nalozi');
    await shot(page, 'nalozi-2027', 'Налози 2027: налогот 0 „Почетна состојба 2027“ (01.01.2027) е првиот налог; по него налозите од документите на 2027.');
    const openJ = page.locator('tr', { hasText: 'Почетна состојба 2027' }).getByRole('link', { name: 'Отвори' }).or(page.locator('tr', { hasText: 'Почетна состојба 2027' }).getByRole('button', { name: 'Отвори' })).first();
    if (await openJ.count()) {
      const before = page.url();
      await click(openJ);
      await page.waitForURL((u) => u.toString() !== before);
      await page.waitForLoadState('networkidle').catch(() => {});
      await shot(page, 'nalog-pocetna-2027', 'Ставките на налогот за почетна состојба 2027.');
    }

    // 10. Бруто биланс 2027
    await page.goto('/bilanc');
    await shot(page, 'bruto-bilans-2027', 'Бруто биланс 2027: колоните „Поч. сост.“ се салдата од 31.12.2026; прометот на 2027 (првата фактура) е во колоните „од тек. година“.');

    // 11. a customer's card in 2027
    await page.goto('/kartici?k=1200');
    await page.waitForLoadState('networkidle').catch(() => {});
    await shot(page, 'kartica-1200-2027', 'Аналитичка картица 1200 Купувачи во 2027 – по партнер, од пренесеното салдо.');
    const cust = page.getByRole('link', { name: /МАРКЕТ ПЛУС/ }).first();
    if (await cust.count()) {
      await click(cust);
      await page.waitForURL(/pid=/);
      await expect(page.getByRole('cell', { name: 'Почетна состојба 2027' }).first()).toBeVisible();
      await shot(page, 'kartica-market-plus-2027', 'Картица на МАРКЕТ ПЛУС во 2027: прв ред е почетното салдо 334.760,00 (неплатеното од 2026), потоа новата фактура од 15.01.2027.');
    }
  } finally {
    writeFileSync(join(OUT, 'captions.json'), JSON.stringify(captions, null, 1));
    if (FRAMES) writeFileSync(join(FRAMES, 'frames.json'), JSON.stringify(frames));
  }
});
