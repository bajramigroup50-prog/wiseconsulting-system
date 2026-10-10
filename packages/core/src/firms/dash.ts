/**
 * Control dashboard (legacy `VIEWS.home` 3788 with `dashRange` / `dashAgg` / `dashMonthly` / `pct` 3756–3765) and the
 * business analysis board (legacy `klDash` 11588 with `kdRange` 11562). Ledger input is pre-aggregated per account
 * and month; amounts in denars (2 decimals, legacy `r2`).
 */

export const MON = ['јан', 'фев', 'мар', 'апр', 'мај', 'јун', 'јул', 'авг', 'сеп', 'окт', 'ное', 'дек'] as const;
export const MK_MON = ['Јануари', 'Февруари', 'Март', 'Април', 'Мај', 'Јуни', 'Јули', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември'] as const;
export const EXPG: Readonly<Record<string, string>> = {
  '40': 'Материјали и енергија', '41': 'Услуги', '42': 'Плати и надоместоци', '43': 'Амортизација', '44': 'Нематеријални и други трошоци',
  '45': 'Финансиски расходи', '46': 'Вредносно усогласување', '47': 'Други расходи', '48': 'Вонредни расходи', '70': 'Набавна вредност на продадено',
};
export const KD_EXP: Readonly<Record<string, string>> = {
  '40': 'Материјали и енергија', '41': 'Услуги', '42': 'Плати', '43': 'Амортизација', '44': 'Останати трошоци', '45': 'Вредносно усогласување', '46': 'Останати расходи', '49': 'Други',
};

const r2 = (n: number) => Math.round(n * 100) / 100;
export const isRev = (k: string) => /^7[4-9]/.test(k);
export const isExp = (k: string) => /^4[0-8]/.test(k) || /^7[0-3]/.test(k);

/** Ledger lines summed per account and month (1–12) of the business year (year-close journal excluded). */
export interface AcctMonth { account: string; month: number; debit: number; credit: number }

export const DASH_PER = [['m', 'Тековен месец'], ['q1', 'Т1'], ['q2', 'Т2'], ['q3', 'Т3'], ['q4', 'Т4'], ['ytd', 'Од почеток на година'], ['year', 'Цела година']] as const;
export type DashPer = (typeof DASH_PER)[number][0];
export const isDashPer = (p: unknown): p is DashPer => DASH_PER.some(([k]) => k === p);

const mEnd = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;

/** Legacy `dashRange`: [from, to], month indexes m0..m1 (0-based) and a label. */
export function dashRange(y: number, p: DashPer, today: string): { from: string; to: string; m0: number; m1: number; lab: string } {
  const cm = today.startsWith(String(y)) ? +today.slice(5, 7) : 12;
  if (p === 'year') return { from: `${y}-01-01`, to: `${y}-12-31`, m0: 0, m1: 11, lab: 'цела ' + y };
  if (p === 'ytd') return { from: `${y}-01-01`, to: mEnd(y, cm), m0: 0, m1: cm - 1, lab: 'од почеток на ' + y };
  if (p === 'm') return { from: `${y}-${String(cm).padStart(2, '0')}-01`, to: mEnd(y, cm), m0: cm - 1, m1: cm - 1, lab: MON[cm - 1] + ' ' + y };
  const q = +p.slice(1);
  return { from: `${y}-${String(q * 3 - 2).padStart(2, '0')}-01`, to: mEnd(y, q * 3), m0: q * 3 - 3, m1: q * 3 - 1, lab: 'Т' + q + ' ' + y };
}

/** Legacy `dashAgg` over the months m0..m1: revenue, expenses, result, expenses by group (70–73 → '70'). */
export function dashAgg(L: readonly AcctMonth[], m0: number, m1: number) {
  let rev = 0, exp = 0;
  const eg: Record<string, number> = {};
  for (const l of L) {
    if (l.month - 1 < m0 || l.month - 1 > m1) continue;
    const k = l.account;
    if (isRev(k)) rev += l.credit - l.debit;
    else if (isExp(k)) { const v = l.debit - l.credit; exp += v; const g = /^7[0-3]/.test(k) ? '70' : k.slice(0, 2); eg[g] = (eg[g] ?? 0) + v; }
  }
  return { rev: r2(rev), exp: r2(exp), res: r2(rev - exp), eg };
}

/** Legacy `dashMonthly`: revenue / expenses per month and the cumulative money balance (bank kontos + 1020). */
export function dashMonthly(L: readonly AcctMonth[], cashKontos: ReadonlySet<string>) {
  const R = Array(12).fill(0) as number[], E = Array(12).fill(0) as number[], C = Array(12).fill(0) as number[];
  for (const l of L) {
    const mi = l.month - 1;
    if (mi < 0 || mi > 11) continue;
    if (isRev(l.account)) R[mi]! += l.credit - l.debit;
    else if (isExp(l.account)) E[mi]! += l.debit - l.credit;
    if (cashKontos.has(l.account)) C[mi]! += l.debit - l.credit;
  }
  let c = 0;
  return { R: R.map(r2), E: E.map(r2), CB: C.map((v) => (c += v, r2(c))) };
}

/** Legacy `pct`: change in % (1 decimal), null without a base. */
export const pct = (a: number, b: number): number | null => (b ? Math.round((a - b) / Math.abs(b) * 1000) / 10 : null);

/** Legacy `kfmt`: 1,2 М / 350 К / 120. */
export function kfmt(v: number): string {
  const a = Math.abs(v);
  return (v < 0 ? '−' : '') + (a >= 1e6 ? (a / 1e6).toLocaleString('mk-MK', { maximumFractionDigits: 1 }) + ' М' : a >= 1e3 ? Math.round(a / 1e3).toLocaleString('mk-MK') + ' К' : Math.round(a).toLocaleString('mk-MK'));
}

export const daysBetween = (a: string, b: string) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 864e5);

