/**
 * Row reconstruction of a trial balance / opening balance / journal table as other programs print or export it
 * (Пантеон, Ажур, Бизнис софт, Мега, Сирма, УЈП-style „Бруто биланс“, PDF text, Excel with wrapped cells) — shared by
 * the converter (`convert/index.ts`), the opening-balance sheet parser (`parseOpeningSheet`) and through it the PDF
 * reader without AI (`noai/ob.ts`), so all three paths treat a file the same way:
 *
 *   - empty rows, repeated page headers / footers (the lines above the table, „Страна 2“, the table heading again,
 *     „Изготвил“ …) and class / group headings („Класа 0“, a 1–2 digit konto without amounts) are skipped as „наслов“;
 *   - total rows („Вкупно 10“, „Тотал“, „Збир“, „Класа 1 вкупно“, a 1–2 digit konto with amounts) are „збир“, never data;
 *   - a line without konto and without amounts continues the previous row (its text is appended cell by cell);
 *   - a line with amounts only (no konto, no text) directly after a konto line without amounts is the same row (PDF
 *     text where the amounts sit on a slightly different baseline, two-line Excel rows); the reverse order too;
 *   - the konto is read from „1000“, „100.0“, „1 000“, „1200-001“ (analytic suffix → `sub`) or from a name cell that
 *     starts with it („1000 Жиро сметка“).
 */
import { parseNumAuto, type NumFmt } from './numfmt';

export type TbSkipWhy = 'збир' | 'наслов' | 'продолжение' | 'празен';
export interface TbSkip { row: number; why: TbSkipWhy; text: string }
export interface TbCols {
  /** Konto column (required). */
  k: number;
  /** Name / partner / code columns (−1 / undefined = none): their text decides „text row“ vs „amounts only“. */
  name?: number; partner?: number; code?: number;
  /** Amount columns (debit, credit, saldo …). */
  amt: readonly (number | undefined)[];
}
export interface TbItem {
  /** Index of the (first) source row. */
  row: number;
  /** The row's cells with the konto cell normalised to digits (and an embedded name moved into the name cell). */
  cells: unknown[];
  kind: 'data' | 'total';
  /** Konto digits ('' = none). */
  k: string;
  /** Analytic suffix of the konto („1200-001“ → „001“). */
  sub: string;
}

const s = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').replace(/ /g, ' ').trim());
const ok = (i: number | undefined): i is number => i != null && i >= 0;

/** Konto of a cell: „1000“, „100.0“, „1 000“, „1200-001“, „1000 Жиро сметка“, 1000 (number). */
export function kontoParse(v: unknown): { k: string; sub: string; rest: string } {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? { k: String(v), sub: '', rest: '' } : { k: '', sub: '', rest: '' };
  const t = s(v);
  const m = /^(\d(?:[\d. ]*\d)?)(?:\s*[-/]\s*(\d{1,10}))?(?:\s*[-–:]?\s+(\D.*))?$/.exec(t);
  if (!m) return { k: '', sub: '', rest: '' };
  const k = m[1]!.replace(/[. ]/g, '');
  // a date („01.01.2026“) or an amount („12.500“) in the konto cell is not a konto: dots must not look like thousands
  if (/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(m[1]!) || /^\d{1,3}(\.\d{3})+$/.test(m[1]!) || k.length > 10) return { k: '', sub: '', rest: '' };
  return { k, sub: m[2] ?? '', rest: (m[3] ?? '').trim() };
}

/** A cell holding a number (amount). */
export const isAmt = (v: unknown, fmt: NumFmt = 'mk'): boolean => (typeof v === 'number' ? Number.isFinite(v) : !!s(v) && parseNumAuto(s(v), fmt) != null);

