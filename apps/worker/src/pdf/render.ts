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
  browser ??= chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'] })
    .catch((e) => { browser = undefined; throw e; });
  return browser;
}

export async function closeBrowser(): Promise<void> {
  const b = browser;
  browser = undefined;
  if (b) await (await b).close().catch(() => {});
}

/** Render HTML to PDF bytes. */
export async function htmlToPdf(p: PdfInput): Promise<Uint8Array> {
  const b = await getBrowser();
  const ctx = await b.newContext({ javaScriptEnabled: false, offline: false });
  try {
    await ctx.route('**/*', (route) => (route.request().url().startsWith('data:') ? route.continue() : route.abort()));
    const page = await ctx.newPage();
    await page.setContent(wrapHtml(p), { waitUntil: 'load', timeout: 30_000 });
    const pdf = await page.pdf({ format: p.format ?? 'A4', landscape: !!p.landscape, printBackground: true, preferCSSPageSize: true });
    return new Uint8Array(pdf);
  } finally {
    await ctx.close();
  }
}
