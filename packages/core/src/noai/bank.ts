/**
 * Bank statement from the text layer of a PDF, without AI. Works on the column layout of the page instead of a
 * per-bank template (Комерцијална, Стопанска, НЛБ, Халк, Шпаркасе, ПроКредит, УНИ, Силк Роуд, ТТК, ЦКБ …): the header
 * of the transaction table (1–3 lines) is found by its words, every line of every page is cut into its columns
 * (`bankPdfGrid`), and the grid goes through the same parser as an Excel / CSV statement (`readBankTable`: multi-line
 * transactions, statement data from the header block, number format decided by the values or by opening + movements
 * = closing). The result has the shape of the AI read (`BANK_PROMPT`), so the bank screen maps it with
 * `statementsFromRead` like any read. A PDF with several statements (the daily statements of an e-banking export, one
 * per page) is cut into its statements first (`splitPdfStatements`), each read and checked on its own.
 */
import { readBankTable } from '../bank-parsers';
import { fromCents } from '../bank/cents';
import type { ReadStatement } from '../ai/bank';
import type { PdfItem, PdfLine } from './pdf-lines';
import { bankPdfGrid } from './bank-grid';
import { nlbDpsGrid } from './bank-nlb';
import { decodeGlyphItems } from './pdf-glyphs';
import { pdfRows } from './pdf-rows';

export const isBankHeader = (cells: string[]): boolean => {
  const h = cells.map((c) => c.toLowerCase());
  return h.some((c) => /дат|date/.test(c)) && h.some((c) => /износ|amount|прилив|одлив|должи|побар|debit|credit|на товар|во корист|уплат|исплат/.test(c));
};

export interface PdfStatement extends ReadStatement {
  /** Opening + movements = closing (null when the balances are not printed). */
  balanced: boolean | null;
  /** Rows left out, totals that do not agree (shown in the import preview). */
  warnings?: string[];
  /** The statement does not agree with itself (`statementProblems`): the import refuses it. */
  blocking?: string[];
  /** Several statements in one PDF (daily statements): each one read on its own. */
  statements?: PdfStatement[];
}

/** Why a PDF statement was not read (Macedonian), for the read's error message. */
export class BankPdfError extends Error {
  constructor(msg: string) { super(msg); this.name = 'BankPdfError'; }
}

/** One statement (one segment of the PDF) through the grid → table parser. */
function readOne(items: readonly PdfItem[]): PdfStatement | null {
  // НЛБ „DpsStatement“: its own column cutting (`bank-nlb.ts`); every other layout through the generic grid
  const N = nlbDpsGrid(items);
  const G = N ?? bankPdfGrid(items);
  if (!G) return null;
  const R = readBankTable(G.grid, undefined, { hi: G.hi });
  if (!R.st) throw new BankPdfError('Изводот (PDF) не е прочитан: ' + (R.error ?? 'нема ставки.'));
  const st = R.st;
  // „Вкупно за сметката … има N налози“: every order must be read
  if (N?.count != null && N.count !== st.lines.length) R.blocking.push(`Прочитани се ${st.lines.length} ставки, а во изводот пишува ${N.count} налози.`);
  const sum = st.lines.reduce((a, l) => a + l.amount, 0);
  return {
    number: st.no, account: st.account,
    openingBalance: st.opening == null ? 0 : fromCents(st.opening), closingBalance: st.closing == null ? 0 : fromCents(st.closing),
    ...(st.debit != null ? { totalDebit: fromCents(st.debit) } : {}), ...(st.credit != null ? { totalCredit: fromCents(st.credit) } : {}),
    currency: st.currency || 'MKD',
    items: st.lines.map((l) => ({
      date: l.date, name: l.counterparty, purpose: l.purpose, desc: l.desc, ref: l.ref, code: l.osnov ?? '', amount: fromCents(l.amount),
      ...(l.iban ? { account: l.iban } : {}), ...(l.fee ? { fee: fromCents(l.fee) } : {}),
    })),
    balanced: st.opening != null && st.closing != null ? st.opening + sum === st.closing : null,
    ...(R.warnings.length ? { warnings: R.warnings } : {}),
    ...(R.blocking.length ? { blocking: R.blocking } : {}),
  };
}

/* ------------------------------------------------------------------ several statements in one PDF */

/**
 * Statement printed in a title / footer row: `n161` for „… број на извод 161“, „Извод број:161“, „Извод бр. 12 од
 * 05.03.2026“, „Statement no. 7“; `d07.10.2026` for a title with only the day („Извод … за ден 07.10.2026“); null when
 * the row names no statement.
 */
