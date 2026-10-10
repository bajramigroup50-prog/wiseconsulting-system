/**
 * Finance parity — fiscal reports of the manual cash register (`fiskPer`): posting all rows of a read (`fkRows2` 11393,
 * `fkPost` 11448), control checks (`fkCheck` 11351) and the МЕТГ day distribution (`fkSpread` / `fkMetgDays` 11461).
 * Pure; amounts in denars (2 decimals), rates as numbers.
 */
import { r2 } from './money';
import { fkNormDate, fkRows, type FiskRead, type FiskRow } from './ai/fisk';

/** Legacy `fkCheck`: sum of groups ≠ total, VAT per group ≠ computed, cash + card ≠ total. */
export function fkCheck(r: FiskRow, G: Record<string, number>): string[] {
  const f = (n: number) => n.toLocaleString('mk-MK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const P: string[] = [];
  if (Math.abs(r.sum - r.total) > 1) P.push(`збир по групи ${f(r.sum)} ≠ вкупно ${f(r.total)}`);
  for (const [L, g] of Object.entries(r.gross)) {
    const rate = +(G[L] ?? 0) || 0;
    if (rate) {
      const exp = r2((g * rate) / (100 + rate));
      if (Math.abs(exp - (r.vat[L] || 0)) > Math.max(1, g * 0.002)) P.push(`ДДВ ${L} (${rate}%) ${f(r.vat[L] || 0)} ≠ пресметан ${f(exp)}`);
    }
  }
  const pay = r2(r.cash + r.card + r.other);
  if (pay && Math.abs(pay - r.total) > 1) P.push(`готовина+картичка ${f(pay)} ≠ вкупно ${f(r.total)}`);
  return P;
}

/** One record to post (rates as keys: gross and VAT per rate). */
export interface FiskPostRow {
  date: string; z: string; total: number; card: number; cash: number; storno: number; receipts: number;
  gross: Record<string, number>; vat: Record<string, number>;
  /** Day distribution for МЕТГ / КДФИ (legacy `days`). */
  days?: { date: string; z?: string; total: number; est?: boolean; g: Record<string, number>; v: Record<string, number> }[];
}

const byRate = (r: FiskRow, G: Record<string, number>, nonVat: boolean) => {
  const g: Record<string, number> = {}, v: Record<string, number> = {};
  if (nonVat) { g['0'] = r.total || r.sum; return { g, v }; }
  for (const [L, x] of Object.entries(r.gross)) {
    const rate = String(+(G[L] ?? 0) || 0);
    g[rate] = r2((g[rate] || 0) + x);
    if (+rate) v[rate] = r2((v[rate] || 0) + (r.vat[L] || 0));
  }
  return { g, v };
};

/** Legacy `fkSpread`: a period total spread over the days Monday–Saturday; the last day takes the rounding. */
export function fkSpread(from: string, to: string, total: number): { date: string; total: number; est: true }[] {
  const D: string[] = [];
  const a = new Date(from + 'T12:00:00Z'), b = new Date(to + 'T12:00:00Z');
  for (let d = new Date(a); d <= b; d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() !== 0) D.push(d.toISOString().slice(0, 10));
  if (!D.length) return [];
  const per = Math.floor((total * 100) / D.length) / 100;
  const out = D.map((date) => ({ date, total: per, est: true as const }));
  out[out.length - 1]!.total = r2(total - per * (D.length - 1));
  return out;
}

/**
 * Legacy `fkRows2` + `fkPost` + `fkMetgDays`: the rows to post from a read.
 * - `sum` (legacy default) with several days → one record for the period (dated `date` or the last day) carrying the
 *   daily rows as `days`; without `sum` → one record per day.
 * - a periodic report (no daily rows, from ≠ to) is spread over Monday–Saturday unless `mg === 'one'`.
 */
export function fiskPostRows(R: FiskRead, o: { today: string; nonVat?: boolean; sum?: boolean; date?: string; mg?: 'spread' | 'one' }): { rows: FiskPostRow[]; checks: { date: string; problems: string[] }[]; daily: boolean } {
  const X = fkRows(R, o.today);
  const nonVat = !!o.nonVat;
  const checks = X.rows.map((r) => ({ date: r.date, problems: nonVat ? [] : fkCheck(r, X.G) }));
  const day = (r: FiskRow) => { const { g, v } = byRate(r, X.G, nonVat); return { date: r.date, ...(r.z ? { z: r.z } : {}), total: r.total, g, v }; };
  const one = (r: FiskRow): FiskPostRow => {
    const { g, v } = byRate(r, X.G, nonVat);
    return { date: r.date, z: r.z, total: r.total, card: r.card, cash: r.cash, storno: r.storno, receipts: r.receipts, gross: g, vat: v };
  };
  if (X.daily && X.rows.length > 1) {
    if (!o.sum) return { rows: X.rows.map(one), checks, daily: true };
    const T: FiskRow = { date: o.date || X.rows[X.rows.length - 1]!.date, z: (X.rows[0]!.z || '') + '–' + (X.rows[X.rows.length - 1]!.z || ''), gross: {}, vat: {}, total: 0, sum: 0, cash: 0, card: 0, other: 0, storno: 0, receipts: 0 };
    for (const r of X.rows) {
      for (const [L, g] of Object.entries(r.gross)) { T.gross[L] = r2((T.gross[L] || 0) + g); T.vat[L] = r2((T.vat[L] || 0) + (r.vat[L] || 0)); }
      for (const k of ['total', 'sum', 'cash', 'card', 'other', 'storno', 'receipts'] as const) T[k] = r2(T[k] + (+r[k] || 0));
    }
    return { rows: [{ ...one(T), days: X.rows.map(day) }], checks, daily: true };
  }
  const r0 = { ...X.rows[0]!, ...(o.date && !X.daily ? { date: o.date } : {}) };
  const row = one(r0);
  const from = fkNormDate(R.from), to = fkNormDate(R.to);
  if (!X.daily && o.mg !== 'one' && from && to && from !== to) {
    const tot = byRate(r0, X.G, nonVat);
    const D = fkSpread(from, to, r0.total);
    const T = r0.total || 1;
    const acc = { g: {} as Record<string, number>, v: {} as Record<string, number> };
    row.days = D.map((d, i) => {
      const last = i === D.length - 1;
      const g: Record<string, number> = {}, v: Record<string, number> = {};
      for (const [rt, x] of Object.entries(tot.g)) { g[rt] = last ? r2(x - (acc.g[rt] || 0)) : r2((x * d.total) / T); acc.g[rt] = r2((acc.g[rt] || 0) + g[rt]!); }
      for (const [rt, x] of Object.entries(tot.v)) { v[rt] = last ? r2(x - (acc.v[rt] || 0)) : r2((x * d.total) / T); acc.v[rt] = r2((acc.v[rt] || 0) + v[rt]!); }
      return { ...d, g, v };
    });
  }
  return { rows: [row], checks, daily: X.daily };
}
