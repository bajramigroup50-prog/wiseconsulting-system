/**
 * Reading without AI (free): used when AI reading is switched off, the credit is exhausted / the key refused, or the
 * AI call failed. Covers what has a machine-readable form — bank statements (PDF with a text layer, XML, CSV/TXT,
 * MT940, KB), trial balances (text PDF, CSV), invoices (UBL XML is read before AI anyway; text PDF here) and
 * inspection records / decisions (text PDF, .docx, .txt), fiscal reports and fiscal receipts (text PDF / text export,
 * accepted only when their sums check — ./free-docs.ts). The
 * result has the same shape as the AI read, so the screens and drafts work unchanged; `model` is `noai`.
 * Scanned PDFs and photos have no text layer → null (the caller reports that AI is needed). Amounts that stay
 * ambiguous („10.000“, nothing reconciles) throw `AmbiguousAmountsError` — the read is flagged, not guessed.
 */
import { csvToGrid, parseOpeningSheet } from '@wise/core';
import { parseStatementFile, type Statement } from '@wise/core/bank-parsers';
import { fromCents } from '@wise/core/bank/cents';
import { statementFromPdfItems } from '@wise/core/noai/bank';
import { obFromPdf } from '@wise/core/noai/ob';
import { lineText, pdfLines, type PdfItem, type PdfLine } from '@wise/core/noai/pdf-lines';
import { classifyText, classifyUbl } from '@wise/core/noai/classify';
import { invoicesFromPdf } from '@wise/core/noai/purchase';
import { kontrolaFromPdf, kontrolaFromText } from '@wise/core/noai/kontrola';
import type { ScanResult } from '@wise/core/sales';
import { pdfTextItems } from './pdf-text';
import { docxText } from './docx-text';
import { freeDocRead } from './free-docs';

export const NOAI_MODEL = 'noai';
const isPdf = (f: { name: string; mime: string }) => f.mime === 'application/pdf' || /\.pdf$/i.test(f.name);

async function textItems(bytes: Uint8Array, maxPages?: number): Promise<PdfItem[]> {
  try { return await pdfTextItems(bytes, maxPages); } catch { return []; }
}
async function lines(bytes: Uint8Array, maxPages?: number): Promise<PdfLine[]> {
  return pdfLines(await textItems(bytes, maxPages));
}
/** A trial balance is read whole (a 39-page analytic one takes ~1–2 s); the page count is checked against „Стр. N од M“. */
const OB_MAX_PAGES = 300;

/** Free read of one file for a kind; null when this kind / file cannot be read without AI. */
export async function freeRead(kind: string, file: { name: string; mime: string }, bytes: Uint8Array, o: { ownEdb?: string | null } = {}): Promise<unknown | null> {
  if (kind === 'kontrola') return kontrolaFree(file, bytes);
  if (kind === 'classify') return classifyFree(file, bytes, o);
  // fiscal reports / fiscal receipts as text PDF or text export: only a read whose checks pass (./free-docs.ts)
  if (kind === 'fisk' || kind === 'blg') return (await freeDocRead(kind, file, bytes)).result;
  if (kind === 'bank') {
    // a table that is found but not readable throws `BankPdfError` with the row / column (shown on the read)
    if (isPdf(file)) return statementFromPdfItems(await textItems(bytes));
    const S = (parseStatementFile(bytes, file.name) ?? []).filter((st) => st.lines.length);
    if (!S.length) return null;
    const one = (st: Statement) => ({
      number: st.no, account: st.account, currency: st.currency || 'MKD',
      openingBalance: st.opening == null ? 0 : fromCents(st.opening), closingBalance: st.closing == null ? 0 : fromCents(st.closing),
      items: st.lines.map((l) => ({
        date: l.date, name: l.counterparty, purpose: l.purpose, desc: l.desc, ref: l.ref, code: l.osnov ?? '', amount: fromCents(l.amount),
        ...(l.iban ? { account: l.iban } : {}), ...(l.fee ? { fee: fromCents(l.fee) } : {}), ...(l.stmtNo ? { stmtNo: l.stmtNo } : {}),
      })),
    });
    if (S.length === 1) return one(S[0]!);
    // several statements in one file (XML / MT940): each keeps its own number and balances
    const R = S.map(one);
    return { number: '', account: R[0]!.account, currency: R[0]!.currency, statements: R, items: R.flatMap((r) => r.items) };
  }
  if (kind === 'ob') {
    if (isPdf(file)) return obFromPdf(await lines(bytes, OB_MAX_PAGES));
    if (/\.(csv|txt)$/i.test(file.name)) {
      const P = parseOpeningSheet(csvToGrid(new TextDecoder('utf-8').decode(bytes)), 'csv');
      return P ? { rows: P.rows, totals: P.totals, grand: [0, 0] } : null;
    }
    return null;
  }
  if ((kind === 'purchase' || kind === 'sale') && isPdf(file)) {
    // a PDF with several invoices: each one on its own (`invoices`), never merged into one document
    const I = invoicesFromPdf(await lines(bytes), { ownEdb: o.ownEdb, kind });
    if (!I.length) return null;
    return I.length === 1 ? (I[0] as ScanResult) : ({ invoices: I } as ScanResult);
  }
  return null;
}

