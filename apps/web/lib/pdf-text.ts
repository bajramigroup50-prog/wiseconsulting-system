import 'server-only';
/** Text layer of a PDF (positioned items) with pdfjs — the converter's PDF source. Scanned PDFs give no items. */
import type { PdfItem } from '@wise/core/noai/pdf-lines';

export async function pdfTextItems(bytes: Uint8Array, maxPages = 40): Promise<PdfItem[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // the worker code runs in this thread; importing it here also puts it in the standalone build (file tracing)
  const G = globalThis as { pdfjsWorker?: unknown };
  // @ts-expect-error the worker module has no type declarations
  G.pdfjsWorker ??= await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  const out: PdfItem[] = [];
  try {
    for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
      const tc = await (await doc.getPage(p)).getTextContent();
      for (const it of tc.items) {
        if (!('str' in it) || !it.str) continue;
        const t = it.transform as number[];
        out.push({ page: p, x: t[4]!, y: t[5]!, w: it.width, h: it.height || Math.abs(t[3]!) || 8, s: it.str });
      }
    }
  } finally { await doc.destroy(); }
  return out;
}
