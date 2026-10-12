/**
 * PDF text layer → lines and cells (pure; the PDF itself is opened with pdfjs in the worker / web, which pass the
 * positioned text items here). Items on the same baseline form a line; a horizontal gap wider than ~1.5 characters
 * starts a new cell, so table columns stay apart. `pdfTable` maps the lines under a recognised header line to the
 * header's columns by x position — generic column detection instead of a per-bank / per-supplier layout.
 */
import { colFormat, parseNumAuto, type ColFmt, type NumFmt } from '../numfmt';

/** One text item of a page (x / y in PDF points, y grows upward like pdfjs `transform[5]`). */
export interface PdfItem { page: number; x: number; y: number; w: number; h?: number; s: string }
export interface PdfCell { x0: number; x1: number; s: string }
export interface PdfLine { page: number; y: number; cells: PdfCell[]; /** text height of the line (pt) */ h?: number }

const clean = (s: string) => s.replace(/\s+/g, ' ');

/** Two text lines closer than this × the text height are one printed row (baseline offset); shared with `pdf-rows.ts`. */
export const OFFSET_TOL = 0.9;

/** Group the items into lines (top → bottom, page by page) and cells (left → right). */
export function pdfLines(items: readonly PdfItem[]): PdfLine[] {
  const I = items.filter((i) => i.s && i.s.trim()).slice().sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const lines: { page: number; y: number; h: number; it: PdfItem[] }[] = [];
  for (const it of I) {
    const h = it.h && it.h > 0 ? it.h : 8;
    const L = lines[lines.length - 1];
    if (L && L.page === it.page && Math.abs(L.y - it.y) <= Math.max(2, Math.min(h, L.h) * 0.45)) L.it.push(it);
    else lines.push({ page: it.page, y: it.y, h, it: [it] });
  }
  return mergeOffsetLines(lines.map((L) => {
    const S = L.it.sort((a, b) => a.x - b.x);
    const cells: PdfCell[] = [];
    for (const it of S) {
      const txt = clean(it.s);
      const cw = it.w > 0 && txt.trim().length ? it.w / txt.length : 4;
      const c = cells[cells.length - 1];
      const gap = c ? it.x - c.x1 : Infinity;
      if (c && gap < Math.max(cw * 1.5, 3)) {
        c.s = (gap > cw * 0.25 && !c.s.endsWith(' ') && !txt.startsWith(' ') ? c.s + ' ' : c.s) + txt;
        c.x1 = Math.max(c.x1, it.x + it.w);
      } else cells.push({ x0: it.x, x1: it.x + Math.max(it.w, 1), s: txt });
    }
    return { page: L.page, y: L.y, h: L.h, cells: cells.map((c) => ({ ...c, s: c.s.trim() })).filter((c) => c.s) };
  }).filter((l) => l.cells.length));
}

/**
 * Cells printed on a slightly different baseline than the rest of their row (amount columns of some programs sit
 * 3–6 pt lower): a line closer than 0.9 × the text height to the previous one whose cells overlap none of the
 * previous line's cells is the same table row. Real rows are at least one text height apart and share columns.
 */
function mergeOffsetLines(L: (PdfLine & { h: number })[]): PdfLine[] {
  const out: (PdfLine & { h: number })[] = [];
  for (const l of L) {
    const p = out[out.length - 1];
    const close = p && p.page === l.page && Math.abs(p.y - l.y) < OFFSET_TOL * Math.max(p.h, l.h);
    const overlap = p && l.cells.some((c) => p.cells.some((q) => Math.min(q.x1, c.x1) - Math.max(q.x0, c.x0) > -1));
    if (p && close && !overlap) { p.cells = [...p.cells, ...l.cells].sort((a, b) => a.x0 - b.x0); p.h = Math.max(p.h, l.h); }
    else out.push({ ...l, cells: [...l.cells] });
  }
  return out;
}

/** Text of a line, cells separated by two spaces. */
export const lineText = (l: PdfLine): string => l.cells.map((c) => c.s).join('  ');

/** Lines as a grid of cell texts (what the converter shows for a PDF). */
export const linesGrid = (L: readonly PdfLine[]): string[][] => L.map((l) => l.cells.map((c) => c.s));

const hasDigit = (l: PdfLine) => l.cells.some((c) => /\d/.test(c.s));

export interface PdfTable { header: string[]; rows: string[][]; /** index of the header line in the input */ at: number }

/**
 * The first line for which `isHeader(cells)` holds becomes the column set (a second header line without digits is
 * merged: „Салдо“ above „Должи | Побарува“ → „Салдо Должи“, „Салдо Побарува“). Every following line is cut into those
 * columns by overlap (nearest column when nothing overlaps). Repeated header lines (page breaks) are skipped;
 * `stop(lineText)` ends the table (e.g. „Вкупно“, „Рекапитулација“).
 */
