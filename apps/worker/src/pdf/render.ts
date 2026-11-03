/**
 * Generic HTML → PDF for the worker (Phase 9 owns it).
 *
 * Choice: Chromium driven by `playwright-core`. Chromium is the only renderer that prints the legacy HTML
 * views (flexbox, `@page`, Cyrillic fonts, images) the way the browser's print-to-PDF does, so server PDFs
 * match what users print today. `playwright-core` does not download a browser: the worker image installs
 * Debian's `chromium` + DejaVu/Liberation fonts (docker/Dockerfile, worker stage, ~+250 MB) and points
 * `CHROMIUM_PATH` at it. Locally, set `CHROMIUM_PATH` to any Chrome/Edge/Chromium executable.
 * Lighter options (pdfmake, pdf-lib) can't lay out HTML, and wkhtmltopdf is unmaintained.
 *
 * Hardening: JavaScript is disabled and every network request except `data:` URIs is aborted, so the
 * HTML (which may contain user-entered text) can't fetch anything or run scripts. One browser is shared by
 * all jobs; each render gets a fresh context.
 */
import { existsSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';
import { wrapHtml, type PdfInput } from './document';

const CANDIDATES = [
  process.env.CHROMIUM_PATH,
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

export const chromiumPath = (): string | null => CANDIDATES.find((p): p is string => !!p && existsSync(p)) ?? null;

let browser: Promise<Browser> | undefined;

function getBrowser(): Promise<Browser> {
  const exe = chromiumPath();
  if (!exe) throw new Error('Chromium not found: set CHROMIUM_PATH (the worker Docker image installs /usr/bin/chromium).');
  // the worker user has no home directory: Chromium's crashpad handler then dies („--database is required“) and the
  // browser closes at once. A writable HOME / XDG dir for its profile, config and crash database keeps it alive.
  const dir = process.env.CHROMIUM_HOME || '/tmp/wise-chromium';
  browser ??= chromium.launch({
    executablePath: exe,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none', '--disable-crash-reporter', '--disable-breakpad'],
    env: { ...process.env, HOME: dir, XDG_CONFIG_HOME: dir + '/config', XDG_CACHE_HOME: dir + '/cache' },
  })
    .catch((e) => { browser = undefined; throw e; });
  return browser;
}

export async function closeBrowser(): Promise<void> {
  const b = browser;
  browser = undefined;
  if (b) await (await b).close().catch(() => {});
}

/**
 * A table wider than its `.pdfdoc` page (many columns, long names) is shrunk – smaller font and padding, down to 6 px –
 * so it never runs past the paper's edge (the same rule as the print views' `FitTables`).
 */
const FIT_TABLES = `(() => {
  for (const doc of document.querySelectorAll('.pdfdoc')) {
    const W = doc.clientWidth;
    if (!(W > 0)) continue;
    for (const t of doc.querySelectorAll('table')) {
      if (t.scrollWidth <= W + 1) continue;
      const cells = Array.from(t.querySelectorAll('th, td'));
      let fs = parseFloat(getComputedStyle(t).fontSize) || 10;
      for (let i = 0; i < 16 && t.scrollWidth > W + 1 && fs > 6; i++) {
        fs = Math.max(6, fs - 0.5);
        t.style.fontSize = fs + 'px';
        for (const c of cells) { c.style.fontSize = fs + 'px'; c.style.padding = fs < 8 ? '1.5px 2px' : '2px 3px'; }
      }
      if (t.scrollWidth > W + 1) for (const c of cells) if (!c.classList.contains('n')) c.style.wordBreak = 'break-word';
    }
  }
})()`;

/** Render HTML to PDF bytes. */
export async function htmlToPdf(p: PdfInput): Promise<Uint8Array> {
  const b = await getBrowser();
  const ctx = await b.newContext({ javaScriptEnabled: false, offline: false });
  try {
    await ctx.route('**/*', (route) => (route.request().url().startsWith('data:') ? route.continue() : route.abort()));
    const page = await ctx.newPage();
    await page.setContent(wrapHtml(p), { waitUntil: 'load', timeout: 30_000 });
    // the page's own scripts stay off; this runs in an isolated world: a table wider than its page is shrunk to fit
    await page.evaluate(FIT_TABLES).catch(() => {});
    const pdf = await page.pdf({ format: p.format ?? 'A4', landscape: !!p.landscape, printBackground: true, preferCSSPageSize: true });
    return new Uint8Array(pdf);
  } finally {
    await ctx.close();
  }
}

/** Render a self-contained HTML page (social card) to PNG bytes at an exact size. Same hardening as `htmlToPdf`. */
export async function htmlToPng(html: string, size: { width: number; height: number }): Promise<Uint8Array> {
  const b = await getBrowser();
  const ctx = await b.newContext({ javaScriptEnabled: false, viewport: size, deviceScaleFactor: 1 });
  try {
    await ctx.route('**/*', (route) => (route.request().url().startsWith('data:') ? route.continue() : route.abort()));
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    return new Uint8Array(await page.screenshot({ type: 'png', clip: { x: 0, y: 0, ...size } }));
  } finally {
    await ctx.close();
  }
}
