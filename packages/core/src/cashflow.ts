/**
 * „💧 Паричен тек – прогноза“ (30 / 60 / 90 days, per day): from today's bank balances, the expected inflows of the open
 * sales invoices by due date (optionally moved by the customer's average delay from the payment history) and the
 * outflows of the open purchase invoices by due date, plus the recurring items — salaries (net, then contributions and
 * ПДД on the usual pay day from the payroll history), the VAT of each period on its due date, loan / leasing
 * instalments and rent / recurring payments found in the statement history — and the user's own one-off items.
 * Gives the running balance per day and per week, the first day below zero / below the chosen minimum and warnings.
 *
 * The 13-week weekly forecast of „Анализи“ (`cashForecast`, legacy parity, used by the health score and the bank
 * dossier) stays as it is; this is the detailed daily planner.
 */
import { perRange, periodDue, periodOf } from './vat';

const r2 = (x: number) => Math.round(x * 100) / 100;
const D = (s: string) => new Date(s + 'T00:00:00Z');
export const cfAddDays = (s: string, n: number) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const cfDayDiff = (a: string, b: string) => Math.round((D(b).getTime() - D(a).getTime()) / 86400000);
const dmy = (d: string) => d.split('-').reverse().join('.');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export const CF_HORIZONS = [30, 60, 90] as const;

/** An open document (sales or purchase invoice): total and paid in denars. */
export interface CfDoc { id: string; partner: string; number?: string | null; date: string; due: string | null; total: number; paid: number }
/** Net salaries and the contributions + personal income tax of one month, paid on `day` of the next month. */
export interface CfPayroll { net: number; contrib: number; day: number }
export interface CfVat { amount: number; due: string; label: string; est?: boolean }
/** Monthly item (rent, leasing, loan instalment …): `amount` > 0 = outflow, < 0 = inflow, on `day` of each month. */
export interface CfRecurring { label: string; amount: number; day: number; kind?: 'rec' | 'loan'; from?: string | null; until?: string | null }
/** One-off item entered by the user: `amount` > 0 = inflow, < 0 = outflow. */
export interface CfManual { id?: string; date: string; amount: number; label: string }

export type CfKind = 'inv' | 'late' | 'pur' | 'net' | 'contrib' | 'vat' | 'loan' | 'rec' | 'manual';
export const CF_KIND: Record<CfKind, string> = {
  inv: 'Наплата од купувачи', late: 'Задоцнети побарувања', pur: 'Плаќања на добавувачи', net: 'Плати (нето)',
  contrib: 'Придонеси и ПДД', vat: 'ДДВ', loan: 'Рати (кредит / лизинг)', rec: 'Редовни плаќања', manual: 'Рачни ставки',
};
export interface CfItem { date: string; amount: number; kind: CfKind; label: string; partner?: string; ref?: string }
export interface CfDay { date: string; inn: number; out: number; bal: number; items: CfItem[] }
export interface CfWeek { from: string; to: string; inn: number; out: number; bal: number }

export interface CfInput {
  today: string;
  /** Days ahead (30 / 60 / 90). */
  horizon: number;
  /** Balance of the bank accounts (and the cash register when included) today. */
  start: number;
  invoices: readonly CfDoc[];
  purchases: readonly CfDoc[];
  /** Average days late per customer (`cfAvgDelay`); applied when `useDelay`. */
  delays?: ReadonlyMap<string, number>;
  useDelay?: boolean;
  /** Overdue receivables: expected this many days from today; null = not counted. Default 7. */
  lateIn?: number | null;
  payroll?: CfPayroll | null;
  vat?: readonly CfVat[];
  recurring?: readonly CfRecurring[];
  manual?: readonly CfManual[];
  /** Minimum balance the firm wants to keep (0 = only below zero). */
  min?: number;
  partnerName?: (id: string) => string;
  fmt?: (n: number) => string;
}