const TOTAL_RE = /(^|[\s(.:])(се\s+вкупно|вкупно|тотал|збир|сума|total|gjithsej|ukupno|svega|салдо\s+на\s+крај|ново\s+салдо|zbir|vkupno)(?=$|[\s:.)\d])/i;
const CLASS_RE = /^(класа|klasa|група|grupa|синтетика|sintetika|class|сметковна\s+класа)(?=$|[\s:.\d])/i;
const PAGE_RE = /((^|\s)(страна|стр\.|page|strana|faqe)\s*:?\s*\d)|(^\d+\s*(\/|од|of)\s*\d+$)|изготвил|одобрил|контролирал|потпис|^м\.?\s?п\.?$|датум\s+на\s+печат|печатено|отпечатено|printed/i;
const HEAD_K = /^(конто|konto|сметка|account|шифра на конто)$/i;
const HEAD_A = /должи|побарува|салдо|dolzi|pobaruva|saldo|debit|credit|duguje|potra|^д\.?$|^п\.?$/i;
const sig = (r: readonly unknown[]) => r.map(s).filter(Boolean).join(' ').replace(/\s+/g, ' ').replace(/\d/g, '#').toLowerCase();

/** A row that repeats the table heading (page break). */
export const tbHeadLike = (r: readonly unknown[]): boolean => {
  if (r.some((c) => HEAD_K.test(s(c).replace(/[.:]$/, ''))) && r.some((c) => HEAD_A.test(s(c)))) return true;
  // the second heading row of a block layout: „Д | П | Д | П“
  const c = r.map(s).filter(Boolean);
  return c.length >= 2 && c.every((x) => DP_TOKEN.test(x));
};
const DP_TOKEN = /^(д\.?|п\.?|должи|побарува|dolzi|pobaruva|debit|credit|duguje|potrazuje|dug\.?|pot\.?)$/i;

/**
 * Rebuild the data rows below the header. `pre` = the rows above the header (title, firm, period): when they come
 * again inside the table (next page) they are skipped. `fmt` = number format used only to tell amounts from text.
 */
