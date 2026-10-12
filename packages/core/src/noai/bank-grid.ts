/**
 * Bank statement PDF (text layer) → grid for the statement table parser (`bank/table.ts` → `readBankTable`) and the
 * converter. The header of the transaction table is found by its words (1–3 lines: „ИЗНОС“ over „задолжува |
 * одобрува“, wrapped headings), its cells give the columns, and every line of every page is cut into those columns
 * item by item (values printed close together stay apart). Lines printed a little apart in the same row (amounts
 * 2–4 pt below the text) are joined; page headers repeated on the following pages and the letterhead above them are
 * left out. Lines above the table are cut into the same columns, so a label and the value printed under it stay in
 * one column (statement data: number, date, account, balances).
 */
import { balanceLabels, isBankHeaderRow, isHeaderContinuation } from '../bank/table';
import type { PdfItem } from './pdf-lines';
import { itemParts, mergeCloseRows, pdfRows, rowCells, type PdfCellPart, type PdfRow } from './pdf-rows';

export interface BankPdfGrid {
  grid: string[][];
  /** Row of the (combined) header in `grid`. */
  hi: number;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
const sigOf = (C: readonly PdfCellPart[]) => C.map((c) => norm(c.s)).join('|');
const ov = (a: { x0: number; x1: number }, b: { x0: number; x1: number }) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);

/** Columns from the header lines: the line with most cells is the base; the others join the columns they overlap. */
function columnsOf(H: readonly PdfCellPart[][]): PdfCellPart[] {
  const bi = H.reduce((b, l, i) => (l.length > H[b]!.length ? i : b), 0);
  const cols = H[bi]!.map((c) => ({ ...c, top: [] as string[], bottom: [] as string[] }));
  H.forEach((L, li) => {
    if (li === bi) return;
    for (const c of L) {
      const hit = cols.filter((k) => ov(k, c) > 0);
      if (!hit.length) { cols.push({ ...c, s: '', top: li < bi ? [c.s] : [], bottom: li > bi ? [c.s] : [] }); continue; }
      for (const k of hit) {
        (li < bi ? k.top : k.bottom).push(c.s);
        // a heading wider than its single column (wrapped text) widens it; a parent over several columns does not
        if (hit.length === 1) { k.x0 = Math.min(k.x0, c.x0); k.x1 = Math.max(k.x1, c.x1); }
      }
    }
  });
  return cols.sort((a, b) => a.x0 - b.x0).map((k) => ({ x0: k.x0, x1: k.x1, s: [...k.top, k.s, ...k.bottom].filter(Boolean).join(' ') }));
}

/**
 * Column of a piece: the largest overlap with a heading; else (headings centred over wider columns) the largest
 * overlap with the extent the column's values take on the page (`ext`); else the nearest column.
 */
function colOf(cols: readonly PdfCellPart[], ext: readonly { x0: number; x1: number }[], p: PdfCellPart): number {
  const best = (R: readonly { x0: number; x1: number }[]) => {
    let b = -1, bo = 0;
    R.forEach((k, i) => { const o = ov(k, p); if (o > bo) { bo = o; b = i; } });
    return b;
  };
  const a = best(cols);
  if (a >= 0) return a;
  const e = best(ext);
  if (e >= 0) return e;
  let n = 0, nd = Infinity;
  cols.forEach((k, i) => {
    const d = Math.min(Math.abs(k.x0 - p.x0), Math.abs(k.x1 - p.x1), Math.abs((k.x0 + k.x1) / 2 - (p.x0 + p.x1) / 2));
    if (d < nd) { nd = d; n = i; }
  });
  return n;
}

/** Extent of each column's values: pieces that overlap exactly one heading widen that column. */
function extents(cols: readonly PdfCellPart[], R: readonly PdfRow[]): { x0: number; x1: number }[] {
  const ext = cols.map((c) => ({ x0: c.x0, x1: c.x1 }));
  for (const r of R) for (const it of r.items) for (const p of itemParts(it)) {
    const hit = cols.map((k, i) => (ov(k, p) > 0 ? i : -1)).filter((i) => i >= 0);
    if (hit.length !== 1) continue;
    const e = ext[hit[0]!]!;
    e.x0 = Math.min(e.x0, p.x0); e.x1 = Math.max(e.x1, p.x1);
  }
  return ext;
}

/** Cut a row into the columns, item by item (items holding several columns are split at wide gaps). */
function cut(cols: readonly PdfCellPart[], ext: readonly { x0: number; x1: number }[], R: PdfRow): string[] {
  const out = cols.map(() => '');
  for (const it of R.items) for (const p of itemParts(it)) {
    const i = colOf(cols, ext, p);
    out[i] = out[i] ? out[i] + ' ' + p.s : p.s;
  }
  return out;
}

/** Words / numbers of a row with estimated x (one pdfjs item may hold several cells joined by single spaces). */
function wordsOf(R: PdfRow): { x0: number; x1: number; s: string }[] {
  const out: { x0: number; x1: number; s: string }[] = [];
  for (const it of R.items) {
    const cw = it.w > 0 && it.s.length ? it.w / it.s.length : 4;
    for (const m of it.s.matchAll(/\S+/g)) out.push({ x0: it.x + m.index! * cw, x1: it.x + (m.index! + m[0].length) * cw, s: m[0] });
  }
  return out;
}

