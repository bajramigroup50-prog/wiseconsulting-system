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
import { AmbiguousAmountsError, ambExamples, colFormat, reconcileFmt, type NumFmt } from '../numfmt';
import { lineText, mkNum, pdfTable, type PdfLine } from './pdf-lines';

const AMT = /износ|amount|прилив|одлив|должи|побар|debit|credit|на товар|во корист|уплат|исплат/;
export const isBankHeader = (cells: string[]): boolean => {
  const h = cells.map((c) => c.toLowerCase());
  return h.some((c) => /дат|date/.test(c)) && h.some((c) => AMT.test(c));
};
const STOP = /^(вкупно|вкупен промет|збир|ново салдо|нова состојба|крајна состојба|салдо на крај|total)/i;

/** The number written after a label anywhere in the text (`претходна состојба … 12.345,00`), as written. */
function rawAfter(text: readonly string[], re: RegExp): string | null {
  for (const t of text) {
    const m = re.exec(t);
    if (!m) continue;
    const n = /-?\d[\d.,]*\d|-?\d/.exec(t.slice(m.index + m[0].length));
    if (n) return n[0];
  }
  return null;
}
const OPEN_RE = /(претходна|почетна)\s+состојба|претходно\s+салдо|почетно\s+салдо|opening balance/i;
const CLOSE_RE = /(нова|крајна)\s+состојба|ново\s+салдо|крајно\s+салдо|салдо на крај|closing balance/i;

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
  const oRaw = rawAfter(text, OPEN_RE), cRaw = rawAfter(text, CLOSE_RE);
  // number format (`numfmt.ts`): both readings; when they differ, the values' own evidence decides, else the reading
  // for which opening + movements = closing; otherwise flagged (AmbiguousAmountsError), never guessed
  const read = (x: NumFmt) => {
    const st = parseBankTable(grid, x);
    if (!st) return null;
    const o = oRaw == null ? null : mkNum(oRaw, x), c = cRaw == null ? null : mkNum(cRaw, x);
    const sum = st.lines.reduce((a, l) => a + l.amount, 0);
    return { st, o, c, bal: o != null && c != null ? Math.round(o * 100) + sum === Math.round(c * 100) : null };
  };
  const A = read('mk'), B = read('dot');
  if (!A || !B) return null;
  let R = A;
  if (JSON.stringify([A.st.lines, A.o, A.c]) !== JSON.stringify([B.st.lines, B.o, B.c])) {
    const vals = [...rows.flatMap((r) => r.filter((_, i) => i !== iD)), oRaw, cRaw];
    const f = colFormat(vals);
    const pick = f === 'mk' || f === 'dot' ? f : reconcileFmt((x) => (x === 'mk' ? A : B).bal === true);
    if (!pick) throw new AmbiguousAmountsError('Износите во изводот', ambExamples(vals));
    R = pick === 'mk' ? A : B;
  }
  const { st, o: opening, c: closing, bal: balanced } = R;
  const all = text.join('\n');
  const acc = /(?<!\d)(\d{3})[-\s]?(\d{10})[-\s]?(\d{2})(?!\d)/.exec(all);
  const noM = /извод\s*(?:бр(?:ој)?\.?|број|no\.?)?\s*[:.]?\s*(\d[\d/]*)/i.exec(all);
  return {
    number: noM ? stripYearPrefix(noM[1]!.split('/')[0]!) : st.no,
    account: acc ? acc[1]! + acc[2]! + acc[3]! : '',
    openingBalance: opening ?? 0, closingBalance: closing ?? 0,
    currency: /\b(EUR|USD|CHF|GBP)\b/.exec(all)?.[1] ?? 'MKD',
    items: st.lines.map((l) => ({ date: l.date, name: l.counterparty, purpose: l.purpose, desc: l.desc, ref: l.ref, code: l.osnov ?? '', amount: fromCents(l.amount) })),
    balanced,
  };
}