/** Legacy receivables ageing buckets (by due date, or invoice date when there is none). [label, test(daysOverdue), colour] */
export const AGE: readonly (readonly [string, (od: number) => boolean, string])[] = [
  ['Во рок', (od) => od >= 0, 'var(--good)'], ['1–30 дена', (od) => od < 0 && od >= -30, 'var(--warn)'], ['31–60 дена', (od) => od < -30 && od >= -60, '#c65a1e'],
  ['61–90 дена', (od) => od < -60 && od >= -90, 'var(--bad)'], ['над 90 дена', (od) => od < -90, '#7a1a14'],
];

/** Payroll + МПИН deadline (legacy: 10th of next month, or this month's 10th when today ≤ 10). */
export function payDeadline(today: string): { due: string; month: string } {
  let y = +today.slice(0, 4), m = +today.slice(5, 7);
  if (+today.slice(8, 10) > 10) { m++; if (m > 12) { m = 1; y++; } }
  const due = `${y}-${String(m).padStart(2, '0')}-10`;
  m--; if (!m) { m = 12; y--; }
  return { due, month: `${y}-${String(m).padStart(2, '0')}` };
}

/* ---------------- klDash ---------------- */

export const KD_PER = [['7', '7 дена'], ['30', '30 дена'], ['m', 'Овој месец'], ['pm', 'Минат месец'], ['q', 'Квартал'], ['ytd', 'Од почеток на год.'], ['y', 'Цела година'], ['c', 'Избери…']] as const;
export type KdPer = (typeof KD_PER)[number][0];
export const isKdPer = (p: unknown): p is KdPer => KD_PER.some(([k]) => k === p);

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const ut = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));

/** Legacy `kdRange`. */
export function kdRange(y: number, P: KdPer, today: string, cFrom?: string, cTo?: string): [string, string, string] {
  const t = today.startsWith(String(y)) ? today : `${y}-12-31`;
  const ty = +t.slice(0, 4), tm = +t.slice(5, 7);
  if (P === 'm') return [t.slice(0, 8) + '01', t, 'Тековен месец'];
  if (P === 'pm') return [iso(Date.UTC(ty, tm - 2, 1)), iso(Date.UTC(ty, tm - 1, 0)), 'Претходен месец'];
  if (P === 'q') return [iso(Date.UTC(ty, Math.floor((tm - 1) / 3) * 3, 1)), t, 'Тековен квартал'];
  if (P === '7') return [iso(ut(t) - 6 * 864e5), t, 'Последни 7 дена'];
  if (P === '30') return [iso(ut(t) - 29 * 864e5), t, 'Последни 30 дена'];
  if (P === 'y') return [`${y}-01-01`, `${y}-12-31`, 'Цела година'];
  const D = /^\d{4}-\d{2}-\d{2}$/;
  if (P === 'c') return [cFrom && D.test(cFrom) ? cFrom : `${y}-01-01`, cTo && D.test(cTo) ? cTo : t, 'Избран период'];
  return [`${y}-01-01`, t, 'Од почеток на годината'];
}

/** Chart buckets for klDash (legacy `kdChart`): by day up to 62 days, otherwise by month. */
export function kdBuckets(from: string, to: string): { byMonth: boolean; keys: string[] } {
  const nd = daysBetween(from, to) + 1;
  const byMonth = nd > 62;
  const keys: string[] = [];
  if (byMonth) {
    let y = +from.slice(0, 4), m = +from.slice(5, 7);
    const e = to.slice(0, 7);
    for (;;) { const k = `${y}-${String(m).padStart(2, '0')}`; if (k > e) break; keys.push(k); m++; if (m > 12) { m = 1; y++; } }
  } else for (let t = ut(from); iso(t) <= to; t += 864e5) keys.push(iso(t));
  return { byMonth, keys };
}
