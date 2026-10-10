/**
 * Browser helpers for server PDFs beyond the print views' own „⬇ PDF“ (`serverPdf` in `print-pdf.ts`):
 * - capture a screen as it is shown (`ScreenExport` in every page header: legacy `pdf(name, ph(title) + el.innerHTML)`,
 *   e.g. `anPdf`), cleaned of buttons, filters and hidden parts, with input values kept as text;
 * - capture a print view of another URL in a hidden frame (`zyGen`, „Заврши и архивирај“) and file the PDF
 *   (`save`, see `PdfSave`);
 * - the visible tables of a screen as an Excel workbook (legacy `anXlsx` / `XLSX.utils.table_to_book`).
 * Client-only (DOM); the request body is validated by `parsePrintPdfRequest` on the server.
 */
import type { PdfSave } from './print-pdf';

/** The page's CSS (legacy print CSS included) as the browser loaded it; cross-origin sheets (web fonts) are skipped. */
export function pageCss(doc: Document = document): string {
  let css = '';
  for (const s of Array.from(doc.styleSheets)) {
    try { for (const r of Array.from(s.cssRules)) css += r.cssText + '\n'; } catch { /* cross-origin */ }
  }
  return css;
}

const DROP = 'script,noscript,button,.noprint,a.btn,a.chip,.chip,[role="tablist"],.ftabs,.zs-sub,.dfilter,input[type="hidden"],input[type="file"],dialog,template';

/**
 * Clone `el` for a PDF: drop what is hidden on screen (closed `<details>` keep their summary), buttons, tabs,
 * filter chips and `.noprint`; inputs, selects and text areas become their current value; the page header `.hd`
 * at the top goes too (the server puts the firm head + title in front).
 */
export function cleanClone(el: HTMLElement, opts: { dropHeader?: boolean } = {}): HTMLElement {
  const c = el.cloneNode(true) as HTMLElement;
  const src = Array.from(el.querySelectorAll<HTMLElement>('*'));
  const dst = Array.from(c.querySelectorAll<HTMLElement>('*'));
  const drop: Element[] = [];
  const view = el.ownerDocument.defaultView;
  src.forEach((s, i) => {
    const d = dst[i];
    if (!d) return;
    const st = view?.getComputedStyle(s);
    if (st && st.display === 'none' && !(s.closest('details:not([open])'))) { drop.push(d); return; }
    if (s instanceof HTMLDetailsElement && !s.open) {
      for (const ch of Array.from(d.children)) if (ch.tagName !== 'SUMMARY') drop.push(ch);
      return;
    }
    let txt: string | null = null;
    if (s instanceof HTMLSelectElement) txt = s.selectedOptions[0]?.text ?? '';
    else if (s instanceof HTMLTextAreaElement) txt = s.value;
    else if (s instanceof HTMLInputElement && !['hidden', 'file', 'submit', 'button', 'reset', 'image'].includes(s.type)) {
      txt = s.type === 'checkbox' || s.type === 'radio' ? (s.checked ? '☑' : '☐') : s.value;
    }
    if (txt != null) {
      const span = el.ownerDocument.createElement('span');
      span.textContent = txt;
      if (s instanceof HTMLTextAreaElement) span.style.whiteSpace = 'pre-wrap';
      d.replaceWith(span);
    }
  });
  for (const d of drop) d.remove();
  c.querySelectorAll(DROP).forEach((x) => x.remove());
  if (opts.dropHeader !== false) c.querySelector(':scope > .hd')?.remove();
  c.querySelectorAll('form').forEach((f) => { const div = el.ownerDocument.createElement('div'); div.className = f.className; div.append(...Array.from(f.childNodes)); f.replaceWith(div); });
  c.querySelectorAll('[id]').forEach((x) => { if (x.id === 'printArea') x.removeAttribute('id'); });
  c.removeAttribute('id');
  return c;
}

/** Wide screens (many table columns) print landscape, like legacy `pdf(..., { land: true })`. */
export const wideContent = (el: HTMLElement): boolean =>
  Array.from(el.querySelectorAll('table')).some((t) => (t.querySelector('tr')?.children.length ?? 0) > 8) || el.scrollWidth > 1100;

export interface PdfBody {
  html: string; css: string; title: string; landscape?: boolean; pkg?: string | null;
  head?: { sub: string } | null; save?: PdfSave | null;
}