/**
 * A free read that is exact and fully checked, so AI is not even tried (no tokens, no misread digits, no size limit):
 * a bank statement whose balances reconcile, a trial balance („Бруто биланс со аналитика“) whose every printed total
 * matches the rows read.
 */
export const FREE_FIRST_KINDS: ReadonlySet<string> = new Set(['bank', 'ob']);
export function freeAccepted(kind: string, r: unknown): boolean {
  if (!FREE_FIRST_KINDS.has(kind) || !r || typeof r !== 'object') return false;
  const R = r as { balanced?: boolean | null; warnings?: unknown[]; blocking?: unknown[] };
  return R.balanced === true && !R.warnings?.length && !R.blocking?.length;
}

/** Kinds that have a free reader (the others need AI). */
export const FREE_KINDS: ReadonlySet<string> = new Set(['bank', 'ob', 'purchase', 'sale', 'kontrola', 'classify', 'fisk', 'blg']);

/** Office inbox classification (kind `classify`) from the text: title words / UBL seller (`@wise/core/noai/classify`). */
async function classifyFree(file: { name: string; mime: string }, bytes: Uint8Array, o: { ownEdb?: string | null }): Promise<unknown | null> {
  const dec = () => new TextDecoder('utf-8').decode(bytes);
  if (/\.xml$/i.test(file.name) || /xml/.test(file.mime)) return classifyUbl(dec(), o) ?? classifyText(dec(), o);
  if (isPdf(file)) { const t = (await lines(bytes)).map(lineText).join('\n'); return t.trim() ? classifyText(t, o) : null; }
  if (isDocx(file)) { const t = docxText(bytes); return t ? classifyText(t, o) : null; }
  if (/\.(txt|csv)$/i.test(file.name) || file.mime === 'text/plain') return classifyText(dec(), o);
  return null;
}

/** Inspection record / decision (kind `kontrola`): text PDF, .docx or .txt; a scan / photo has no text → null. */
async function kontrolaFree(file: { name: string; mime: string }, bytes: Uint8Array): Promise<unknown | null> {
  if (isPdf(file)) return kontrolaFromPdf(await lines(bytes));
  if (isDocx(file)) { const t = docxText(bytes); return t ? kontrolaFromText(t.split('\n')) : null; }
  if (/\.txt$/i.test(file.name) || file.mime === 'text/plain') return kontrolaFromText(new TextDecoder('utf-8').decode(bytes).split(/\r?\n/));
  return null;
}

const isDocx = (f: { name: string; mime: string }) => /\.docx$/i.test(f.name) || f.mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
/** Files the model cannot take (Word / plain text of an act): read only by the free reader, even when AI is available. */
export const freeOnlyFile = (kind: string, f: { name: string; mime: string }): boolean => kind === 'kontrola' && (isDocx(f) || /\.txt$/i.test(f.name));
