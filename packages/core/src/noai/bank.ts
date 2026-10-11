/**
 * Bank statement from the text layer of a PDF, without AI. Works on the column layout of the page instead of a
 * per-bank template (Комерцијална, Стопанска, НЛБ, Халк, Шпаркасе, ПроКредит, УНИ, Силк Роуд, ТТК, ЦКБ …): the header
 * line with a date column and an amount column (Должи / Побарува, Одлив / Прилив, Износ) is found, every line below
 * is cut into those columns, lines without a date are the continuation of the previous item's description, and the
 * table goes through the same parser as an Excel / CSV statement (`parseBankTable`). The result has the shape of the
 * AI read (`BANK_PROMPT`), so the bank screen maps it with `statementFromRead` like any read.
 */
import { findHeaderRow, parseBankDate, parseBankTable, stripYearPrefix } from '../bank-parsers';
import { fromCents } from '../bank/cents';
import type { ReadStatement } from '../ai/bank';
import { lineText, mkNum, pdfTable, type PdfLine } from './pdf-lines';

const AMT = /износ|amount|прилив|одлив|должи|побар|debit|credit|на товар|во корист|уплат|исплат/;
export const isBankHeader = (cells: string[]): boolean => {
  const h = cells.map((c) => c.toLowerCase());
  return h.some((c) => /дат|date/.test(c)) && h.some((c) => AMT.test(c));
};
const STOP = /^(вкупно|вкупен промет|збир|ново салдо|нова состојба|крајна состојба|салдо на крај|total)/i;

/** Number after a label anywhere in the text (`претходна состојба … 12.345,00`). */
function amountAfter(text: readonly string[], re: RegExp): number | null {
  for (const t of text) {
    const m = re.exec(t);
    if (!m) continue;
    const rest = t.slice(m.index + m[0].length);
    const n = /-?\d[\d.,]*\d|-?\d/.exec(rest);
    if (n) { const v = mkNum(n[0]); if (v != null) return v; }
  }
  return null;
}

export interface PdfStatement extends ReadStatement {
  /** Opening + movements = closing (null when the balances are not printed). */
  balanced: boolean | null;
}

/** Statement read from the PDF lines, or null when no transaction table is recognised. */
export function statementFromPdf(L: readonly PdfLine[]): PdfStatement | null {
  const T = pdfTable(L, isBankHeader, (t) => STOP.test(t.trim()));
  if (!T) return null;
  const hd = T.header.map((x) => x.toLowerCase());
  let iD = hd.findIndex((x) => /книжењ|booking/.test(x));
  if (iD < 0) iD = hd.findIndex((x) => /^датум|дат|date|data/.test(x));
  if (iD < 0) return null;
  const rows: string[][] = [];
  for (const r of T.rows) {
    if (parseBankDate(r[iD]) || !rows.length) { rows.push([...r]); continue; }
    const prev = rows[rows.length - 1]!;
    // continuation line: more description / counterparty text of the previous item (never amounts)
    r.forEach((c, i) => { if (c && i !== iD && mkNum(c) == null) prev[i] = prev[i] ? prev[i] + ' ' + c : c; });
  }
  const text = L.map(lineText);
  const pre = L.slice(0, T.at).map((l) => [lineText(l)]);
  const grid: unknown[][] = [...pre, T.header, ...rows];
  if (findHeaderRow(grid) !== pre.length) grid.splice(0, pre.length); // a preamble line looked like a header
  const st = parseBankTable(grid);
  if (!st) return null;
  const all = text.join('\n');
  const acc = /(?<!\d)(\d{3})[-\s]?(\d{10})[-\s]?(\d{2})(?!\d)/.exec(all);
  const noM = /извод\s*(?:бр(?:ој)?\.?|број|no\.?)?\s*[:.]?\s*(\d[\d/]*)/i.exec(all);
  const opening = amountAfter(text, /(претходна|почетна)\s+состојба|претходно\s+салдо|почетно\s+салдо|opening balance/i);
  const closing = amountAfter(text, /(нова|крајна)\s+состојба|ново\s+салдо|крајно\s+салдо|салдо на крај|closing balance/i);
  const sum = st.lines.reduce((s, l) => s + l.amount, 0);
  const balanced = opening != null && closing != null ? Math.round(opening * 100) + sum === Math.round(closing * 100) : null;
  return {
    number: noM ? stripYearPrefix(noM[1]!.split('/')[0]!) : st.no,
    account: acc ? acc[1]! + acc[2]! + acc[3]! : '',
    openingBalance: opening ?? 0, closingBalance: closing ?? 0,
    currency: /\b(EUR|USD|CHF|GBP)\b/.exec(all)?.[1] ?? 'MKD',
    items: st.lines.map((l) => ({ date: l.date, name: l.counterparty, purpose: l.purpose, desc: l.desc, ref: l.ref, code: l.osnov ?? '', amount: fromCents(l.amount) })),
    balanced,
  };
}