/** `POST /api/pdf` → the `files.id` (throws with the server's message). */
export async function requestPdf(b: PdfBody): Promise<string> {
  const r = await fetch('/api/pdf', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  const j = await r.json().catch(() => ({})) as { id?: string; error?: string };
  if (!r.ok || !j.id) throw new Error(j.error || 'PDF не може да се подготви.');
  return j.id;
}

/** Poll `/api/files/{id}` until the worker stored the PDF (about 2 minutes at most). */
export async function waitForFile(id: string, tries = 60): Promise<boolean> {
  const url = '/api/files/' + id;
  for (let i = 0; i < tries; i++) {
    await new Promise((ok) => setTimeout(ok, i < 5 ? 1000 : 2000));
    const x = await fetch(url, { redirect: 'manual', cache: 'no-store' });
    if (x.type === 'opaqueredirect' || x.ok) return true;
    if (x.status !== 404) return false;
  }
  return false;
}

/** Render and open the PDF in a new tab (opened inside the click so pop-up blockers allow it). */
export async function openPdf(b: PdfBody): Promise<void> {
  const w = window.open('', '_blank');
  if (w) w.document.write('<p style="font:15px sans-serif;padding:20px">PDF се подготвува…</p>');
  const fail = (m: string) => { if (w) w.close(); window.alert(m); };
  try {
    const id = await requestPdf(b);
    if (!(await waitForFile(id))) { fail('PDF не е подготвен (серверот за PDF не одговара). Обидете се повторно или користете „Печати“.'); return; }
    if (w) w.location.href = '/api/files/' + id; else window.location.href = '/api/files/' + id;
  } catch (e) {
    fail('PDF не може да се подготви: ' + ((e as Error)?.message || e));
  }
}

/** The screen (`selector`, default the page sheet `#main`) as a PDF with the firm head and `title` / `sub` in front. */
export async function screenPdf(o: { selector?: string; title: string; sub?: string; landscape?: boolean }): Promise<void> {
  const root = document.querySelector(o.selector ?? '#main') as HTMLElement | null;
  // a screen that marks its document (`.printarea`, the stock / retail documents of `PrintButton`) prints only that
  const el = (root?.querySelector('.printarea') as HTMLElement | null) ?? root;
  if (!el) { window.alert('Нема што да се зачува како PDF.'); return; }
  const c = cleanClone(el);
  const own = !!c.querySelector('.fh, .ph');
  const land = o.landscape ?? wideContent(el);
  // the legacy print CSS hides every body child except `#printArea` (Chromium renders with print media)
  const html = own ? `<div id="printArea" style="display:block"><div class="pdfdoc${land ? ' land' : ''}">${c.outerHTML}</div></div>` : c.outerHTML;
  await openPdf({ html, css: pageCss(), title: o.title, landscape: land, head: own ? null : { sub: o.sub ?? '' } });
}

/** Load a print view in a hidden frame and return its `#printArea` (or `selector`) as PDF input. */
export async function captureUrl(url: string, selector = '#printArea'): Promise<{ html: string; css: string; landscape: boolean }> {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:900px;border:0;visibility:hidden';
  f.setAttribute('aria-hidden', 'true');
  document.body.appendChild(f);
  try {
    await new Promise<void>((ok, no) => {
      const t = setTimeout(() => no(new Error('Прегледот за печатење не се вчита: ' + url)), 60_000);
      f.onload = () => { clearTimeout(t); ok(); };
      f.src = url;
    });
    const d = f.contentDocument;
    const el = d?.querySelector(selector) as HTMLElement | null;
    if (!d || !el || !el.textContent?.trim()) throw new Error('Документот е празен или не постои: ' + url);
    const c = el.cloneNode(true) as HTMLElement;
    c.querySelectorAll('.noprint,script').forEach((x) => x.remove());
    const html = c.id === 'printArea' ? c.outerHTML : `<div id="printArea" style="display:block">${c.outerHTML}</div>`;
    return { html, css: pageCss(d), landscape: !!el.querySelector('.pdfdoc.land') };
  } finally {
    f.remove();
  }
}

/** Every visible table of the screen as one Excel workbook (a sheet per table, named after the nearest heading). */
export async function screenXlsx(o: { selector?: string; name: string }): Promise<void> {
  const el = document.querySelector(o.selector ?? '#main') as HTMLElement | null;
  const c = el ? cleanClone(el) : null;
  const T = c ? Array.from(c.querySelectorAll('table')).filter((t) => !t.parentElement?.closest('table')) : [];
  if (!T.length) { window.alert('Нема табели за извоз на овој екран.'); return; }
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  T.forEach((t, i) => {
    let h = '';
    for (let n: Element | null = t; n && n !== c && !h; n = n.parentElement) {
      let p = n.previousElementSibling;
      while (p && !h) { const x = p.matches('h1,h2,h3,.hd') ? p : p.querySelector('h1,h2,h3'); if (x) h = x.textContent ?? ''; p = p.previousElementSibling; }
    }
    let name = (h.replace(/[\\/?*[\]:]/g, ' ').trim() || `Табела ${i + 1}`).slice(0, 28);
    while (used.has(name)) name = `${name.slice(0, 25)} ${i + 1}`;
    used.add(name);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.table_to_sheet(t, { raw: true }), name);
  });
  XLSX.writeFile(wb, `${o.name.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'izvoz'}.xlsx`);
}
