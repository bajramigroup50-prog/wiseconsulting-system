/**
 * Reading without AI (free): used when AI reading is switched off, the credit is exhausted / the key refused, or the
 * AI call failed. Covers what has a machine-readable form — bank statements (PDF with a text layer, XML, CSV/TXT,
 * MT940, KB), trial balances (text PDF, CSV) and invoices (UBL XML is read before AI anyway; text PDF here). The
 * result has the same shape as the AI read, so the screens and drafts work unchanged; `model` is `noai`.
 * Scanned PDFs and photos have no text layer → null (the caller reports that AI is needed). Amounts that stay
 * ambiguous („10.000“, nothing reconciles) throw `AmbiguousAmountsError` — the read is flagged, not guessed.
 */
import { csvToGrid, parseOpeningSheet } from '@wise/core';
import { parseStatementFile } from '@wise/core/bank-parsers';
import { fromCents } from '@wise/core/bank/cents';
import { statementFromPdfItems } from '@wise/core/noai/bank';
import { obFromPdf } from '@wise/core/noai/ob';
import { pdfLines, type PdfItem, type PdfLine } from '@wise/core/noai/pdf-lines';
import { invoiceFromPdf } from '@wise/core/noai/purchase';
import type { ScanResult } from '@wise/core/sales';
import { pdfTextItems } from './pdf-text';

export const NOAI_MODEL = 'noai';
const isPdf = (f: { name: string; mime: string }) => f.mime === 'application/pdf' || /\.pdf$/i.test(f.name);

async function textItems(bytes: Uint8Array): Promise<PdfItem[]> {
  try { return await pdfTextItems(bytes); } catch { return []; }
}
async function lines(bytes: Uint8Array): Promise<PdfLine[]> {
  return pdfLines(await textItems(bytes));
}

/** Free read of one file for a kind; null when this kind / file cannot be read without AI. */
export async function freeRead(kind: string, file: { name: string; mime: string }, bytes: Uint8Array, o: { ownEdb?: string | null } = {}): Promise<unknown | null> {
  if (kind === 'bank') {
    // a table that is found but not readable throws `BankPdfError` with the row / column (shown on the read)
    if (isPdf(file)) return statementFromPdfItems(await textItems(bytes));
    const S = parseStatementFile(bytes, file.name);
    const st = S?.[0];
    if (!st || !st.lines.length) return null;
    return {
      number: st.no, account: st.account, currency: st.currency || 'MKD',
      openingBalance: st.opening == null ? 0 : fromCents(st.opening), closingBalance: st.closing == null ? 0 : fromCents(st.closing),
      items: st.lines.map((l) => ({ date: l.date, name: l.counterparty, purpose: l.purpose, desc: l.desc, ref: l.ref, code: l.osnov ?? '', amount: fromCents(l.amount) })),
    };
  }
  if (kind === 'ob') {
    if (isPdf(file)) return obFromPdf(await lines(bytes));
    if (/\.(csv|txt)$/i.test(file.name)) {
      const P = parseOpeningSheet(csvToGrid(new TextDecoder('utf-8').decode(bytes)), 'csv');
      return P ? { rows: P.rows, totals: P.totals, grand: [0, 0] } : null;
    }
    return null;
  }
  if ((kind === 'purchase' || kind === 'sale') && isPdf(file)) {
    const inv = invoiceFromPdf(await lines(bytes), { ownEdb: o.ownEdb, kind });
    return inv ? (inv as ScanResult) : null;
  }
  return null;
}

/** Kinds that have a free reader (the others need AI). */
export const FREE_KINDS: ReadonlySet<string> = new Set(['bank', 'ob', 'purchase', 'sale']);
