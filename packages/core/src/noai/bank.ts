/**
 * Bank statement from the text layer of a PDF, without AI. Works on the column layout of the page instead of a
 * per-bank template (Комерцијална, Стопанска, НЛБ, Халк, Шпаркасе, ПроКредит, УНИ, Силк Роуд, ТТК, ЦКБ …): the header
 * of the transaction table (1–3 lines) is found by its words, every line of every page is cut into its columns
 * (`bankPdfGrid`), and the grid goes through the same parser as an Excel / CSV statement (`readBankTable`: multi-line
 * transactions, statement data from the header block, number format decided by the values or by opening + movements
 * = closing). The result has the shape of the AI read (`BANK_PROMPT`), so the bank screen maps it with
 * `statementFromRead` like any read.
 */
import { readBankTable } from '../bank-parsers';
import { fromCents } from '../bank/cents';
import type { ReadStatement } from '../ai/bank';
import type { PdfItem, PdfLine } from './pdf-lines';
import { bankPdfGrid } from './bank-grid';

export const isBankHeader = (cells: string[]): boolean => {
  const h = cells.map((c) => c.toLowerCase());
  return h.some((c) => /дат|date/.test(c)) && h.some((c) => /износ|amount|прилив|одлив|должи|побар|debit|credit|на товар|во корист|уплат|исплат/.test(c));
};

export interface PdfStatement extends ReadStatement {
  /** Opening + movements = closing (null when the balances are not printed). */
  balanced: boolean | null;
  /** Rows left out, totals that do not agree (shown in the import preview). */
  warnings?: string[];
}

/** Why a PDF statement was not read (Macedonian), for the read's error message. */
export class BankPdfError extends Error {
  constructor(msg: string) { super(msg); this.name = 'BankPdfError'; }
}

/**
 * Statement read from the PDF text items, or null when the PDF has no text / no transaction table. A table that is
 * found but cannot be read throws `BankPdfError` with the reason (row / column); ambiguous amounts throw
 * `AmbiguousAmountsError`.
 */
export function statementFromPdfItems(items: readonly PdfItem[]): PdfStatement | null {
  const G = bankPdfGrid(items);
  if (!G) return null;
  const R = readBankTable(G.grid, undefined, { hi: G.hi });
  if (!R.st) throw new BankPdfError('Изводот (PDF) не е прочитан: ' + (R.error ?? 'нема ставки.'));
  const st = R.st;
  const sum = st.lines.reduce((a, l) => a + l.amount, 0);
  return {
    number: st.no, account: st.account,
    openingBalance: st.opening == null ? 0 : fromCents(st.opening), closingBalance: st.closing == null ? 0 : fromCents(st.closing),
    ...(st.debit != null ? { totalDebit: fromCents(st.debit) } : {}), ...(st.credit != null ? { totalCredit: fromCents(st.credit) } : {}),
    currency: st.currency || 'MKD',
    items: st.lines.map((l) => ({ date: l.date, name: l.counterparty, purpose: l.purpose, desc: l.desc, ref: l.ref, code: l.osnov ?? '', amount: fromCents(l.amount) })),
    balanced: st.opening != null && st.closing != null ? st.opening + sum === st.closing : null,
    ...(R.warnings.length ? { warnings: R.warnings } : {}),
  };
}

/** {@link statementFromPdfItems} for lines from `pdfLines` (each cell is one item); null also when nothing is read. */
export function statementFromPdf(L: readonly PdfLine[]): PdfStatement | null {
  const items: PdfItem[] = L.flatMap((l) => l.cells.map((c) => ({ page: l.page, x: c.x0, y: l.y, w: Math.max(1, c.x1 - c.x0), h: 9, s: c.s })));
  try { return statementFromPdfItems(items); } catch (e) { if (e instanceof BankPdfError) return null; throw e; }
}
