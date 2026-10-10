/**
 * Owner's activity report per client (legacy `miRange` / `miMonths` / `miCalc` / `miSorted` 14905–14935): how much work
 * each firm brings (items) against the monthly fee, and the AI cost.
 */
export const MK_MON_L = ['Јануари', 'Февруари', 'Март', 'Април', 'Мај', 'Јуни', 'Јули', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември'];

export interface MiRange { from: string; to: string; m0: string; m1: string; lbl: string }

/** Legacy `miRange`: one month, or a year up to the current month. */
export function miRange(md: 'm' | 'y', m: string, y: string, nowYm: string): MiRange {
  if (md === 'y') { const last = y === nowYm.slice(0, 4) ? nowYm : y + '-12'; return { from: y + '-01-01', to: y + '-12-31', m0: y + '-01', m1: last, lbl: 'година ' + y }; }
  const [yy, mm] = m.split('-').map(Number) as [number, number];
  const end = new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
  return { from: m + '-01', to: end, m0: m, m1: m, lbl: MK_MON_L[mm - 1] + ' ' + yy };
}

/** Legacy `miMonths`: months from a to b inclusive (0 when a > b). */
export function miMonths(a: string, b: string): number {
  if (!a || !b || a > b) return 0;
  return (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7)) + 1;
}

export interface MiFacts {
  inv: number; pur: number; ai: number; stm: number; bl: number; sal: number; jr: number; emp: number; payEmp: number;
  /** Revenue 74–76, purchases (base), class-4 costs (den.). */
  prih: number; nab: number; tro: number;
  /** Monthly fee and the month it applies from (`YYYY-MM`). */
  fee: number; feeFrom: string | null;
  aiUsd: number;
}

export interface MiRow extends MiFacts { items: number; feeP: number; perItem: number | null; aiMkd: number; net: number }

/** Legacy `miCalc` + the AI part of `miGo`. */
export function miCalc(x: MiFacts, R: MiRange, usdMkd: number): MiRow {
  const items = x.inv + x.pur + x.bl + x.sal + x.jr + x.payEmp;
  const fm = x.fee ? miMonths(x.feeFrom && x.feeFrom > R.m0 ? x.feeFrom : R.m0, R.m1) : 0;
  const feeP = x.fee * fm;
  const aiMkd = x.aiUsd * usdMkd;
  return { ...x, items, feeP, perItem: items && x.fee ? feeP / items : null, aiMkd, net: feeP - aiMkd };
}

/** Legacy `flag`: rating against the median den./item. */
export function miFlag(r: MiRow, med: number | null): [string, string] | null {
  if (!r.fee) return r.items ? ['нема надоместок', 'warn'] : null;
  if (!r.items) return ['без активност', ''];
  if (med && r.perItem! < med * 0.5) return ['потценет', 'bad'];
  if (med && r.perItem! > med * 1.5) return ['добро платен', 'good'];
  return ['просечно', 'info'];
}

export const miMedian = (rows: readonly MiRow[]): number | null => {
  const pp = rows.filter((r) => r.perItem != null && r.fee > 0).map((r) => r.perItem!).sort((a, b) => a - b);
  return pp.length ? pp[Math.floor(pp.length / 2)]! : null;
};