export interface CfResult {
  start: number; end: string; days: CfDay[]; weeks: CfWeek[]; items: CfItem[];
  firstNeg: CfDay | null; firstMin: CfDay | null; low: { date: string; bal: number };
  totals: Record<CfKind, number>; inn: number; out: number;
  overdueIn: { n: number; sum: number }; overduePur: { n: number; sum: number };
  warnings: string[];
}

/** Dates of `day` of every month in (after, to] (day 31 → the last day of shorter months). */
export function cfMonthly(after: string, to: string, day: number): string[] {
  const out: string[] = [];
  let y = +after.slice(0, 4), m = +after.slice(5, 7);
  for (let k = 0; k < 40; k++) {
    const d = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(Math.max(1, day), lastDay(y, m))).padStart(2, '0')}`;
    if (d > to) break;
    if (d > after) out.push(d);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

/**
 * Average days late per customer from the payment history: every paid amount weighted by its size, days after the due
 * date (an early payment counts 0). Only customers with at least `minPays` payments.
 */
export function cfAvgDelay(docs: readonly { partner: string; date: string; due: string | null; pays: readonly { date: string; amt: number }[] }[], minPays = 1): Map<string, number> {
  const S = new Map<string, { w: number; d: number; n: number }>();
  for (const x of docs) {
    if (!x.partner) continue;
    const due = x.due || x.date;
    for (const p of x.pays) {
      const a = Math.abs(p.amt);
      if (!a) continue;
      const s = S.get(x.partner) ?? { w: 0, d: 0, n: 0 };
      s.w += a; s.d += a * Math.max(0, cfDayDiff(due, p.date)); s.n++;
      S.set(x.partner, s);
    }
  }
  const out = new Map<string, number>();
  for (const [k, s] of S) if (s.n >= minPays && s.w > 0) out.set(k, Math.round(s.d / s.w));
  return out;
}

/** Median (0 for none). */
const median = (a: readonly number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** The usual pay day from the dates salaries were paid (median day of month), else `dflt`. */
export const cfPayday = (dates: readonly string[], dflt = 10) => (dates.length ? Math.round(median(dates.map((d) => +d.slice(8, 10)))) : dflt);

/**
 * Recurring payments from the statement history (rent, leasing, utilities, loan instalments not on a contract): per key
 * (partner or konto + counterparty), the months of the last `months` full months with a payment; with at least `minHits`
 * months whose sums stay within ±`tol` of their median → a monthly item of the median sum on the median day.
 */
export function cfRecurringFromHistory(lines: readonly { date: string; amount: number; key: string; label: string }[], today: string, o: { months?: number; minHits?: number; tol?: number } = {}): CfRecurring[] {
  const months = o.months ?? 4, minHits = o.minHits ?? 3, tol = o.tol ?? 0.25;
  const ms: string[] = [];
  let y = +today.slice(0, 4), m = +today.slice(5, 7);
  for (let k = 0; k < months; k++) { if (--m < 1) { m = 12; y--; } ms.push(`${y}-${String(m).padStart(2, '0')}`); }
  const G = new Map<string, { label: string; by: Map<string, { sum: number; days: number[] }> }>();
  for (const l of lines) {
    const mk = l.date.slice(0, 7);
    if (!ms.includes(mk) || !(l.amount > 0)) continue;
    const g = G.get(l.key) ?? G.set(l.key, { label: l.label, by: new Map() }).get(l.key)!;
    const b = g.by.get(mk) ?? g.by.set(mk, { sum: 0, days: [] }).get(mk)!;
    b.sum += l.amount; b.days.push(+l.date.slice(8, 10));
  }
  const out: CfRecurring[] = [];
  for (const g of G.values()) {
    if (g.by.size < minHits) continue;
    const sums = [...g.by.values()].map((b) => b.sum), med = median(sums);
    if (!(med > 0) || sums.some((s) => Math.abs(s - med) > med * tol)) continue;
    out.push({ label: g.label, amount: r2(med), day: Math.round(median([...g.by.values()].flatMap((b) => b.days))), kind: 'rec' });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

/**
 * VAT of the periods due in (today, end]: the last finished period with its computed amount, and the following periods
 * estimated with the same amount (`est`). A refund (negative) is no outflow.
 */
export function cfVatSchedule(a: { today: string; end: string; kind: 'month' | 'quarter'; last: { period: string; due: string; amount: number } | null }): CfVat[] {
  if (!a.last) return [];
  const out: CfVat[] = [];
  const amt = r2(a.last.amount);
  if (amt > 0 && a.last.due >= a.today && a.last.due <= a.end) out.push({ amount: amt, due: a.last.due, label: `ДДВ ${a.last.period}` });
  let p = a.last.period;
  for (let k = 0; k < 6; k++) {
    p = periodOf(cfAddDays(perRange(p)[1], 1), a.kind);
    const due = periodDue(p);
    if (due > a.end) break;
    if (due >= a.today && amt > 0) out.push({ amount: amt, due, label: `ДДВ ${p} (проценка)`, est: true });
  }
  return out;
}

export function cashflowPlan(a: CfInput): CfResult {
  const t = a.today, end = cfAddDays(t, Math.max(1, a.horizon));
  const f = a.fmt ?? ((n: number) => n.toFixed(2));
  const pn = a.partnerName ?? ((id: string) => id);
  const items: CfItem[] = [];
  const at = (d: string) => (d < t ? t : d);
  const lateIn = a.lateIn === undefined ? 7 : a.lateIn;
  const overdueIn = { n: 0, sum: 0 }, overduePur = { n: 0, sum: 0 };

  for (const i of a.invoices) {
    const o = r2(i.total - i.paid);
    if (o <= 0.009) continue;
    const due = i.due || i.date;
    const delay = a.useDelay ? a.delays?.get(i.partner) ?? 0 : 0;
    const exp = cfAddDays(due, delay);
    const ref = i.number ? `ф. ${i.number}` : undefined;
    if (exp < t || (due < t && !a.useDelay)) {
      overdueIn.n++; overdueIn.sum += o;
      if (lateIn != null) items.push({ date: cfAddDays(t, lateIn), amount: o, kind: 'late', label: `${pn(i.partner)} (задоцнета${due < t ? ' ' + cfDayDiff(due, t) + ' дена' : ''})`, partner: i.partner, ref });
      continue;
    }
    items.push({ date: exp, amount: o, kind: 'inv', label: pn(i.partner) + (delay ? ` (+${delay} дена просечно доцнење)` : ''), partner: i.partner, ref });
  }
  for (const p of a.purchases) {
    const o = r2(p.total - p.paid);
    if (o <= 0.009) continue;
    const due = p.due || p.date;
    if (due < t) { overduePur.n++; overduePur.sum += o; }
    items.push({ date: at(due), amount: -o, kind: 'pur', label: pn(p.partner) + (due < t ? ` (задоцнета ${cfDayDiff(due, t)} дена)` : ''), partner: p.partner, ref: p.number ? `ф. ${p.number}` : undefined });
  }
  if (a.payroll && (a.payroll.net > 0 || a.payroll.contrib > 0)) {
    for (const d of cfMonthly(t, end, a.payroll.day)) {
      if (a.payroll.net > 0) items.push({ date: d, amount: -r2(a.payroll.net), kind: 'net', label: 'Нето плати (проценка од последната пресметка)' });
      if (a.payroll.contrib > 0) items.push({ date: d, amount: -r2(a.payroll.contrib), kind: 'contrib', label: 'Придонеси и ПДД на платите' });
    }
  }
  for (const v of a.vat ?? []) if (v.amount > 0 && v.due >= t && v.due <= end) items.push({ date: v.due, amount: -r2(v.amount), kind: 'vat', label: v.label });
  for (const r of a.recurring ?? []) {
    if (!r.amount) continue;
    const from = r.from && r.from > t ? cfAddDays(r.from, -1) : t;
    for (const d of cfMonthly(from, end, r.day)) {
      if (r.until && d > r.until) break;
      items.push({ date: d, amount: -r2(r.amount), kind: r.kind ?? 'rec', label: r.label });
    }
  }
  for (const m of a.manual ?? []) if (m.amount && m.date <= end) items.push({ date: at(m.date), amount: r2(m.amount), kind: 'manual', label: m.label || 'Рачна ставка' });

  const kept = items.filter((i) => i.date <= end).sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  const days: CfDay[] = [];
  let bal = r2(a.start), k = 0;
  for (let n = 0; n <= Math.max(1, a.horizon); n++) {
    const d = cfAddDays(t, n);
    const I: CfItem[] = [];
    while (k < kept.length && kept[k]!.date === d) I.push(kept[k++]!);
    const inn = r2(I.filter((i) => i.amount > 0).reduce((s, i) => s + i.amount, 0));
    const out = r2(-I.filter((i) => i.amount < 0).reduce((s, i) => s + i.amount, 0));
    bal = r2(bal + inn - out);
    days.push({ date: d, inn, out, bal, items: I });
  }
  const weeks: CfWeek[] = [];
  for (let i = 0; i < days.length; i += 7) {
    const W = days.slice(i, i + 7);
    weeks.push({ from: W[0]!.date, to: W[W.length - 1]!.date, inn: r2(W.reduce((s, x) => s + x.inn, 0)), out: r2(W.reduce((s, x) => s + x.out, 0)), bal: W[W.length - 1]!.bal });
  }
  const min = Math.max(0, a.min ?? 0);
  const firstNeg = days.find((x) => x.bal < 0) ?? null;
  const firstMin = min > 0 ? days.find((x) => x.bal < min) ?? null : null;
  const low = days.reduce((m, x) => (x.bal < m.bal ? { date: x.date, bal: x.bal } : m), { date: t, bal: days[0]?.bal ?? r2(a.start) });
  const totals = Object.fromEntries(Object.keys(CF_KIND).map((x) => [x, 0])) as Record<CfKind, number>;
  for (const i of kept) totals[i.kind] = r2(totals[i.kind] + i.amount);
  const inn = r2(days.reduce((s, x) => s + x.inn, 0)), out = r2(days.reduce((s, x) => s + x.out, 0));
  overdueIn.sum = r2(overdueIn.sum); overduePur.sum = r2(overduePur.sum);

  const W: string[] = [];
  if (firstNeg) W.push(`⛔ На ${dmy(firstNeg.date)} состојбата паѓа под нула (${f(firstNeg.bal)}) – недостигаат пари.`);
  if (firstMin && (!firstNeg || firstMin.date < firstNeg.date)) W.push(`⚠ Од ${dmy(firstMin.date)} состојбата е под минимумот од ${f(min)} (${f(firstMin.bal)}).`);
  if (low.bal < (min || 0) && low.date !== firstNeg?.date) W.push(`Најниска состојба ${f(low.bal)} на ${dmy(low.date)}.`);
  if (overduePur.n) W.push(`Задоцнети обврски кон добавувачи: ${overduePur.n} фактури, ${f(overduePur.sum)} – сметани за плаќање денес.`);
  if (overdueIn.n) W.push(`Задоцнети побарувања: ${overdueIn.n} фактури, ${f(overdueIn.sum)}` + (lateIn == null ? ' – не се сметаат во прогнозата.' : ` – очекувани до ${dmy(cfAddDays(t, lateIn))}.`));
  const big = days.reduce<CfDay | null>((m, x) => (x.out > (m?.out ?? 0) ? x : m), null);
  if (big && big.out > Math.max(1, Math.abs(a.start)) * 0.3) W.push(`Најголем одлив: ${f(big.out)} на ${dmy(big.date)} (${[...new Set(big.items.filter((i) => i.amount < 0).map((i) => CF_KIND[i.kind]))].join(', ')}).`);
  if (firstNeg || (firstMin && low.bal < min)) W.push('Предлог: наплатете ги задоцнетите побарувања, договорете подоцнежен рок со добавувачите или обезбедете позајмица / кредитна линија пред тој датум.');
  return { start: r2(a.start), end, days, weeks, items: kept, firstNeg, firstMin, low, totals, inn, out, overdueIn, overduePur, warnings: W };
}