export function tbRebuild(rows: readonly (readonly unknown[])[], c: TbCols, o: { pre?: readonly (readonly unknown[])[]; fmt?: NumFmt; firstRow?: number } = {}): { items: TbItem[]; skipped: TbSkip[] } {
  const fmt = o.fmt ?? 'mk';
  const first = o.firstRow ?? 0;
  const amtCols = c.amt.filter(ok);
  const txtCols = [c.name, c.partner, c.code].filter(ok);
  const preSig = new Set((o.pre ?? []).map(sig).filter((x) => x.length >= 4));
  const items: TbItem[] = [];
  const skipped: TbSkip[] = [];
  const skip = (i: number, why: TbSkipWhy, r: readonly unknown[]) => skipped.push({ row: first + i, why, text: r.map(s).filter(Boolean).join(' ').slice(0, 80) });
  let last: TbItem | null = null; // last data row
  let lastIdx = -2; // source index of the last data row (for „directly after“)
  let pending: { i: number; r: readonly unknown[] } | null = null; // amounts-only line waiting for the konto line below
  let totalIdx = -2; // source index of the last total row without amounts
  const hasA = (r: readonly unknown[]) => amtCols.some((i) => isAmt(r[i], fmt));
  const txt = (r: readonly unknown[]) => txtCols.some((i) => s(r[i]) !== '');

  rows.forEach((r, i) => {
    const any = r.some((x) => s(x) !== '');
    if (!any) { skip(i, 'празен', r); return; }
    const a = hasA(r);
    let kp = kontoParse(r[c.k]);
    let cells = [...r];
    if (kp.k && kp.rest && ok(c.name) && c.name !== c.k && !s(r[c.name])) cells[c.name] = kp.rest;
    if (!kp.k && !s(r[c.k]) && ok(c.name)) {
      // konto written at the start of the name cell („1000 Жиро сметка“)
      const m = /^(\d{3,8})(?:\s*[-/]\s*(\w{1,10}))?\s+(\D.*)$/.exec(s(r[c.name]));
      if (m) { kp = { k: m[1]!, sub: m[2] ?? '', rest: m[3]! }; cells[c.name] = m[3]!; }
    }
    if (kp.k) cells[c.k] = kp.k;
    const label = r.map(s).filter(Boolean).join(' ');
    // a partner called „TOTAL“ is not a total row: the partner cell is left out of the total test
    const labNoP = r.filter((_, j) => j !== c.partner).map(s).filter(Boolean).join(' ');
    const lab2 = (ok(c.name) ? s(cells[c.name]) : '') + ' ' + s(r[c.k]);
    if (PAGE_RE.test(label) && !(kp.k.length >= 3 && a)) { skip(i, 'наслов', r); return; }
    if (tbHeadLike(r) || (preSig.size && preSig.has(sig(r)) && !(kp.k.length >= 3 && a))) { skip(i, 'наслов', r); return; }
    if (TOTAL_RE.test(labNoP)) {
      if (a && kp.k) items.push({ row: first + i, cells, kind: 'total', k: kp.k, sub: kp.sub });
      if (!a) totalIdx = i;
      skip(i, 'збир', r); return;
    }
    if (CLASS_RE.test(lab2.trim()) || CLASS_RE.test(label)) { skip(i, a ? 'збир' : 'наслов', r); return; }
    if (kp.k && kp.k.length <= 2) {
      // class / group total (1–2 digit konto) or its heading
      if (a) items.push({ row: first + i, cells, kind: 'total', k: kp.k, sub: kp.sub });
      skip(i, a ? 'збир' : 'наслов', r); return;
    }
    if (!kp.k) {
      if (!a) {
        if (last) {
          // continuation of the previous row: its text is appended cell by cell
          r.forEach((x, j) => {
            const v = s(x);
            if (!v || j === c.k || amtCols.includes(j)) return;
            const p = s(last!.cells[j]);
            last!.cells[j] = p ? p + ' ' + v : v;
          });
          skip(i, 'продолжение', r);
        } else skip(i, 'наслов', r);
        return;
      }
      if (!txt(r)) {
        // amounts only, just below a total row („Вкупно:“ with its amounts on their own line): part of the total
        if (totalIdx === i - 1) { totalIdx = i; skip(i, 'збир', r); return; }
        // amounts only: the amounts of the konto line just above (no amounts of its own) …
        if (last && lastIdx === i - 1 && !hasA(last.cells)) {
          for (const j of amtCols) last.cells[j] = r[j];
          lastIdx = i;
          skip(i, 'продолжение', r); return;
        }
        // … or of the konto line just below
        const nx = rows[i + 1];
        if (nx && kontoParse(nx[c.k]).k.length >= 3 && !hasA(nx)) { pending = { i, r }; skip(i, 'продолжение', r); return; }
      }
      // a data row without konto (partner rows under an account heading): the consumer decides
      last = { row: first + i, cells, kind: 'data', k: '', sub: '' };
      lastIdx = i;
      items.push(last);
      return;
    }
    if (pending && pending.i === i - 1 && !a) for (const j of amtCols) cells[j] = pending.r[j];
    pending = null;
    last = { row: first + i, cells, kind: 'data', k: kp.k, sub: kp.sub };
    lastIdx = i;
    items.push(last);
  });
  return { items, skipped };
}

const nonEmpty = (rows: readonly (readonly unknown[])[], j: number) => rows.map((r) => r[j]).filter((v) => s(v) !== '');

/**
 * Konto column by its values (no recognisable heading): ≥ 50 % of the non-empty cells are 3–8 digit kontos and the
 * column is not a running row number (1, 2, 3 …). −1 = none.
 */
export function tbKontoCol(rows: readonly (readonly unknown[])[], exclude: ReadonlySet<number> = new Set()): number {
  const G = rows.slice(0, 300);
  const width = Math.max(0, ...G.map((r) => r.length));
  for (let j = 0; j < width; j++) {
    if (exclude.has(j)) continue;
    const V = nonEmpty(G, j);
    const K = V.filter((v) => { const k = kontoParse(v).k; return k.length >= 3 && k.length <= 8; });
    const seq = V.filter((v, i) => i > 0 && Number(s(v)) === Number(s(V[i - 1])) + 1).length;
    if (V.length && K.length >= V.length * 0.5 && seq < V.length * 0.5) return j;
  }
  return -1;
}

