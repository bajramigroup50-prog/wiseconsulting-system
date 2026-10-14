/**
 * Free (no-AI) readers of МПИН declarations (`mpin.read`), fiscal reports (kind `fisk`) and fiscal receipts (kind
 * `blg`), used FIRST — AI only when they cannot read the document or their checks fail:
 *
 *   mpin  „Декларација за прием“ PDF from e-Персонален данок (text layer) or a text export → the `MPIN_ASK` shape
 *   fisk  periodic / daily Z report exported as text / text PDF → the `FISK_PROMPT` shape (then `fiskAfterRead` /
 *         `fiskFinish` like an AI read)
 *   blg   e-receipt / text PDF of a Macedonian fiscal receipt → the `BLG_PROMPT` shape
 *
 * Photos and scanned PDFs (no text layer) always go to AI. `result` is set only when the reader's own checks pass
 * (@wise/core/noai/mpin, fiscal-report, receipt); otherwise `why` is the reason AI is needed. Never throws.
 */
import { fiskAfterRead, fiskFinish } from '@wise/core/ai/fisk';
import { pdfTextLines, textLines } from '@wise/core/noai/doc-text';
import { fiscalReportFromLines } from '@wise/core/noai/fiscal-report';
import { mpinFromPdf, mpinFromText } from '@wise/core/noai/mpin';
import { pdfLines } from '@wise/core/noai/pdf-lines';
import { receiptFromLines } from '@wise/core/noai/receipt';
import { todaySkopje } from '@wise/core/office/dates';
import { pdfTextItems } from './pdf-text';

export type FreeDocKind = 'mpin' | 'fisk' | 'blg';
export const FREE_DOC_KINDS: ReadonlySet<string> = new Set<FreeDocKind>(['mpin', 'fisk', 'blg']);

export const FREE_WHY = {
  image: 'слика – се чита со AI',
  scan: 'скенирано – PDF без текст',
  format: 'форматот не се чита без AI',
} as const;

type F = { name: string; mime: string };
const isPdf = (f: F) => f.mime === 'application/pdf' || /\.pdf$/i.test(f.name);
const isText = (f: F) => /^text\//.test(f.mime) || /\.(txt|csv|prn|log)$/i.test(f.name);
const isImage = (f: F) => /^image\//.test(f.mime) || /\.(jpe?g|png|webp|gif|heic|bmp|tiff?)$/i.test(f.name);

/** Decode a text export: UTF-8, or Windows-1251 when UTF-8 gives replacement characters. */
function decode(bytes: Uint8Array): string {
  const u = new TextDecoder('utf-8').decode(bytes);
  if (!u.includes('�')) return u;
  try { return new TextDecoder('windows-1251').decode(bytes); } catch { return u; }
}

/** Run the free reader of `kind` on one file. */
export async function freeDocRead(kind: FreeDocKind, file: F, bytes: Uint8Array, today = todaySkopje()): Promise<{ result: unknown | null; why: string }> {
  try {
    if (isImage(file)) return { result: null, why: FREE_WHY.image };
    let lines: string[];
    let mpin = null as ReturnType<typeof mpinFromPdf> | null;
    if (isPdf(file)) {
      let items: Awaited<ReturnType<typeof pdfTextItems>> = [];
      try { items = await pdfTextItems(bytes, 20); } catch { items = []; }
      if (!items.some((i) => i.s.trim())) return { result: null, why: FREE_WHY.scan };
      const L = pdfLines(items);
      if (kind === 'mpin') mpin = mpinFromPdf(L);
      lines = pdfTextLines(L);
    } else if (isText(file)) {
      lines = textLines(decode(bytes));
      if (kind === 'mpin') mpin = mpinFromText(lines);
    } else return { result: null, why: FREE_WHY.format };
    if (kind === 'mpin') return { result: mpin!.data, why: mpin!.why };
    if (kind === 'fisk') {
      const r = fiscalReportFromLines(lines);
      return r.data ? { result: fiskFinish(fiskAfterRead(r.data), today), why: '' } : { result: null, why: r.why };
    }
    const r = receiptFromLines(lines);
    return { result: r.data, why: r.why };
  } catch (e) {
    return { result: null, why: e instanceof Error ? e.message : String(e) };
  }
}