export function statementTitleKey(text: string): string | null {
  const t = text.replace(/\s+/g, ' ');
  const no = /број\s+на\s+извод(?:от)?\s*[:.]?\s*(\d{1,8})/i.exec(t) || /извод\s*(?:бр(?:ој)?\.?|no\.?|nr\.?)\s*[:.]?\s*(\d{1,8})/i.exec(t)
    || /statement\s*(?:no\.?|nr\.?|number)\s*[:.]?\s*(\d{1,8})/i.exec(t);
  if (no) return 'n' + String(+no[1]!);
  const day = /извод\b.*?(?:за|на)\s+ден\s+(\d{1,2}[./]\d{1,2}[./]\d{4})/i.exec(t);
  return day ? 'd' + day[1]!.replace(/\//g, '.') : null;
}

/** An amount with decimals (not a date like „15.10.2026“). */
const MONEY_TXT = /(?<![\d.,])\d{1,3}(?:[.,']\d{3})*[.,]\d{2}(?![\d.,])|(?<![\d.,])\d+[.,]\d{2}(?![\d.,])/;

/**
 * The PDF's text items cut into statements: e-banking exports print one daily statement per page (or several one
 * after the other), each with its own title („Извод … број на извод 161“) and footer („Извод број:161“). A row naming
 * another statement than the current one starts a new statement — at the top of its page (its letterhead) when
 * nothing with an amount of the current statement is printed above it on that page. A statement over several pages
 * (the same number repeated, or no title on the next page) stays one. Keyed on the header words, not on the bank.
 */
export function splitPdfStatements(items: readonly PdfItem[]): PdfItem[][] {
  const rows = pdfRows(items);
  const seg: number[] = rows.map(() => 0);
  let cur: string | null = null, k = 0, pageStart = 0, moneyOnPage = false;
  rows.forEach((r, i) => {
    if (i === 0 || r.page !== rows[i - 1]!.page) { pageStart = i; moneyOnPage = false; }
    const text = r.items.map((x) => x.s).join(' ');
    const key = statementTitleKey(text);
    if (key) {
      if (cur == null) cur = key;
      else if (key !== cur) {
        k++;
        cur = key;
        const from = moneyOnPage ? i : pageStart;
        for (let j = from; j < i; j++) seg[j] = k;
      }
    }
    seg[i] = k;
    if (MONEY_TXT.test(text)) moneyOnPage = true;
  });
  const out: PdfItem[][] = Array.from({ length: k + 1 }, () => []);
  rows.forEach((r, i) => out[seg[i]!]!.push(...r.items));
  return out.filter((x) => x.length);
}

/** Every statement of the PDF (one per segment, see {@link splitPdfStatements}); segments without a table are left out. */
export function statementsFromPdfItems(items0: readonly PdfItem[]): PdfStatement[] {
  // fonts without a ToUnicode map (НЛБ): glyph ids → text, before any word is looked for
  const items = decodeGlyphItems(items0);
  const S = splitPdfStatements(items);
  if (S.length <= 1) { const one = readOne(items); return one ? [one] : []; }
  const out: PdfStatement[] = [];
  let err: unknown = null;
  for (const part of S) {
    try {
      const st = readOne(part);
      if (st) out.push(st);
    } catch (e) {
      if (!(e instanceof BankPdfError)) throw e;
      // one unreadable statement: kept as a blocking problem of the read (the import refuses it, AI reads it instead)
      err ??= e;
      const key = statementTitleKey(part.map((x) => x.s).join(' '));
      out.push({ number: key?.startsWith('n') ? key.slice(1) : '', items: [], balanced: false, blocking: [e.message] });
    }
  }
  if (!out.some((s) => s.items?.length)) { if (err) throw err; return []; }
  return out;
}

/**
 * Statement read from the PDF text items, or null when the PDF has no text / no transaction table. A table that is
 * found but cannot be read throws `BankPdfError` with the reason (row / column); ambiguous amounts throw
 * `AmbiguousAmountsError`. A PDF with several statements gives `statements` — each with its own number, date, balances
 * and lines — and, for the checks of the read, all lines in `items` (each with its statement number `stmtNo`),
 * `balanced` = every statement reconciles, the warnings / blocking problems of all of them, and no number of its own
 * (never a range like „161-163“).
 */
export function statementFromPdfItems(items: readonly PdfItem[]): PdfStatement | null {
  const S = statementsFromPdfItems(items);
  if (!S.length) return null;
  if (S.length === 1) return S[0]!;
  const tag = (st: PdfStatement, m: string) => (st.number ? `Извод бр. ${st.number}: ${m}` : m);
  const warnings = S.flatMap((st) => (st.warnings ?? []).map((m) => tag(st, m)));
  const blocking = S.flatMap((st) => (st.blocking ?? []).map((m) => tag(st, m)));
  const bal = S.map((s) => s.balanced);
  return {
    number: '', account: S.find((s) => s.account)?.account ?? '', currency: S[0]!.currency || 'MKD',
    openingBalance: S[0]!.openingBalance ?? 0, closingBalance: S[S.length - 1]!.closingBalance ?? 0,
    items: S.flatMap((st) => (st.items ?? []).map((it) => ({ ...it, ...(st.number ? { stmtNo: String(st.number) } : {}) }))),
    statements: S,
    balanced: bal.every((b) => b === true) ? true : bal.some((b) => b === false) ? false : null,
    ...(warnings.length ? { warnings } : {}),
    ...(blocking.length ? { blocking } : {}),
  };
}

/** {@link statementFromPdfItems} for lines from `pdfLines` (each cell is one item); null also when nothing is read. */
export function statementFromPdf(L: readonly PdfLine[]): PdfStatement | null {
  const items: PdfItem[] = L.flatMap((l) => l.cells.map((c) => ({ page: l.page, x: c.x0, y: l.y, w: Math.max(1, c.x1 - c.x0), h: 9, s: c.s })));
  try { return statementFromPdfItems(items); } catch (e) { if (e instanceof BankPdfError) return null; throw e; }
}
