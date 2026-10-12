/**
 * PDF text items → rows for column cutting (shared by the table readers without AI). Unlike `pdfLines`, a row keeps
 * its items, so a table can be cut item by item (two values printed close together, „0.00“ and „666“, are not glued
 * into one cell), and rows printed a little apart — amounts sitting 2–4 pt below the text of the same transaction —
 * can be joined by y position once the columns are known (`mergeCloseRows`).
 */
import { OFFSET_TOL, type PdfItem } from './pdf-lines';

export interface PdfRow { page: number; y: number; h: number; items: PdfItem[] }

/** Items on (almost) the same baseline → rows, top → bottom, page by page; items left → right. */
export function pdfRows(items: readonly PdfItem[]): PdfRow[] {
  const I = items.filter((i) => i.s && i.s.trim()).slice().sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const rows: PdfRow[] = [];
  for (const it of I) {
    const h = it.h && it.h > 0 ? it.h : 8;
    const R = rows[rows.length - 1];
    if (R && R.page === it.page && Math.abs(R.y - it.y) <= Math.max(2, Math.min(h, R.h) * 0.45)) R.items.push(it);
    else rows.push({ page: it.page, y: it.y, h, items: [it] });
  }
  for (const R of rows) R.items.sort((a, b) => a.x - b.x);
  return rows;
}

export interface PdfCellPart { x0: number; x1: number; s: string }

/** Items of a row glued into cells where the gap is under `glue` characters (1.5: cells; 0.8: words only). */
export function rowCells(R: PdfRow, glue = 1.5): PdfCellPart[] {
  const cells: PdfCellPart[] = [];
  for (const it of R.items) {
    const txt = it.s.replace(/\s+/g, ' ');
    const cw = it.w > 0 && txt.trim().length ? it.w / txt.length : 4;
    const c = cells[cells.length - 1];
    const gap = c ? it.x - c.x1 : Infinity;
    if (c && gap < Math.max(cw * glue, glue >= 1 ? 3 : 1.5)) {
      c.s = (gap > cw * 0.25 && !c.s.endsWith(' ') && !txt.startsWith(' ') ? c.s + ' ' : c.s) + txt;
      c.x1 = Math.max(c.x1, it.x + it.w);
    } else cells.push({ x0: it.x, x1: it.x + Math.max(it.w, 1), s: txt });
  }
  return cells.map((c) => ({ ...c, s: c.s.trim() })).filter((c) => c.s);
}

/** Pieces of an item split at runs of 2+ spaces (one pdfjs item may hold several columns), with estimated x. */
export function itemParts(it: PdfItem): PdfCellPart[] {
  const s = it.s;
  const cw = it.w > 0 && s.length ? it.w / s.length : 4;
  const out: PdfCellPart[] = [];
  for (const m of s.matchAll(/\S+(?: \S+)*/g)) out.push({ x0: it.x + m.index! * cw, x1: it.x + (m.index! + m[0].length) * cw, s: m[0] });
  return out;
}

/**
 * Rows already cut into columns (`cells[i]` = text of column i) whose baselines are closer than `OFFSET_TOL` (the rule of `pdfLines`) × the text
 * height and that do not both fill a column are one printed row (an amount printed a little lower or higher than
 * the text of the same transaction): joined.
 */
export function mergeCloseRows<T extends { page: number; y: number; h: number; cells: string[] }>(rows: readonly T[], tol = OFFSET_TOL): T[] {
  const out: T[] = [];
  for (const r of rows) {
    const p = out[out.length - 1];
    const close = p && p.page === r.page && Math.abs(p.y - r.y) < Math.max(p.h, r.h) * tol;
    if (close && !r.cells.some((c, i) => c && p.cells[i])) {
      out[out.length - 1] = { ...p, cells: p.cells.map((c, i) => c || r.cells[i] || '') };
      continue;
    }
    out.push(r);
  }
  return out;
}
