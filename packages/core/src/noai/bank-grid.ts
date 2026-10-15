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
  // a heading over sub-headings of another line („ИЗНОС“ over „задолжува | одобрува“ printed under it): one column per
  // sub-heading at the sub-heading's position, so the amounts go to their own direction by x
  const out: { x0: number; x1: number; s: string }[] = [];
  for (const k of cols) {
    const subs = H.flatMap((L, li) => (li === bi ? [] : L.filter((c) => ov(k, c) > 0).map((c) => ({ c, li }))));
    const byLine = new Map<number, PdfCellPart[]>();
    for (const x of subs) (byLine.get(x.li) ?? byLine.set(x.li, []).get(x.li)!).push(x.c);
    const split = [...byLine.entries()].find(([li, L]) => li > bi && L.length >= 2 && L.every((a, i) => L.every((b, j) => i === j || ov(a, b) <= 0)) && L.every((c) => cols.filter((q) => ov(q, c) > 0).length === 1));
    if (split) {
      const [li, L] = split;
      const other = subs.filter((x) => x.li !== li).map((x) => x.c.s);
      for (const c of L.slice().sort((a, b) => a.x0 - b.x0)) out.push({ x0: c.x0, x1: c.x1, s: [...k.top.filter((t) => !L.some((q) => q.s === t)), k.s, ...other.filter((t) => !k.top.includes(t)), c.s].filter(Boolean).join(' ') });
      continue;
    }
    out.push({ x0: k.x0, x1: k.x1, s: [...k.top, k.s, ...k.bottom].filter(Boolean).join(' ') });
  }
  return out.sort((a, b) => a.x0 - b.x0);
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
  // a header line on its own first; only then one whose amount headings are on the second line („Датум | Опис“ over
  // „Должи | Побарува“). FIX: a sentence above the table („Примивме во корист / на товар на сметка“) is not a header.
  for (let i = 0; i < Math.min(rows.length, 200) && at < 0; i++) if (isBankHeaderRow(txt(i))) at = i;
  for (let i = 0; i < Math.min(rows.length, 200) && at < 0; i++) {
    if (i + 1 < rows.length && rows[i + 1]!.page === rows[i]!.page && noDigits(i) && noDigits(i + 1) && cells[i]!.length >= 2 && isBankHeaderRow([...txt(i), ...txt(i + 1)])) { at = i; hn = 2; }
  }
  if (at < 0) return null;
  // sub-headings printed a little further down („должи | побарува | пров.“ under „Износ“, Комерцијална) are still
  // the header when they are short words only
  const close = (a: number, b: number) => rows[b]!.page === rows[a]!.page
    && (rows[a]!.y - rows[b]!.y < rows[a]!.h * 3 || (rows[a]!.y - rows[b]!.y < rows[a]!.h * 5 && cells[b]!.every((c) => c.s.length <= 12 && !/\d/.test(c.s))));
  while (hn < 4 && at + hn < rows.length && close(at + hn - 1, at + hn) && isHeaderContinuation(txt(at + hn), alignAbove(cells[at + hn - 1]!, cells[at + hn]!))) hn++;
  const H = cells.slice(at, at + hn);
  const cols = columnsOf(H);
  const hsig = new Set(H.map(sigOf));
  const ext = extents(cols, rows.slice(at + hn));
  const paired = pairLabelRows(rows);
  const stacked = stackedLabels(rows.slice(0, at), paired);
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
  const grid = [...stacked.map((t) => [t]), ...pre.map((c) => c.cells), header, ...mergeCloseRows(body).map((c) => c.cells)];
  return { grid, hi: stacked.length + pre.length };
}

/**
 * Balances printed as amounts under labels that are stacked over several lines and not aligned with each other
 * (Халк: „претходна / состојба“, „дневен промет“ over „долгува | побарува“, „нова состојба“, over
 * „51,158.00  38,779.00  0.00  12,379.00“): every word above a line of amounts belongs to the nearest number below it
 * → „претходна состојба: 51,158.00“, „дневен промет долгува: 38,779.00“ … (only labels of balances / turnover).
 */
function stackedLabels(rows: readonly PdfRow[], paired: readonly (string[] | null)[]): string[] {
  const out: string[] = [];
  const isNum = (s: string) => /^-?\(?[\d.,']+\)?-?$/.test(s) && /\d/.test(s);
  const money = (s: string) => /[.,]\d{2}\)?-?$/.test(s);
  rows.forEach((R, i) => {
    if (paired[i]) return; // already read as a label row over a value row
    const W = wordsOf(R);
    const nums = W.filter((w) => isNum(w.s));
    if (nums.filter((w) => money(w.s)).length < 2) return;
    const lab = new Map<(typeof nums)[number], { y: number; x: number; s: string }[]>();
    for (let j = i - 1; j >= 0; j--) {
      const A = rows[j]!;
      if (A.page !== R.page || A.y - R.y > 75) break;
      const AW = rowCells(A, 0.8);
      if (j < i - 1 && AW.filter((w) => isNum(w.s) && money(w.s)).length >= 2) break;
      for (const w of AW) {
        if (isNum(w.s) || !/[\p{L}]/u.test(w.s)) continue;
        const c = (w.x0 + w.x1) / 2;
        let best: (typeof nums)[number] | null = null, bd = Infinity;
        for (const n of nums) { const d = Math.abs((n.x0 + n.x1) / 2 - c); if (d < bd) { bd = d; best = n; } }
        if (best && bd < 70) (lab.get(best) ?? lab.set(best, []).get(best)!).push({ y: A.y, x: w.x0, s: w.s });
      }
    }
    for (const n of nums) {
      if (!money(n.s)) continue;
      const t = (lab.get(n) ?? []).sort((a, b) => b.y - a.y || a.x - b.x).map((w) => w.s).join(' ');
      if (t && balanceLabels(t).length) out.push(`${t}: ${n.s}`);
    }
  });
  return out;
}

/** Cells of the line above, placed at the positions of the cells below (for the wrapped-heading test). */
function alignAbove(above: readonly PdfCellPart[], below: readonly PdfCellPart[]): string[] {
  return below.map((b) => above.filter((a) => ov(a, b) > 0).map((a) => a.s).join(' '));
}
