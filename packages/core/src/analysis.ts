/**
 * Анализи и извештаи — pure part of legacy `VIEWS.analizi` 5297 and its helpers (5258–5296): `salesLines`, `anRange`,
 * `anDays`, `aggBy`, `abc`, `cls`, `heat`, `cashForecast`, `ratios`, plus `dashRange` / `dashAgg` 3756–3761.
 * The web layer loads documents, stock and the ledger and feeds these functions.
 */

const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const r4 = (x: number) => Math.round(x * 10000) / 10000;

export const MON = ['Јан', 'Фев', 'Мар', 'Апр', 'Мај', 'Јун', 'Јул', 'Авг', 'Сеп', 'Окт', 'Ное', 'Дек'] as const;
export const WEEKDAYS = ['Пон', 'Вто', 'Сре', 'Чет', 'Пет', 'Саб', 'Нед'] as const;
export const WEEKDAYS_LONG = ['понеделник', 'вторник', 'среда', 'четврток', 'петок', 'сабота', 'недела'] as const;

export const AN_TABS = [['sales', 'Продажба'], ['prod', 'Производи и залиха'], ['part', 'Комитенти'], ['cash', 'Паричен тек · прогноза'], ['kpi', 'Финансиски показатели'], ['time', 'Време и сезона']] as const;
export type AnTab = (typeof AN_TABS)[number][0];
export const AN_PER = [['l30', 'Последни 30 дена'], ['l90', 'Последни 90 дена'], ['m', 'Тековен месец'], ['q1', 'Т1'], ['q2', 'Т2'], ['q3', 'Т3'], ['q4', 'Т4'], ['ytd', 'Од почеток на година'], ['year', 'Цела година']] as const;
export type AnPer = (typeof AN_PER)[number][0];

export interface Range { from: string; to: string; lab: string }

const mEnd = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);

/** Legacy `dashRange` 3756 (year / ytd / m / q1–q4). */
export function dashRange(per: string, year: number, today: string): Range {
  const cm = today.startsWith(String(year)) ? +today.slice(5, 7) : 12;
  if (per === 'ytd') return { from: `${year}-01-01`, to: mEnd(year, cm), lab: `од почеток на ${year}` };
  if (per === 'm') { const mm = String(cm).padStart(2, '0'); return { from: `${year}-${mm}-01`, to: mEnd(year, cm), lab: `${MON[cm - 1]} ${year}` }; }
  const q = /^q[1-4]$/.test(per) ? +per.slice(1) : 0;
  if (q) return { from: `${year}-${String(q * 3 - 2).padStart(2, '0')}-01`, to: mEnd(year, q * 3), lab: `Т${q} ${year}` };
  return { from: `${year}-01-01`, to: `${year}-12-31`, lab: `цела ${year}` };
}

/** Legacy `anRange` 5264: last 30 / 90 days end today, otherwise `dashRange` (default: year to date). */
export function anRange(per: string | undefined, year: number, today: string): Range {
  const p = per || 'ytd';
  if (p === 'l30' || p === 'l90') return { from: addDays(today, p === 'l30' ? -29 : -89), to: today, lab: p === 'l30' ? 'последни 30 дена' : 'последни 90 дена' };
  return dashRange(p, year, today);
}

/** Legacy `anDays`: days in the range up to today (at least 1). */
export const anDays = (r: Pick<Range, 'from' | 'to'>, today: string): number => Math.max(1, dayDiff(r.from, r.to < today ? r.to : today) + 1);

/* ---------------- Sales lines (legacy `salesLines` 5258) ---------------- */

export interface SalesLine { date: string; item: string; name: string; qty: number; net: number; cost: number; partner: string; wh: string; doc: 'inv' | 'pos' }
export interface AnInvoice {
  id: string; date: string; credit: boolean; partner: string; wh: string; fx: number;
  lines: { item: string | null; name: string; qty: number; price: number; disc: number }[];
}
export interface AnPosMove { date: string; item: string; name: string; qty: number; value: number; wh: string; rate: number; retail: number }

/**
 * Invoice lines (credit notes negative) with the cost of the stock issued for them, and POS (каса) issues valued at
 * the retail price without VAT. `costOf(invoiceId, itemId)` is the cost of the invoice's moves for that item; it is
 * split over the invoice's lines of the item by quantity (moves are stored per item, legacy per line).
 */
