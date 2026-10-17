/**
 * „Финансов налог“ (opening / any journal) printed by the old accounting program, read from the PDF text layer
 * without AI. The layout (Cyrillic or the old Latin YUSCII font: „Dol`i“, „Sodr`ina“, „zabele{ka“):
 *
 *   Бр. | Датум | КОНТО | Должи | Побарува | Комитент | Содржина (Фактура број) | Изв. Бр | Док. (Калк. Бр.)
 *
 * Every record starts with its row number („Бр.“) at the left; the date and konto are one text run
 * („01/01/2026 0030“); the debit amount is printed a few points lower than the row; the credit amount and the partner
 * code are one run („4,312.00 24“); partner name and description may wrap. Records are cut by the row number and the
 * cells are assigned to the columns by the x position of the header. The printed totals line („SALDO / Вкупно“)
 * closes the table and is used as the control (Σ debit = Σ credit = printed total).
 */
import type { PdfLine } from './pdf-lines';

export type FinNalogRow = [konto: string, name: string, partner: string, code: string, debit: number, credit: number];
export interface FinNalogResult {
  rows: FinNalogRow[];
  /** Σ debit / Σ credit of the rows */
  sum: [number, number];
  /** printed totals line, when found */
  printed: [number, number] | null;
  /** debit = credit and (when printed) equal to the printed totals */
  balanced: boolean;
  number: string | null;
  date: string | null;
  /** per row (aligned with `rows`): the record's own date (`YYYY-MM-DD`, else the nalog date) and its „Содржина“ */
  dates?: (string | null)[];
  notes?: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const AMT = /^-?\d{1,3}(?:,\d{3})*\.\d{2}$|^-?\d+\.\d{2}$/;
const amt = (s: string) => Number(s.replace(/,/g, ''));
const H = {
  konto: /^(konto|конто)$/i,
  debit: /^(dol.i|должи)$/i,
  credit: /^(pobaruva|побарува)$/i,
  partner: /^(komitent|комитент)$/i,
  desc: /^(sodr.ina|содржина)/i,
};

/** Header x positions, or null when the page has no journal header. */
function header(L: readonly PdfLine[]): { konto: number; debit: number; credit: number; partner: number; desc: number } | null {
  const pos: Partial<Record<keyof typeof H, number>> = {};
  for (const l of L) for (const c of l.cells) {
    for (const w of c.s.split(/\s*\|\s*|\s{2,}/)) {
      for (const k of Object.keys(H) as (keyof typeof H)[]) if (pos[k] == null && H[k].test(w.trim())) pos[k] = c.x0;
    }
  }
  if (pos.konto == null || pos.debit == null || pos.credit == null) return null;
  return { konto: pos.konto, debit: pos.debit, credit: pos.credit, partner: pos.partner ?? pos.credit + 80, desc: pos.desc ?? pos.credit + 180 };
}

/** Is this a „Финансов налог“ printout (title or the column header)? */
export const isFinNalog = (L: readonly PdfLine[]): boolean =>
  L.some((l) => l.cells.some((c) => /(finansov|финансов)\s+nalog|финансов\s+налог/i.test(c.s))) && header(L) != null;

export function finNalogFromLines(L: readonly PdfLine[]): FinNalogResult | null {
  if (!isFinNalog(L)) return null;
  const hd = header(L)!;
  const bDC = hd.credit - 6; // debit | credit
  const bCP = (hd.credit + hd.partner) / 2 + 5; // credit | partner
  const bPD = (hd.partner + hd.desc) / 2; // partner | description
  const bDE = hd.desc + 85; // description | document column (ignored)
  const noX = hd.konto - 12; // row number lies left of the date / konto
  let number: string | null = null, date: string | null = null;
  for (const l of L) for (const c of l.cells) {
    const m = c.s.match(/(?:nalog|налог)\s+(?:broj|број)\s*(\d+)?/i);
    if (m && !number) number = m[1] ?? l.cells.find((x) => /^\d+$/.test(x.s))?.s ?? null;
  }
  type Rec = { k: string; name: string[]; partner: string[]; code: string; d: number; c: number; date: string | null };
  const recs: Rec[] = [];
  let cur: Rec | null = null, printed: [number, number] | null = null, inTable = false;
  for (const l of L) {
    const texts = l.cells.map((c) => c.s.trim());
    if (texts.some((t) => H.konto.test(t))) { inTable = true; cur = null; continue; } // header (repeated per page)
    if (!inTable) continue;
    // totals line closes the table: „SALDO 12,059,456.50 12,059,456.50“ / „Вкупно …“
    // (the label itself is at the left edge — „САЛДО“ in the description column of a record is data)
    if (l.cells.some((c) => c.x0 < noX + 8 && /^(saldo|салдо|vkupno|вкупно)(?![a-zа-шѓѕјљњќџ])/i.test(c.s.trim()))) {
      const a = l.cells.flatMap((c) => c.s.split(/\s+/)).filter((t) => AMT.test(t)).map(amt);
      if (a.length >= 2) printed = [r2(a[0]!), r2(a[1]!)];
      cur = null; inTable = false; continue;
    }
    if (texts.some((t) => /^(saldo|dol.i|pobaruva|strana|страна)$/i.test(t)) && !l.cells.some((c) => /\d{2}\/\d{2}\/\d{4}/.test(c.s))) continue;
    for (const c of l.cells) {
      const s = c.s.trim();
      if (!s) continue;
      // row number alone, or joined with the date and konto in one run („1 01/01/2026 0030“)
      const rn = c.x0 < noX ? s.match(/^(\d+)(?:\s+(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\S+))?)?$/) : null;
      if (rn) {
        cur = { k: rn[5] ?? '', name: [], partner: [], code: '', d: 0, c: 0, date: rn[4] ? `${rn[4]}-${rn[3]}-${rn[2]}` : null }; recs.push(cur);
        if (rn[4] && !date) date = `${rn[4]}-${rn[3]}-${rn[2]}`;
        continue;
      }
      if (!cur) continue;
      if (c.x0 < hd.debit - 10) {
        const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\S+))?$/);
        if (m) { if (!date) date = `${m[3]}-${m[2]}-${m[1]}`; cur.date ??= `${m[3]}-${m[2]}-${m[1]}`; if (m[4]) cur.k = m[4]; }
        else if (/^\d{2,8}$/.test(s) && c.x0 > noX) cur.k = s;
        continue;
      }
      if (c.x0 < bCP) {
        const parts = s.split(/\s+/);
        const a = parts.find((t) => AMT.test(t));
        if (a != null) {
          if (c.x0 < bDC) cur.d = r2(cur.d + amt(a)); else cur.c = r2(cur.c + amt(a));
          const rest = parts.filter((t) => t !== a);
          if (rest.length && /^\d+$/.test(rest[0]!)) { cur.code = rest[0]!; if (rest.length > 1) cur.partner.push(rest.slice(1).join(' ')); }
        } else if (/^\d+$/.test(s) && c.x0 >= bDC) cur.code = s;
        continue;
      }
      if (c.x0 < bPD) {
        const m = s.match(/^(\d+)\s+(.+)$/);
        if (m && !cur.code) { cur.code = m[1]!; cur.partner.push(m[2]!); } else cur.partner.push(s);
        continue;
      }
      if (c.x0 < bDE) cur.name.push(s);
    }
  }
  const kept = recs.filter((r) => r.k && (r.d || r.c));
  const rows: FinNalogRow[] = kept.map((r) => [r.k, '', r.partner.join(' ').trim(), r.code, r.d, r.c]); // „Содржина“ is a note, not the konto name
  if (!rows.length) return null;
  const sum: [number, number] = [r2(rows.reduce((s, r) => s + r[4], 0)), r2(rows.reduce((s, r) => s + r[5], 0))];
  const balanced = Math.abs(sum[0] - sum[1]) < 0.005 && (!printed || (Math.abs(printed[0] - sum[0]) < 0.005 && Math.abs(printed[1] - sum[1]) < 0.005));
  return { rows, sum, printed, balanced, number, date, dates: kept.map((r) => r.date ?? date), notes: kept.map((r) => r.name.join(' ').trim()) };
}

