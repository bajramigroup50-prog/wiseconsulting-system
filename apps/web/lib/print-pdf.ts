/**
 * Server PDF of a print view (Phase 9 `pdf.render`): the „PDF“ button next to the browser print button posts the
 * print area's HTML plus the page's CSS (the legacy print CSS as the browser loaded it — so nothing has to be read
 * from `legacy-injected.css` at runtime and it works in the `next build` output) to `POST /api/pdf`, which queues
 * `renderPdf` and returns the pre-allocated file id; the browser polls `/api/files/{id}` until it is stored.
 *
 * Pure helpers (no `server-only`) so they can be unit-tested; the route is `app/api/pdf/route.ts`, the browser
 * side is `serverPdf` below (React `PdfButton` and the static payroll print pages share it).
 */

export interface PrintPdfRequest { html: string; css: string; title: string; landscape: boolean; /** Add the PDF to this document package (legacy PKG_REP). */ pkg: string | null }

export const PDF_MAX_HTML = 6_000_000;
export const PDF_MAX_CSS = 1_500_000;

/** Validate the JSON body of `POST /api/pdf`. */
export function parsePrintPdfRequest(b: unknown): PrintPdfRequest | { error: string } {
  const o = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
  const html = typeof o.html === 'string' ? o.html : '';
  const css = typeof o.css === 'string' ? o.css : '';
  if (!html.trim()) return { error: 'Нема содржина за PDF.' };
  if (html.length > PDF_MAX_HTML || css.length > PDF_MAX_CSS) return { error: 'Документот е преголем за PDF – користете „Печати“.' };
  const title = (typeof o.title === 'string' ? o.title : '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 150) || 'Документ';
  const pkg = typeof o.pkg === 'string' && /^[0-9a-f-]{36}$/i.test(o.pkg) ? o.pkg : null;
  return { html, css, title, landscape: o.landscape === true, pkg };
}

const FILE_SRC = /(src=")(?:https?:\/\/[^"/]+)?\/api\/files\/([0-9a-f-]{36})(?:\?[^"]*)?(")/gi;

/** File ids referenced as images (`<img src="/api/files/{id}">`) — the worker's Chromium has no network. */
export const fileImageIds = (html: string): string[] => [...new Set([...html.matchAll(FILE_SRC)].map((m) => m[2]!.toLowerCase()))];

/** Replace `/api/files/{id}` image sources by `data:` URIs (`null` / missing → the image is dropped). */
export function inlineFileImages(html: string, data: ReadonlyMap<string, string | null>): string {
  return html.replace(FILE_SRC, (_m, a: string, id: string, z: string) => `${a}${data.get(id.toLowerCase()) ?? ''}${z}`);
}

export const dataUri = (mime: string, bytes: Uint8Array) => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;

/**
 * Browser side. Self-contained (no closures, no imports): `serverPdfScript()` serialises it for the static HTML
 * print pages. Opens a tab at once (pop-up blockers allow it only inside the click), renders and polls.
 */
export async function serverPdf(o: { selector: string; title: string; landscape?: boolean }): Promise<void> {
  const el = document.querySelector(o.selector) as HTMLElement | null;
  if (!el) { window.alert('Нема што да се зачува како PDF.'); return; }
  const w = window.open('', '_blank');
  if (w) w.document.write('<p style="font:15px sans-serif;padding:20px">PDF се подготвува…</p>');
  const fail = (m: string) => { if (w) w.close(); window.alert(m); };
  try {
    const c = el.cloneNode(true) as HTMLElement;
    c.querySelectorAll('.noprint,script').forEach((x) => x.remove());
    const html = c.id === 'printArea' ? c.outerHTML : `<div id="printArea" style="display:block">${c.outerHTML}</div>`;
    let css = '';
    for (const s of Array.from(document.styleSheets)) {
      try { for (const r of Array.from(s.cssRules)) css += r.cssText + '\n'; } catch { /* cross-origin sheet (web fonts) */ }
    }
    const landscape = o.landscape ?? !!el.querySelector('.pdfdoc.land');
    const r = await fetch('/api/pdf', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ html, css, title: o.title, landscape, pkg: new URLSearchParams(window.location.search).get('pkg') }) });
    const j = await r.json().catch(() => ({})) as { id?: string; error?: string };
    if (!r.ok || !j.id) { fail(j.error || 'PDF не може да се подготви.'); return; }
    const url = '/api/files/' + j.id;
    for (let i = 0; i < 60; i++) {
      await new Promise((ok) => setTimeout(ok, i < 5 ? 1000 : 2000));
      const x = await fetch(url, { redirect: 'manual', cache: 'no-store' });
      if (x.type === 'opaqueredirect' || x.ok) { if (w) w.location.href = url; else window.location.href = url; return; }
      if (x.status !== 404) break;
    }
    fail('PDF не е подготвен (серверот за PDF не одговара). Обидете се повторно или користете „Печати“.');
  } catch (e) {
    fail('PDF не може да се подготви: ' + ((e as Error)?.message || e));
  }
}

/** `serverPdf` as an inline script for static print pages: defines `window.wisePdf(selector, title)`. */
export const serverPdfScript = (): string => `window.wisePdf=function(s,t){return (${serverPdf.toString()})({selector:s,title:t})};`;
