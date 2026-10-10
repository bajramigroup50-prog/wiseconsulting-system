/**
 * Server PDF of a print view (Phase 9 `pdf.render`): the „PDF“ button next to the browser print button posts the
 * print area's HTML plus the page's CSS (the legacy print CSS as the browser loaded it — so nothing has to be read
 * from `legacy-injected.css` at runtime and it works in the `next build` output) to `POST /api/pdf`, which queues
 * `renderPdf` and returns the pre-allocated file id; the browser polls `/api/files/{id}` until it is stored.
 *
 * Pure helpers (no `server-only`) so they can be unit-tested; the route is `app/api/pdf/route.ts`, the browser
 * side is `serverPdf` below (React `PdfButton` and the static payroll print pages share it).
 */

/**
 * Where the stored PDF is also filed (the worker links it after rendering, `pdf.render` `link`):
 * - `dossier` — a new firm dossier document (legacy `recArchive`: ИОС / записник за усогласување → „Документи на фирмата“)
 * - `year`    — the year-end dossier of `year` under `role` (legacy `zyAdd` from `zyGen`; a generated role replaces the old file)
 */
export type PdfSave =
  | { to: 'dossier'; category: string; title: string; date: string | null; partner: string | null; note: string | null }
  | { to: 'year'; year: number; role: string };

export interface PrintPdfRequest {
  html: string; css: string; title: string; landscape: boolean;
  /** Add the PDF to this document package (legacy PKG_REP). */
  pkg: string | null;
  /** Prepend the firm head + title (legacy `ph(title, sub)`) — used for screens captured as they are (`ScreenExport`). */
  head: { sub: string } | null;
  save: PdfSave | null;
}

export const PDF_MAX_HTML = 6_000_000;
export const PDF_MAX_CSS = 1_500_000;

const line = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, n) : '');

/** `save` part of the body; `categories` / `roles` are the allowed dossier categories and year-dossier roles. */
export function parsePdfSave(v: unknown, categories: readonly string[], roles: readonly string[]): PdfSave | null | { error: string } {
  if (v == null) return null;
  const o = (typeof v === 'object' ? v : {}) as Record<string, unknown>;
  if (o.to === 'dossier') {
    const category = line(o.category, 120);
    if (!categories.includes(category)) return { error: 'Непозната категорија во досието.' };
    const date = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : null;
    return { to: 'dossier', category, title: line(o.title, 300) || category, date, partner: line(o.partner, 300) || null, note: line(o.note, 1000) || null };
  }
  if (o.to === 'year') {
    const year = Number(o.year), role = line(o.role, 20);
    if (!Number.isInteger(year) || year < 1990 || year > 2100 || !roles.includes(role)) return { error: 'Неважечка година или вид на документ.' };
    return { to: 'year', year, role };
  }
  return { error: 'Непознато место за зачувување.' };
}

/** Validate the JSON body of `POST /api/pdf`. */
export function parsePrintPdfRequest(b: unknown, allowed: { categories: readonly string[]; roles: readonly string[] } = { categories: [], roles: [] }): PrintPdfRequest | { error: string } {
  const o = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
  const html = typeof o.html === 'string' ? o.html : '';
  const css = typeof o.css === 'string' ? o.css : '';
  if (!html.trim()) return { error: 'Нема содржина за PDF.' };
  if (html.length > PDF_MAX_HTML || css.length > PDF_MAX_CSS) return { error: 'Документот е преголем за PDF – користете „Печати“.' };
  const title = line(o.title, 150) || 'Документ';
  const pkg = typeof o.pkg === 'string' && /^[0-9a-f-]{36}$/i.test(o.pkg) ? o.pkg : null;
  const head = o.head && typeof o.head === 'object' ? { sub: line((o.head as Record<string, unknown>).sub, 300) } : null;
  const save = parsePdfSave(o.save, allowed.categories, allowed.roles);
  if (save && 'error' in save) return save;
  return { html, css, title, landscape: o.landscape === true, pkg, head, save };
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Legacy `firmHead()` + `ph(title, sub)` (3254–3255) as HTML, the same markup as `app/print/firm-head.tsx`. */
export function firmHeadHtml(
  firm: { name: string | null; address?: string | null; city?: string | null; phone?: string | null; email?: string | null; edb?: string | null; embs?: string | null } | null,
  title: string, sub: string, printed: string,
): string {
  const fh = firm ? `<div class="fh"><div class="fn">${esc(String(firm.name ?? '').toUpperCase())}</div><div class="fa">${esc([firm.address, firm.city].filter(Boolean).join(' '))}${firm.phone ? ' * Тел.: ' + esc(firm.phone) : ''}${firm.email ? ' * ' + esc(firm.email) : ''}<br>ЕДБ: ${esc(firm.edb ?? '')}${firm.embs ? ' * ЕМБС: ' + esc(firm.embs) : ''}</div></div>` : '';
  const d = printed.slice(0, 10).split('-').reverse().join('.');
  return `${fh}<div class="ph"><div><div class="pt">${esc(title)}</div>${sub ? `<div class="ps">${esc(sub)}</div>` : ''}</div><div class="pm">Отпечатено: ${d}</div></div>`;
}

/** Wrap a captured screen (`#printArea` from `ScreenExport`) in `.pdfdoc` with the firm head in front. */
export function withFirmHead(html: string, headHtml: string, landscape: boolean): string {
  return `<div id="printArea" style="display:block"><div class="pdfdoc${landscape ? ' land' : ''}">${headHtml}${html}</div></div>`;
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