/**
 * Balances printed as a row of labels over a row of amounts („Претходна состојба | Вкупно задолжување | … “ over
 * „50.000,00 | 59.478,00 | …“): each label takes the amount printed under it (from its start to the next label) →
 * one cell „label amount“ per label, so the statement data is read like „Претходна состојба: 50.000,00“.
 */
function pairLabelRows(rows: PdfRow[]): (string[] | null)[] {
  const out: (string[] | null)[] = rows.map(() => null);
  for (let i = 0; i + 1 < rows.length; i++) {
    const A = rows[i]!, B = rows[i + 1]!;
    if (A.page !== B.page) continue;
    const text = A.items.map((it) => it.s).join(' ');
    if (balanceLabels(text).length < 2) continue;
    const nums = wordsOf(B);
    if (!nums.length || !nums.every((w) => /^-?\(?[\d.,']+\)?-?$/.test(w.s))) continue;
    // label positions on the page: char offsets inside the items
    const labs: { x0: number; s: string }[] = [];
    for (const it of A.items) {
      const cw = it.w > 0 && it.s.length ? it.w / it.s.length : 4;
      const L = balanceLabels(it.s);
      L.forEach((l) => labs.push({ x0: it.x + l.at * cw, s: it.s.slice(l.at, l.end) }));
    }
    if (labs.length < 2) continue;
    labs.sort((a, b) => a.x0 - b.x0);
    const cells = labs.map((l, k) => {
      const end = labs[k + 1]?.x0 ?? Infinity;
      const v = nums.find((w) => (w.x0 + w.x1) / 2 >= l.x0 - 2 && (w.x0 + w.x1) / 2 < end - 2);
      return v ? `${l.s}: ${v.s}` : l.s;
    });
    out[i] = cells; out[i + 1] = [];
  }
  return out;
}

export function bankPdfGrid(items: readonly PdfItem[]): BankPdfGrid | null {
  const rows = pdfRows(items);
  // word-level gluing: header cells printed close together („Износ“ | „Д/П“) stay apart
  const cells = rows.map((r) => rowCells(r, 0.8));
  const txt = (i: number) => cells[i]!.map((c) => c.s);
  const noDigits = (i: number) => !cells[i]!.some((c) => /\d{2,}/.test(c.s));
  let at = -1, hn = 1;
  for (let i = 0; i < Math.min(rows.length, 200) && at < 0; i++) {
    if (isBankHeaderRow(txt(i))) at = i;
    // a header whose amount headings are on the second line („Датум | Опис“ / „Должи | Побарува“)
    else if (i + 1 < rows.length && rows[i + 1]!.page === rows[i]!.page && noDigits(i) && noDigits(i + 1) && cells[i]!.length >= 1 && isBankHeaderRow([...txt(i), ...txt(i + 1)])) { at = i; hn = 2; }
  }
  if (at < 0) return null;
  const close = (a: number, b: number) => rows[b]!.page === rows[a]!.page && rows[a]!.y - rows[b]!.y < rows[a]!.h * 3;
  while (hn < 3 && at + hn < rows.length && close(at + hn - 1, at + hn) && isHeaderContinuation(txt(at + hn), alignAbove(cells[at + hn - 1]!, cells[at + hn]!))) hn++;
  const H = cells.slice(at, at + hn);
  const cols = columnsOf(H);
  const hsig = new Set(H.map(sigOf));
  const ext = extents(cols, rows.slice(at + hn));
  const paired = pairLabelRows(rows);
  const hpage = rows[at]!.page;
  // later pages: the repeated header (and the letterhead above it) is skipped
  const repeatAt = new Map<number, number>();
  rows.forEach((r, i) => { if (i > at && r.page !== hpage && hsig.has(sigOf(cells[i]!)) && !repeatAt.has(r.page)) repeatAt.set(r.page, i); });
  type Cut = { page: number; y: number; h: number; cells: string[]; head?: boolean };
  const pre: Cut[] = [];
  const body: Cut[] = [];
  rows.forEach((r, i) => {
    if (i >= at && i < at + hn) return;
    if (i > at && hsig.has(sigOf(cells[i]!))) return;
    const rep = repeatAt.get(r.page);
    if (r.page !== hpage && rep != null && i < rep) return;
    const pl = paired[i];
    if (pl && !pl.length) return;
    const c: Cut = { page: r.page, y: r.y, h: r.h, cells: pl ? cols.map((_, k) => pl[k] ?? '') : cut(cols, ext, r) };
    (i < at ? pre : body).push(c);
  });
  const header = cols.map((c) => c.s);
  const grid = [...pre.map((c) => c.cells), header, ...mergeCloseRows(body).map((c) => c.cells)];
  return { grid, hi: pre.length };
}

/** Cells of the line above, placed at the positions of the cells below (for the wrapped-heading test). */
function alignAbove(above: readonly PdfCellPart[], below: readonly PdfCellPart[]): string[] {
  return below.map((b) => above.filter((a) => ov(a, b) > 0).map((a) => a.s).join(' '));
}
