/**
 * HTML helpers for the payroll/HR print views and e-mails. Print views are standalone HTML documents
 * (route handlers), printed with the browser's "Print → Save as PDF" (server-side PDF comes in Phase 9).
 * The `.pdfdoc` rules are the legacy print CSS (`legacy-injected.css` lines 5–29, 65).
 */
export { fmt, fq, dmy } from '../fmt';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape text for HTML (legacy `h`). */
export const h = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]!);

/** File-name-safe text (legacy `fn`). */
export const fname = (v: unknown): string =>
  String(v ?? '').trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').slice(0, 80) || 'dokument';

export const MK_MONTHS = ['јануари', 'февруари', 'март', 'април', 'мај', 'јуни', 'јули', 'август', 'септември', 'октомври', 'ноември', 'декември'];
export const monthName = (ym: string) => MK_MONTHS[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4);
export const mmYYYY = (ym: string) => ym.split('-').reverse().join('/');

export const PDF_CSS = `
.pdfdoc{width:190mm;background:#fff;color:#111;font-family:"IBM Plex Sans",Arial,sans-serif;font-size:10.5px;line-height:1.35}
.pdfdoc.land{width:277mm}
.pdfdoc h1{font-size:18px;margin:0 0 2px;font-family:Arial,"IBM Plex Sans",sans-serif;font-weight:400;color:#111}
.pdfdoc h2{font-size:12.5px;margin:12px 0 4px;color:#111}
.pdfdoc .ph{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;margin:4px 0 8px;font-family:Arial,sans-serif}
.pdfdoc .ph .pt{font-size:18px}.pdfdoc .ph .ps{font-size:11px;margin-top:1px}
.pdfdoc .ph .pm{text-align:right;font-size:9.5px;color:#333;white-space:nowrap}
.pdfdoc small,.pdfdoc .muted{color:#444}
.pdfdoc table{width:100%;border-collapse:collapse;font-size:10px;margin:4px 0;border:1.5px solid #111}
.pdfdoc th,.pdfdoc td{padding:2.5px 5px;vertical-align:top;color:#111;background:#fff}
.pdfdoc td{border:0;border-left:1px solid #111;border-bottom:.5px solid #d6d6d6}
.pdfdoc th{border:1px solid #111;background:#fff;letter-spacing:.03em;font-size:9.5px;font-weight:700;text-align:left;white-space:normal;vertical-align:middle}
.pdfdoc td.n,.pdfdoc th.n{text-align:right;font-family:"IBM Plex Mono",Consolas,monospace;white-space:nowrap}
.pdfdoc tr.tot td,.pdfdoc tfoot td{font-weight:700;background:#fff;border-top:1.5px solid #111;border-left:0}
.pdfdoc tfoot td.n,.pdfdoc tr.tot td.n{border-left:1px solid #111}
.pdfdoc .pb{page-break-before:always}
.pdfdoc .sig{display:flex;justify-content:space-between;margin-top:30px;gap:20px}
.pdfdoc .sig span{border-top:1px solid #111;padding-top:3px;min-width:50mm;text-align:center}
.pdfdoc .box{border:1px solid #111;padding:6px 8px;margin:6px 0}
.pdfdoc .grid2{display:grid;grid-template-columns:1fr 1fr;gap:6px}
`;

const SCREEN_CSS = `
body{margin:0;background:#e9ecea;font-family:"IBM Plex Sans",Arial,sans-serif}
.pbar{position:sticky;top:0;z-index:5;display:flex;gap:8px;align-items:center;padding:8px 14px;background:#0f5b4a;color:#fff}
.pbar button,.pbar a{font:inherit;border:1px solid #fff;background:transparent;color:#fff;border-radius:6px;padding:5px 12px;cursor:pointer;text-decoration:none}
.pbar .t{flex:1;font-weight:600}
.page{background:#fff;margin:14px auto;padding:10mm;box-shadow:0 2px 10px rgba(0,0,0,.15);width:fit-content}
@media print{body{background:#fff}.pbar{display:none}.page{margin:0;padding:0;box-shadow:none}@page{margin:10mm}}
`;

/** A complete printable HTML document with a "Print" toolbar (hidden when printing). */
export function printDoc(title: string, body: string, opts: { land?: boolean; extraCss?: string; autoPrint?: boolean } = {}): string {
  return `<!doctype html><html lang="mk"><head><meta charset="utf-8"><title>${h(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600;700&family=IBM+Plex+Mono&display=swap">
<style>${PDF_CSS}${SCREEN_CSS}${opts.land ? '@media print{@page{size:A4 landscape}}' : ''}${opts.extraCss ?? ''}</style></head>
<body><div class="pbar"><span class="t">${h(title)}</span><button onclick="window.print()">🖨 Печати / PDF</button><button onclick="window.close()">Затвори</button></div>
<div class="page"><div class="pdfdoc${opts.land ? ' land' : ''}">${body}</div></div>${opts.autoPrint ? '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),300))</script>' : ''}</body></html>`;
}

/** Response for a print view. */
export const htmlResponse = (html: string) => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });

/** Page header used on reports (legacy `ph(title, sub)`). */
export const ph = (firm: { name: string; edb: string }, title: string, sub: string, now = new Date()) =>
  `<div class="ph"><div><div class="pt">${h(title)}</div><div class="ps">${h(sub)}</div></div><div class="pm"><b>${h(firm.name)}</b><br>ЕДБ ${h(firm.edb)}<br>${now.toISOString().slice(0, 10).split('-').reverse().join('.')}</div></div>`;

/** Signature row (legacy `sig(...)`). */
export const sig = (...who: string[]) => `<div class="sig">${who.map((w) => `<span>${h(w)}</span>`).join('')}</div>`;