/** Grid for the converter / opening-balance importer: the opening-balance template headings + one line per record. */
export const finNalogGrid = (R: FinNalogResult): string[][] => [
  ['Конто', 'Назив на конто', 'Комитент', 'Шифра на комитент / ЕДБ', 'Салдо должи', 'Салдо побарува'],
  ...R.rows.map((r) => [r[0], r[1], r[2], r[3], r[4].toFixed(2), r[5].toFixed(2)]),
];

/**
 * Several nalozi printed one after another (a whole period from the old program): cut at every title line
 * („Финансов налог број …“) and read each part; parts of one nalog continued on the next page under its own title keep
 * their number, so the journal import joins them again.
 */
export function finNalogsFromLines(L: readonly PdfLine[]): FinNalogResult[] {
  const T = /(finansov|финансов)\s+(nalog|налог)/i;
  const at = L.map((l, i) => (l.cells.some((c) => T.test(c.s)) ? i : -1)).filter((i) => i >= 0);
  if (at.length <= 1) { const r = finNalogFromLines(L); return r ? [r] : []; }
  return at.map((a, j) => finNalogFromLines(L.slice(j ? a : 0, at[j + 1] ?? L.length))).filter((r): r is FinNalogResult => r != null);
}

/**
 * Grid for the journal import (`/uvoz?t=journal`, the converter's „Налог за книжење“): the journal template headings
 * and one line per record, with the record's date, the nalog number, the old program's partner code and the
 * „Содржина“ as the description.
 */
export const finNalogJournalGrid = (R: FinNalogResult | readonly FinNalogResult[]): string[][] => [
  ['Датум', 'Вид на налог', 'Број на налог', 'Конто', 'Должи', 'Побарува', 'Шифра на комитент', 'Комитент', 'Опис'],
  ...(Array.isArray(R) ? R : [R as FinNalogResult]).flatMap((N) => N.rows.map((r: FinNalogRow, i: number) => {
    const d = N.dates?.[i] ?? N.date ?? '';
    return [d ? d.split('-').reverse().join('.') : '', '', N.number ?? '', r[0], r[4] ? r[4].toFixed(2) : '', r[5] ? r[5].toFixed(2) : '', r[3], r[2], N.notes?.[i] ?? ''];
  })),
];