export function pdfTable(L: readonly PdfLine[], isHeader: (cells: string[]) => boolean, stop?: (t: string) => boolean): PdfTable | null {
  const at = L.findIndex((l) => isHeader(l.cells.map((c) => c.s)));
  if (at < 0) return null;
  let cols: PdfCell[] = L[at]!.cells.map((c) => ({ ...c }));
  let start = at + 1;
  const nx = L[at + 1];
  if (nx && !hasDigit(nx) && nx.cells.length >= 2 && nx.page === L[at]!.page) {
    const ov = (a: PdfCell, b: PdfCell) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0;
    const low = nx.cells.map((c) => ({ ...c }));
    const merged: PdfCell[] = low.map((c) => {
      const up = cols.filter((u) => ov(u, c)).map((u) => u.s).join(' ');
      return { ...c, s: (up ? up + ' ' : '') + c.s };
    });
    for (const u of cols) if (!low.some((c) => ov(u, c))) merged.push(u);
    cols = merged.sort((a, b) => a.x0 - b.x0);
    start = at + 2;
  }
  const header = cols.map((c) => c.s);
  const sig = header.join('|').toLowerCase();
  const rows: string[][] = [];
  for (const l of L.slice(start)) {
    const t = lineText(l);
    if (stop && stop(t)) break;
    if (l.cells.map((c) => c.s).join('|').toLowerCase() === sig) continue;
    if (isHeader(l.cells.map((c) => c.s))) continue;
    const row = header.map(() => '');
    for (const c of l.cells) {
      let best = -1, bs = -Infinity;
      cols.forEach((k, i) => {
        const o = Math.min(k.x1, c.x1) - Math.max(k.x0, c.x0);
        const score = o > 0 ? 1e6 + o : -Math.abs((k.x0 + k.x1) / 2 - (c.x0 + c.x1) / 2);
        if (score > bs) { bs = score; best = i; }
      });
      row[best] = row[best] ? row[best] + ' ' + c.s : c.s;
    }
    rows.push(row);
  }
  return { header, rows, at };
}

/**
 * A PDF as a grid for the converter: the header line (≥ 3 cells, mostly text, the widest of the first 60 lines) gives
 * the columns, the lines below are cut into them; text above the table is kept as single-cell rows. Without such a
 * line, the lines as they are.
 */
export function pdfAutoGrid(L: readonly PdfLine[]): string[][] {
  let at = -1, best = 0;
  L.slice(0, 60).forEach((l, i) => {
    const txt = l.cells.filter((c) => !/\d/.test(c.s)).length;
    if (l.cells.length >= 3 && txt >= l.cells.length * 0.7 && l.cells.length > best) { best = l.cells.length; at = i; }
  });
  if (at < 0) return linesGrid(L);
  const sig = L[at]!.cells.map((c) => c.s).join('|');
  const T = pdfTable(L.slice(at), (cells) => cells.join('|') === sig);
  if (!T) return linesGrid(L);
  return [...L.slice(0, at).map((l) => [lineText(l)]), T.header, ...T.rows];
}

/**
 * A number as printed on documents: „1.234,56“, „1,234.56“, „1 234,56“, „-12,5“, „12,50-“, „(12,50)“. An ambiguous
 * value („10.000“, „1,500“) is read in `fmt` — the document's format (`docFmt`); default the Macedonian dot-thousands.
 */
export function mkNum(s: unknown, fmt: NumFmt = 'mk'): number | null {
  const t = String(s ?? '').trim().replace(/\u00a0/g, ' ').replace(/(\d)\s+(?=\d{3}\b)/g, '$1');
  return parseNumAuto(t, fmt);
}

const NUM_RE = /-?\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,4})?-?|-?\d+(?:[.,]\d{1,4})?-?/g;

/** Number tokens of a text as written. */
export const numTokens = (s: string): string[] => [...s.matchAll(NUM_RE)].map((m) => m[0]);

/** All numbers in a text (thousands-separated, decimal comma / point), ambiguous ones read in `fmt`. */
export function numsIn(s: string, fmt: NumFmt = 'mk'): number[] {
  const out: number[] = [];
  for (const t of numTokens(s)) {
    const n = mkNum(t, fmt);
    if (n != null) out.push(n);
  }
  return out;
}

/** Number format of a whole document from all its amount tokens (dates are left out). */
export function docFmt(lines: readonly string[]): ColFmt {
  return colFormat(lines.map((l) => l.replace(/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/g, ' ')).flatMap(numTokens));
}

/** First date in a text as `YYYY-MM-DD` (d.m.yyyy, d/m/yyyy, d-m-yyyy, yyyy-mm-dd, d.m.yy). */
export function dateIn(s: string): string {
  let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
  m = /(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?!\d)/.exec(s);
  if (!m) return '';
  const d = +m[1]!, mo = +m[2]!;
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return '';
  const y = m[3]!.length === 2 ? '20' + m[3] : m[3]!;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