export function salesLines(invoices: readonly AnInvoice[], pos: readonly AnPosMove[], costOf: (invoiceId: string, itemId: string) => number, from: string, to: string): SalesLine[] {
  const out: SalesLine[] = [];
  for (const inv of invoices) {
    if (inv.date < from || inv.date > to) continue;
    const sg = inv.credit ? -1 : 1;
    const qtyBy = new Map<string, number>();
    for (const l of inv.lines) if (l.item) qtyBy.set(l.item, (qtyBy.get(l.item) ?? 0) + Math.abs(l.qty));
    for (const l of inv.lines) {
      const net = r2((l.qty || 0) * (l.price || 0) * (1 - (l.disc || 0) / 100) * (inv.fx || 1)) * sg;
      if (!net) continue;
      const tq = l.item ? qtyBy.get(l.item) ?? 0 : 0;
      const cost = l.item && tq ? r2(costOf(inv.id, l.item) * Math.abs(l.qty) / tq) : 0;
      out.push({ date: inv.date, item: l.item ?? '', name: l.name || '—', qty: (l.qty || 0) * sg, net, cost, partner: inv.partner, wh: inv.wh || 'main', doc: 'inv' });
    }
  }
  for (const m of pos) {
    if (m.date < from || m.date > to) continue;
    const q = -m.qty;
    const gross = q * m.retail;
    out.push({ date: m.date, item: m.item, name: m.name || '—', qty: q, net: r2(gross / (1 + m.rate / 100)), cost: -m.value, partner: '__kasa', wh: m.wh, doc: 'pos' });
  }
  return out;
}

export interface Agg { k: string; n: string; qty: number; net: number; cost: number; cnt: number; last: string; mg: number; mgp: number | null }

/** Legacy `aggBy`: totals by key, highest sales first. */
export function aggBy(L: readonly SalesLine[], key: (l: SalesLine) => string, lab: (l: SalesLine, k: string) => string): Agg[] {
  const o = new Map<string, { k: string; n: string; qty: number; net: number; cost: number; cnt: number; last: string }>();
  for (const l of L) {
    const k = key(l);
    const x = o.get(k) ?? { k, n: lab(l, k), qty: 0, net: 0, cost: 0, cnt: 0, last: '' };
    x.qty += l.qty; x.net += l.net; x.cost += l.cost; x.cnt++;
    if (l.date > x.last) x.last = l.date;
    o.set(k, x);
  }
  return [...o.values()].map((x) => ({
    ...x, qty: r4(x.qty), net: r2(x.net), cost: r2(x.cost), mg: r2(x.net - x.cost),
    mgp: x.net ? Math.round((x.net - x.cost) / x.net * 1000) / 10 : null,
  })).sort((a, b) => b.net - a.net);
}

/** Legacy `abc`: A = the items making the first 80% of sales, B = up to 95%, C = the rest. Input sorted by sales. */
export function abc<T extends { net: number }>(rows: readonly T[]): (T & { share: number; cls: 'A' | 'B' | 'C' })[] {
  const T = rows.reduce((a, r) => a + Math.max(0, r.net), 0) || 1;
  let c = 0;
  return rows.map((r) => {
    c += Math.max(0, r.net);
    const sh = c / T;
    return { ...r, share: Math.round(r.net / T * 1000) / 10, cls: sh <= 0.8 || c === Math.max(0, r.net) ? 'A' : sh <= 0.95 ? 'B' : 'C' };
  });
}

export type Status = 'good' | 'warn' | 'bad' | '';
/** Legacy `cls`: good / warn / bad against thresholds (`inv`: lower is better). */
export function cls(v: number | null | undefined, good: number, bad: number, inv = false): Status {
  if (v == null || Number.isNaN(v)) return '';
  if (inv ? v <= good : v >= good) return 'good';
  if (inv ? v >= bad : v <= bad) return 'bad';
  return 'warn';
}

/** Legacy `heat`: sales by weekday (Mon first) × month. */
export function heatGrid(L: readonly SalesLine[]): number[][] {
  const G = Array.from({ length: 7 }, () => Array<number>(12).fill(0));
  for (const l of L) {
    const d = new Date(l.date + 'T12:00:00Z');
    G[(d.getUTCDay() + 6) % 7]![d.getUTCMonth()]! += l.net;
  }
  return G;
}

/** Sales by month (12 values). */
export function byMonth(L: readonly SalesLine[]): number[] {
  const a = Array<number>(12).fill(0);
  for (const l of L) a[+l.date.slice(5, 7) - 1]! += l.net;
  return a.map(r2);
}

/** Sales by weekday, Monday first. */
export function byWeekday(L: readonly SalesLine[]): number[] {
  const a = Array<number>(7).fill(0);
  for (const l of L) a[(new Date(l.date + 'T12:00:00Z').getUTCDay() + 6) % 7]! += l.net;
  return a.map(r2);
}

/* ---------------- Partners (tab `part`) ---------------- */

export interface AnDoc { id: string; partner: string; date: string; due: string | null; total: number; paid: number }

