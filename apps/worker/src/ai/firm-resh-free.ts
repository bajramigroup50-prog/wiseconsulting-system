/**
 * „📷 Нова фирма од решение“ without AI: the text of electronic ЦРСМ / УЈП documents (PDF text layer, .txt) read by
 * `reshFromText`. Each file is read on its own (Тековна состојба + ДДВ решение uploaded together are merged); when
 * that misses a required field and there are several files, the pages are also read as one document (one decision
 * uploaded page by page). Images and scanned PDFs give no text → null (AI is needed).
 */
import { mergeResh, reshFromText, reshMissing, type ReshFree } from '@wise/core/noai/firm-resh';
import { lineText, pdfLines } from '@wise/core/noai/pdf-lines';
import { pdfTextItems } from './pdf-text';

const isPdf = (f: { name: string; mime: string }) => f.mime === 'application/pdf' || /\.pdf$/i.test(f.name);
const isTxt = (f: { name: string; mime: string }) => f.mime === 'text/plain' || /\.txt$/i.test(f.name);

/** Text lines of one file; [] for an image or a PDF without a text layer. */
export async function reshFileLines(f: { name: string; mime: string }, bytes: Uint8Array): Promise<string[]> {
  if (isPdf(f)) {
    try { return pdfLines(await pdfTextItems(bytes)).map(lineText); } catch { return []; }
  }
  if (isTxt(f)) return new TextDecoder('utf-8').decode(bytes).split(/\r?\n/);
  return [];
}

/** Free read of the uploaded files; null when none has a readable registration text. */
export async function firmReshFree(F: readonly { file: { name: string; mime: string }; bytes: Uint8Array }[]): Promise<ReshFree | null> {
  const T = await Promise.all(F.map((x) => reshFileLines(x.file, x.bytes)));
  const each = T.map((L) => reshFromText(L)).filter((x): x is ReshFree => !!x);
  const merged = mergeResh(each);
  if (merged && !reshMissing(merged).length) return merged;
  const withText = T.filter((L) => L.some((l) => l.trim()));
  if (withText.length > 1) {
    const all = reshFromText(withText.flat());
    if (all && (!merged || reshMissing(all).length < reshMissing(merged).length)) return all;
  }
  return merged;
}