/** Amount columns by their values (≥ 50 % of the non-empty cells are numbers; dates are not), left to right. */
export function tbAmountCols(rows: readonly (readonly unknown[])[], exclude: ReadonlySet<number> = new Set(), fmt: NumFmt = 'mk', from = 0): number[] {
  const G = rows.slice(0, 300);
  const width = Math.max(0, ...G.map((r) => r.length));
  const out: number[] = [];
  for (let j = from; j < width; j++) {
    if (exclude.has(j)) continue;
    const V = nonEmpty(G, j);
    if (V.length && V.filter((v) => !(v instanceof Date) && !/^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}$/.test(s(v)) && isAmt(v, fmt)).length >= V.length * 0.5) out.push(j);
  }
  return out;
}

/** Amount column of a block in a multi-block trial balance (почетно салдо / промет / вкупно / салдо). */
export type TbBlockId = 'saldo' | 'open' | 'turn' | 'total';
export const TB_BLOCK_LABEL: Record<TbBlockId, string> = { saldo: 'Салдо (крајно)', open: 'Почетно салдо', turn: 'Промет', total: 'Вкупно (кумулатив)' };
export interface TbBlock { id: TbBlockId; d: number; p: number }

/**
 * Debit / credit column pairs per block from the (combined) headings. Headings are compared in any script / case.
 * Returns the blocks in the order they appear.
 */
export function tbBlocks(head: readonly unknown[], norm: (x: unknown) => string = (x) => s(x).toLowerCase()): TbBlock[] {
  const H = head.map(norm);
  const isD = (h: string) => /долж|dolz|debit|dugu|(^|\s)д\.?$|(^|\s)d\.?$/.test(h);
  const isP = (h: string) => /побар|pobar|credit|kredit|potra|(^|\s)п\.?$|(^|\s)p\.?$/.test(h);
  const blk = (h: string): TbBlockId | null =>
    /почетн|pocetn|поч\.|poc\.|opening|пренесен/.test(h) ? 'open'
      : /промет|promet|turnover|tekov|тековен/.test(h) ? 'turn'
        : /вкупно|vkupno|кумулат|kumulat|total/.test(h) ? 'total'
          : /салдо|saldo|крајн|krajn|balance/.test(h) ? 'saldo' : null;
  const out: TbBlock[] = [];
  H.forEach((h, i) => {
    const b = blk(h);
    if (!b || !isD(h)) return;
    const p = H.findIndex((x, j) => j > i && blk(x) === b && isP(x));
    if (p > i && !out.some((x) => x.id === b)) out.push({ id: b, d: i, p });
  });
  return out;
}

/** The block used for an opening balance: the closing saldo, else cumulative totals (netted later), else the last. */
export const tbPreferredBlock = (B: readonly TbBlock[]): TbBlock | undefined =>
  B.find((b) => b.id === 'saldo') ?? B.find((b) => b.id === 'total') ?? B[B.length - 1];

/** Split a partner cell „1029 МАЈАНЦЕ“ into code and name (code = leading digits). */
export function partnerSplit(v: unknown): { code: string; name: string } {
  const t = s(v);
  const m = /^(\d{1,8})[\s.\-–:]+(\S.*)$/.exec(t);
  return m && /\D/.test(m[2]!) ? { code: m[1]!, name: m[2]!.trim() } : { code: '', name: t };
}

/** Debit / credit totals and per-class sums (first digit of the konto) — in cents, so the totals are exact. */
export function tbTotals(rows: Iterable<{ k: string; d: number; p: number }>): { D: number; P: number; diff: number; balanced: boolean; byClass: { c: string; d: number; p: number }[] } {
  let D = 0, P = 0;
  const by = new Map<string, { d: number; p: number }>();
  for (const r of rows) {
    const d = Math.round((Number(r.d) || 0) * 100), p = Math.round((Number(r.p) || 0) * 100);
    D += d; P += p;
    const c = String(r.k ?? '').charAt(0) || '?';
    const x = by.get(c) ?? { d: 0, p: 0 };
    x.d += d; x.p += p; by.set(c, x);
  }
  return {
    D: D / 100, P: P / 100, diff: (D - P) / 100, balanced: D === P,
    byClass: [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([c, x]) => ({ c, d: x.d / 100, p: x.p / 100 })),
  };
}
