/**
 * Text layer of a PDF (positioned items) with pdfjs, for the readers that work without AI. A scanned PDF (only
 * images) gives no items. At most 40 pages are read.
 */
import type { PdfItem } from '@wise/core/noai/pdf-lines';

export async function pdfTextItems(bytes: Uint8Array, maxPages = 40): Promise<PdfItem[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  const out: PdfItem[] = [];
  try {
    for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      for (const it of tc.items) {
        if (!('str' in it) || !it.str) continue;
        const t = it.transform as number[];
        out.push({ page: p, x: t[4]!, y: t[5]!, w: it.width, h: it.height || Math.abs(t[3]!) || 8, s: it.str });
      }
    }
  } finally { await doc.destroy(); }
  return out;
}
