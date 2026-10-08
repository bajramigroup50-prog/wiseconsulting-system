/**
 * HTML document wrapper for server-side PDFs. Callers pass the same markup the browser print views use
 * (legacy `.pdfdoc` classes); this adds the charset, A4 page setup and a Cyrillic-capable font stack.
 */

export interface PdfInput {
  /** Body markup, or a full `<html>` document. */
  html: string;
  /** Extra CSS (e.g. the legacy print CSS). */
  css?: string;
  /** Page format and orientation. */
  format?: 'A4' | 'A5';
  landscape?: boolean;
  /** Document title (also used for the file name). */
  title?: string;
}

export const BASE_CSS = `
@page { size: A4; margin: 14mm 12mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: "DejaVu Sans", "Liberation Sans", Arial, sans-serif; font-size: 10pt; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #999; padding: 3px 5px; vertical-align: top; }
th { background: #f0f0f0; }
.n, .num { text-align: right; white-space: nowrap; }
h1 { font-size: 15pt; margin: 0 0 6px; } h2 { font-size: 12pt; margin: 10px 0 4px; }
`;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Full HTML document for Chromium. A complete document is passed through, with our CSS injected into `<head>`. */
export function wrapHtml(p: PdfInput): string {
  const style = `<style>${BASE_CSS}${p.landscape ? '@page{size:A4 landscape}' : ''}${p.css ?? ''}</style>`;
  if (/<html[\s>]/i.test(p.html)) {
    return /<head[^>]*>/i.test(p.html) ? p.html.replace(/<head[^>]*>/i, (m) => `${m}<meta charset="utf-8">${style}`) : p.html.replace(/<html[^>]*>/i, (m) => `${m}<head><meta charset="utf-8">${style}</head>`);
  }
  return `<!doctype html><html lang="mk"><head><meta charset="utf-8"><title>${esc(p.title ?? 'Документ')}</title>${style}</head><body>${p.html}</body></html>`;
}

/** Safe ASCII-ish file name for the PDF (Cyrillic kept, path characters removed). */
export const pdfName = (title?: string) => `${(title ?? 'dokument').replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim().slice(0, 120) || 'dokument'}.pdf`;