export interface CustomerRow { pid: string; n: string; rev: number; open: number; lateV: number; maxLate: number; risk: 'good' | 'warn' | 'bad'; cnt: number }
export function customerRisk(invoices: readonly AnDoc[], L: readonly SalesLine[], name: (pid: string) => string, today: string): CustomerRow[] {
  const ids = [...new Set(invoices.map((i) => i.partner).filter(Boolean))];
  return ids.map((pid) => {
    const I = invoices.filter((i) => i.partner === pid);
    const rev = r2(L.filter((l) => l.partner === pid).reduce((a, l) => a + l.net, 0));
    const open = r2(I.reduce((a, i) => a + Math.max(0, i.total - i.paid), 0));
    const late = I.filter((i) => (i.due || i.date) < today && i.total - i.paid > 0.009);
    const lateV = r2(late.reduce((a, i) => a + i.total - i.paid, 0));
    const maxLate = late.reduce((a, i) => Math.max(a, dayDiff(i.due || i.date, today)), 0);
    const risk: CustomerRow['risk'] = maxLate > 90 || (lateV > open * 0.6 && lateV > 0) ? 'bad' : maxLate > 30 || lateV > 0 ? 'warn' : 'good';
    return { pid, n: name(pid), rev, open, lateV, maxLate, risk, cnt: I.length };
  }).filter((x) => x.rev || x.open).sort((a, b) => b.rev - a.rev);
}

export interface SupplierRow { n: string; inP: number; open: number; due7: number }
export function supplierRows(purchases: readonly AnDoc[], name: (pid: string) => string, r: Pick<Range, 'from' | 'to'>, today: string): SupplierRow[] {
  const ids = [...new Set(purchases.map((p) => p.partner).filter(Boolean))];
  return ids.map((pid) => {
    const P = purchases.filter((p) => p.partner === pid);
    const inP = r2(P.filter((p) => p.date >= r.from && p.date <= r.to).reduce((a, p) => a + p.total, 0));
    const open = r2(P.reduce((a, p) => a + Math.max(0, p.total - p.paid), 0));
    const due7 = r2(P.filter((p) => { const d = p.due || p.date; return d >= today && dayDiff(today, d) <= 7; }).reduce((a, p) => a + Math.max(0, p.total - p.paid), 0));
    return { n: name(pid), inP, open, due7 };
  }).filter((x) => x.inP || x.open).sort((a, b) => b.inP - a.inP);
}

/* ---------------- Cash forecast (legacy `cashForecast` 5277) ---------------- */

export interface ForecastWeek { from: string; inn: number; out: number; items: string[]; bal: number }
export interface ForecastInput {
  today: string;
  /** Balance of the bank accounts and the cash register (1020) today. */
  start: number;
  invoices: readonly AnDoc[];
  purchases: readonly AnDoc[];
  /** VAT of the last finished period, when payable and not yet due. */
  vat?: { amount: number; due: string } | null;
  /** Gross + employer contributions of the last booked payroll (paid on the 10th of the next three months). */
  payroll?: number | null;
  fmt?: (n: number) => string;
}

export function cashForecast(a: ForecastInput): { start: number; wk: ForecastWeek[]; lateIn: number } {
  const t = a.today;
  const f = a.fmt ?? ((n: number) => String(n));
  const wk: Omit<ForecastWeek, 'bal'>[] = Array.from({ length: 13 }, (_, i) => ({ from: addDays(t, i * 7), inn: 0, out: 0, items: [] }));
  const wi = (d: string) => { if (d <= t) return 0; const n = Math.floor(dayDiff(t, d) / 7); return n < 13 ? n : -1; };
  let lateIn = 0;
  for (const i of a.invoices) {
    const o = r2(i.total - i.paid);
    if (o <= 0.009) continue;
    const d = i.due || i.date;
    if (d < t) { lateIn += o; continue; }
    const w = wi(d);
    if (w >= 0) wk[w]!.inn += o;
  }
  for (const p of a.purchases) {
    const o = r2(p.total - p.paid);
    if (o <= 0.009) continue;
    const w = wi(p.due || p.date);
    if (w >= 0) wk[w]!.out += o;
  }
  if (a.vat && a.vat.amount > 0 && a.vat.due >= t) {
    const w = wi(a.vat.due);
    if (w >= 0) { wk[w]!.out += a.vat.amount; wk[w]!.items.push('ДДВ ' + f(a.vat.amount)); }
  }
  if (a.payroll && a.payroll > 0) {
    const tot = r2(a.payroll);
    for (let k = 0; k < 3; k++) {
      const [y, m] = [+t.slice(0, 4), +t.slice(5, 7) + k + (+t.slice(8, 10) > 10 ? 1 : 0)];
      const d = new Date(Date.UTC(y, m - 1, 10)).toISOString().slice(0, 10);
      const w = wi(d);
      if (w >= 0) { wk[w]!.out += tot; wk[w]!.items.push('Плата ~' + f(tot)); }
    }
  }
  let bal = a.start;
  const W = wk.map((w) => { const inn = r2(w.inn), out = r2(w.out); bal = r2(bal + inn - out); return { ...w, inn, out, bal }; });
  return { start: a.start, wk: W, lateIn: r2(lateIn) };
}

/* ---------------- Ratios (legacy `ratios` 5287) ---------------- */

export const isRev = (k: string) => /^7[4-9]/.test(k);
export const isExp = (k: string) => /^4[0-8]/.test(k) || /^7[0-3]/.test(k);

/** Legacy `dashAgg`: revenue, expenses and expenses by group (`70` = cost of goods sold) for [from, to]. */
export function dashAgg(L: readonly { date: string; account: string; debit: number; credit: number }[], from: string, to: string) {
  let rev = 0, exp = 0;
  const eg: Record<string, number> = {};
  for (const l of L) {
    if (l.date < from || l.date > to) continue;
    const k = String(l.account);
    if (isRev(k)) rev += (l.credit || 0) - (l.debit || 0);
    else if (isExp(k)) {
      const v = (l.debit || 0) - (l.credit || 0);
      exp += v;
      const g = /^7[0-3]/.test(k) ? '70' : k.slice(0, 2);
      eg[g] = (eg[g] ?? 0) + v;
    }
  }
  return { rev: r2(rev), exp: r2(exp), res: r2(rev - exp), eg };
}

export interface RatiosInput {
  /** Account → debit − credit balance (all postings of the year except the closing journal). */
  balance: Readonly<Record<string, number>>;
  /** Revenue / expenses of the year to date (`dashAgg`). */
  agg: ReturnType<typeof dashAgg>;
  /** Purchases (gross) in the same range. */
  purchases: number;
  days: number;
}

export interface Ratios {
  cash: number; recv: number; stockV: number; ca: number; cl: number;
  cur: number | null; quick: number | null; cashR: number | null;
  dso: number | null; dpo: number | null; dio: number | null; ccc: number | null;
  gm: number | null; nm: number | null; be: number | null; beM: number | null;
  rev: number; res: number; fixed: number; cmr: number; days: number;
}

export function ratios(a: RatiosInput): Ratios {
  const sum = (re: RegExp) => r2(Object.entries(a.balance).filter(([k]) => re.test(k)).reduce((s, [, v]) => s + v, 0));
  const cash = sum(/^10/), recv = sum(/^1[2-4]/), stockV = sum(/^(3|6)/);
  const ca = r2(cash + recv + sum(/^1[5-9]/) + stockV), cl = r2(-sum(/^2[2-4]/) - sum(/^2[5-9]/));
  const A = a.agg, days = a.days, eg = A.eg;
  const cogs = r2(eg['70'] ?? 0), mat = r2(eg['40'] ?? 0), svc = r2(eg['41'] ?? 0);
  const fixed = r2((eg['42'] ?? 0) + (eg['43'] ?? 0) + (eg['44'] ?? 0) + (eg['45'] ?? 0) + (eg['47'] ?? 0));
  const pur = r2(a.purchases);
  const pay = -sum(/^22/);
  const varc = r2(cogs + mat + svc);
  const cmr = A.rev ? (A.rev - varc) / A.rev : 0;
  const be = cmr > 0 && fixed > 0 ? r2(fixed / cmr) : null;
  const dso = A.rev && recv >= 0 ? Math.round(recv / (A.rev * 1.18) * days) : null;
  const dpo = pur && pay >= 0 ? Math.round(pay / pur * days) : null;
  const dio = cogs > 0 && stockV >= 0 ? Math.round(stockV / cogs * days) : null;
  const q = (x: number) => Math.round(x * 100) / 100;
  return {
    cash, recv, stockV, ca, cl,
    cur: cl ? q(ca / cl) : null, quick: cl ? q((ca - stockV) / cl) : null, cashR: cl ? q(cash / cl) : null,
    dso, dpo, dio, ccc: dso != null && dio != null && dpo != null ? dso + dio - dpo : null,
    gm: A.rev ? Math.round((A.rev - cogs) / A.rev * 1000) / 10 : null, nm: A.rev ? Math.round(A.res / A.rev * 1000) / 10 : null,
    be, beM: be != null ? r2(be / Math.max(1, days) * 30) : null, rev: A.rev, res: A.res, fixed, cmr: Math.round(cmr * 1000) / 10, days,
  };
}

/** Legacy `kfmt`: short amounts for chart labels (К = thousand, М = million). */
export function kfmt(v: number): string {
  const a = Math.abs(v);
  const s = a >= 1e6 ? (a / 1e6).toLocaleString('mk-MK', { maximumFractionDigits: 1 }) + ' М' : a >= 1e3 ? Math.round(a / 1e3).toLocaleString('mk-MK') + ' К' : Math.round(a).toLocaleString('mk-MK');
  return (v < 0 ? '−' : '') + s;
}
