/**
 * Fiscal-report support: FIFO/LIFO goods selection for a turnover (`fkAlloc`, `fkIssuePlan`), periodic-report
 * spreading (`fkSpread`), КДФИ day rows (`kdfiDay`, `kdfiRows`) and the daily-fiscal-report control (`dfiControl`).
 */
import type { StockContext } from './types';
import { cents, dayDiffIso, dmy, fmtMk, fromCents, num, r2, r4, weekdayIso, addDaysIso } from './num';
import { whOf } from './accounts';
import { priceAt, trackedItems } from './retail';
import { stockAt } from './average';

export type FkMethod = 'fifo' | 'lifo' | 'prop' | (string & {});

export interface FkLine {
  item: string;
  qty: number;
  /** Retail unit price incl. VAT used for sizing. */
  price: number;
  rate: number;
}

export interface FkAllocArgs {
  /** Turnover (retail value incl. VAT) to cover. */
  target: number;
  date: string;
  wh: string;
  /** Only items with this VAT rate; `null` = any. */
  rate: number | null;
  method: FkMethod;
  /** Quantities already taken by earlier allocations (per item id). Not mutated. */
  used?: Readonly<Record<string, number>>;
}

export interface FkAllocResult {
  lines: FkLine[];
  /** Uncovered remainder. */
  rest: number;
  /** `used` plus this allocation. */
  used: Record<string, number>;
}

const WHOLE_UNIT = /^(ком|пак|кут|бр|пар)/i;

/**
 * Legacy `fkAlloc` (index.html 11399): choose goods to issue for a fiscal turnover. Candidates are goods (of the VAT
 * rate) with stock at the location on the date and a retail price; `fifo` orders by first receipt, `lifo` by last
 * receipt, `prop` first takes the same fraction of every item, then fills greedily. Piece units are issued whole.
 *
 * DELIBERATE FIX: stock comes from the corrected `stockAt` — in the shipped app the swapped arguments made every
 * candidate's stock 0, so no goods were ever proposed.
 * POLICY (LEGACY-MAP §7.4 item 6): FIFO/LIFO only *select* goods; the issue is valued at weighted average by `postOut`.
 * Weighted average is the single costing policy of the system.
 */
export function fkAlloc(ctx: StockContext, a: FkAllocArgs): FkAllocResult {
  const used: Record<string, number> = { ...(a.used ?? {}) };
  const { date, wh, rate, method } = a;
  const its = trackedItems(ctx).filter((it) => it.type === 'goods' && (rate == null || num(it.rate ?? 18) === num(rate)));
  const C: { it: (typeof its)[number]; av: number; pr: number; first: string; last: string }[] = [];
  for (const it of its) {
    const s = stockAt(ctx, { item: it.id, date, wh });
    const av = r4(s.qty - (used[it.id] || 0));
    if (av <= 1e-9) continue;
    const pr = num(priceAt(ctx, it, wh, date)) || num(it.price);
    if (!(pr > 0)) continue;
    const ins = ctx.moves
      .filter((m) => m.item === it.id && whOf(m) === wh && num(m.qty) > 0 && m.date <= date)
      .map((m) => m.date)
      .sort();
    C.push({ it, av, pr, first: ins[0] || '', last: ins[ins.length - 1] || '' });
  }
  if (method === 'lifo') C.sort((x, y) => String(y.last).localeCompare(String(x.last)));
  else if (method === 'fifo') C.sort((x, y) => String(x.first).localeCompare(String(y.first)));
  const whole = (u: string | undefined) => WHOLE_UNIT.test(String(u || 'ком'));
  const out: FkLine[] = [];
  let rem = r2(a.target);
  if (method === 'prop') {
    const tot = C.reduce((s, c) => s + c.av * c.pr, 0);
    if (tot > 0) {
      const k = Math.min(1, rem / tot);
      for (const c of C) {
        let q = c.av * k;
        q = whole(c.it.unit) ? Math.floor(q) : r4(q);
        if (q > 0) {
          out.push({ item: c.it.id, qty: q, price: c.pr, rate: num(c.it.rate ?? 18) });
          rem = r2(rem - q * c.pr);
        }
      }
    }
  }
  for (const c of C) {
    if (rem < 0.5) break;
    const taken = out.find((o) => o.item === c.it.id)?.qty || 0;
    const av = r4(c.av - taken);
    if (av <= 1e-9) continue;
    let q = Math.min(av, rem / c.pr);
    q = whole(c.it.unit) ? Math.floor(q + 1e-9) : r4(q);
    if (q <= 0) continue;
    const o = out.find((x) => x.item === c.it.id);
    if (o) o.qty = r4(o.qty + q);
    else out.push({ item: c.it.id, qty: q, price: c.pr, rate: num(c.it.rate ?? 18) });
    rem = r2(rem - q * c.pr);
  }
  for (const o of out) used[o.item] = r4((used[o.item] || 0) + o.qty);
  return { lines: out, rest: rem, used };
}

export interface FkRow {
  date: string;
  z?: string;
  total: number;
  /** Gross turnover per tax-group letter. */
  gross: Record<string, number>;
}

export interface FkPlanDay {
  date: string;
  z?: string;
  parts: ({ rate: number | null; target: number } & Omit<FkAllocResult, 'used'>)[];
  lines: FkLine[];
  target: number;
  rest: number;
}

/**
 * Legacy `fkIssuePlan` (11407): per report row, allocate goods per tax group (letter → rate via `G`), or for the
 * whole total when the firm is not VAT-registered / no group has a rate. `used` carries over between rows.
 */
export function fkIssuePlan(ctx: StockContext, rows: readonly FkRow[], G: Readonly<Record<string, number>>, wh: string, method: FkMethod, nonVat: boolean): FkPlanDay[] {
  let used: Record<string, number> = {};
  return rows.map((r) => {
    const parts: FkPlanDay['parts'] = [];
    if (nonVat || Object.keys(G).every((L) => !num(G[L]))) {
      const { used: u, ...x } = fkAlloc(ctx, { target: r.total, date: r.date, wh, rate: null, method, used });
      used = u;
      parts.push({ rate: null, target: r.total, ...x });
    } else
      for (const [L, g] of Object.entries(r.gross)) {
        if (!g) continue;
        const { used: u, ...x } = fkAlloc(ctx, { target: g, date: r.date, wh, rate: num(G[L]), method, used });
        used = u;
        parts.push({ rate: num(G[L]), target: g, ...x });
      }
    return {
      date: r.date,
      z: r.z,
      parts,
      lines: parts.flatMap((p) => p.lines),
      target: r.total,
      rest: r2(parts.reduce((s, p) => s + p.rest, 0)),
    };
  });
}

/**
 * Legacy `fkSpread(from,to,total)` (11461): spread a periodic total evenly over the non-Sunday days of the period;
 * the last day takes the rounding remainder. Days are flagged `est` (estimated).
 */
export function fkSpread(from: string, to: string, total: number): { date: string; total: number; est: true }[] {
  const D: string[] = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) if (weekdayIso(d) !== 0) D.push(d);
  if (!D.length) return [];
  const per = Math.floor((total * 100) / D.length) / 100;
  const out = D.map((date) => ({ date, total: per, est: true as const }));
  out[out.length - 1]!.total = r2(total - per * (D.length - 1));
  return out;
}

/* ------------------------------------------------------------------ КДФИ / ДФИ */

export interface FiscalSalesDay {
  date: string;
  z?: string | number;
  total?: number;
  est?: boolean;
  /** Gross per rate. */
  g?: Record<string, number>;
  /** VAT per rate. */
  v?: Record<string, number>;
}

/** `sales` document (daily Z / fiscal report). */
export interface FiscalSales {
  id: string;
  date: string;
  wh?: string;
  total?: number;
  groups?: { rate: number | string; base: number; vat: number; konto?: string }[];
  /** Macedonian-product turnover per rate: `{g: gross, v: vat}`. */
  mk?: Record<string, { g?: number; v?: number }>;
  days?: FiscalSalesDay[];
  fisk?: { z?: string | number; from?: string; to?: string; sc?: string; [k: string]: unknown };
}

export interface KdfiDay {
  g: Record<0 | 5 | 10 | 18, number>;
  v: Record<5 | 10 | 18, number>;
  mg: number;
  mv: Record<string, number>;
  n: number;
  tot: number;
  vt: number;
  mvt: number;
}

/**
 * Legacy `kdfiDay(date)` (effective 11470): КДФИ-01 figures for one day — gross per rate (0/5/10/18), VAT per rate,
 * Macedonian-product turnover, number of reports. Reads `days[]` (with per-rate `g`) or whole-day documents.
 * Sums are in cents (legacy summed floats; `mvt` was unrounded).
 */
export function kdfiDay(sales: readonly FiscalSales[], date: string, wh?: string): KdfiDay {
  const g: Record<number, number> = { 0: 0, 5: 0, 10: 0, 18: 0 };
  const v: Record<number, number> = { 5: 0, 10: 0, 18: 0 };
  const mv: Record<string, number> = { 5: 0, 10: 0, 18: 0 };
  let mg = 0;
  let n = 0;
  for (const s of sales) {
    if (wh && whOf(s) !== wh) continue;
    if (Array.isArray(s.days) && s.days.length && s.days[0]!.g) {
      for (const d of s.days) {
        if (d.date !== date) continue;
        n++;
        for (const [r, x] of Object.entries(d.g ?? {})) if (g[+r] != null) g[+r]! += cents(x);
        for (const [r, x] of Object.entries(d.v ?? {})) if (v[+r] != null) v[+r]! += cents(x);
      }
      continue;
    }
    if (s.date !== date) continue;
    n++;
    for (const gr of s.groups ?? []) {
      const r = num(gr.rate);
      if (g[r] == null) continue;
      g[r] += cents(num(gr.base) + num(gr.vat));
      if (r) v[r]! += cents(gr.vat);
    }
    for (const [r, x] of Object.entries(s.mk ?? {})) {
      mg += cents(x.g || 0);
      if (+r) mv[r] = (mv[r] || 0) + cents(x.v || 0);
    }
  }
  const G = { 0: fromCents(g[0]!), 5: fromCents(g[5]!), 10: fromCents(g[10]!), 18: fromCents(g[18]!) };
  const V = { 5: fromCents(v[5]!), 10: fromCents(v[10]!), 18: fromCents(v[18]!) };
  const MV: Record<string, number> = {};
  for (const [k, x] of Object.entries(mv)) MV[k] = fromCents(x);
  return {
    g: G,
    v: V,
    mg: fromCents(mg),
    mv: MV,
    n,
    tot: fromCents(g[0]! + g[5]! + g[10]! + g[18]!),
    vt: fromCents(v[5]! + v[10]! + v[18]!),
    mvt: fromCents((mv[5] || 0) + (mv[10] || 0) + (mv[18] || 0)),
  };
}

/** Legacy `kdfiRows()` (effective 11469): one КДФИ row per day that has a report in the period. */
export function kdfiRows(sales: readonly FiscalSales[], from: string, to: string, wh?: string): ({ date: string } & KdfiDay)[] {
  const ds = new Set<string>();
  for (const s of sales) {
    if (wh && whOf(s) !== wh) continue;
    if (Array.isArray(s.days) && s.days.length && s.days[0]!.g) {
      for (const d of s.days) if (d.date >= from && d.date <= to) ds.add(d.date);
      continue;
    }
    if (s.date >= from && s.date <= to) ds.add(s.date);
  }
  return [...ds].sort().map((d) => ({ date: d, ...kdfiDay(sales, d, wh) }));
}

export interface DfiDay {
  date: string;
  z: string;
  total: number;
  est: boolean;
  src: string;
  wh: string;
  /** POS / retail-output document (not a fiscal-device report). */
  pos?: boolean;
}

/** Legacy `dfiDays(wh,from,to)` (11475): fiscal report days in the period, sorted by date then Z number. */
export function dfiDays(sales: readonly FiscalSales[], wh: string | undefined, from: string, to: string): DfiDay[] {
  const out: DfiDay[] = [];
  for (const s of sales) {
    if (wh && whOf(s) !== wh) continue;
    if (Array.isArray(s.days) && s.days.length) {
      for (const d of s.days)
        if (d.date >= from && d.date <= to) out.push({ date: d.date, z: String(d.z || ''), total: num(d.total), est: !!d.est, src: s.id, wh: whOf(s) });
      continue;
    }
    if (s.date < from || s.date > to) continue;
    out.push({ date: s.date, z: String(s.fisk?.z || ''), total: num(s.total), est: false, src: s.id, wh: whOf(s), pos: /^z-|^mo-/.test(String(s.id)) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || String(a.z).localeCompare(String(b.z), 'mk', { numeric: true }));
}

export interface DfiLedgerLine {
  account: string;
  date: string;
  debit: number;
  credit: number;
}

export interface DfiOptions {
  /** Comma-separated weekdays without work (0 = Sunday). Default `'0'`. */
  offDays?: string;
  /** Cash-register maximum (благајнички максимум). */
  cashMax?: number | string;
  /** Days within which cash must be deposited. Default 3. */
  depDays?: number | string;
  /** Card receivable account. Default `posAccount`. */
  cardK?: string;
}

export interface DfiControlInput {
  sales: readonly FiscalSales[];
  wh?: string;
  from: string;
  to: string;
  /** "Today" (`YYYY-MM-DD`); days after it are not checked for missing reports. */
  today: string;
  opts?: DfiOptions;
  /** Ledger lines (all accounts; cash 102… and the card account are used). */
  ledger: readonly DfiLedgerLine[];
  /** Firm POS card account (legacy `posKDef()` = `firm.posK || '1200001'`). */
  posAccount?: string;
}

export type DfiSeverity = 'info' | 'warn' | 'bad';
export interface DfiFinding {
  sev: DfiSeverity;
  code: 'periodic' | 'missing' | 'zDuplicate' | 'zGap' | 'zOrder' | 'sameDay' | 'zero' | 'estimated' | 'cashMax' | 'cashUndeposited' | 'cardOpen';
  /** Legacy message (Macedonian; may contain `<b>`). */
  t: string;
}

/**
 * Legacy `dfiControl(wh,from,to)` (11479): checks of daily fiscal reports — missing working days (periodic reports
 * cover their range), duplicate / skipped / out-of-order Z numbers, several reports on a day, zero and estimated days,
 * cash above the register maximum, undeposited cash, open card receivables. Pure: ledger and today are inputs.
 */
export function dfiControl(input: DfiControlInput): { D: DfiDay[]; F: DfiFinding[]; miss: string[] } {
  const { sales, wh, from, to } = input;
  const O = input.opts ?? {};
  const off = new Set((O.offDays || '0').split(',').map((x) => +x));
  const D = dfiDays(sales, wh, from, to);
  const F: DfiFinding[] = [];
  const add = (sev: DfiSeverity, code: DfiFinding['code'], t: string) => F.push({ sev, code, t });

  /* 1. days without a report */
  const have = new Set(D.map((d) => d.date));
  const miss: string[] = [];
  const PRc = sales
    .filter((z) => z.fisk && z.fisk.from && z.fisk.to && z.fisk.from < z.fisk.to && !(z.days && z.days.length > 1) && (!wh || whOf(z) === wh))
    .map((z) => [z.fisk!.from!, z.fisk!.to!] as const);
  const end = to < input.today ? to : input.today;
  for (let ds = from; ds <= end; ds = addDaysIso(ds, 1)) {
    if (off.has(weekdayIso(ds))) continue;
    if (!have.has(ds) && !PRc.some((r) => ds >= r[0] && ds <= r[1])) miss.push(ds);
  }
  if (PRc.length)
    add(
      'info',
      'periodic',
      `Периодичен извештај без дневни износи: ${PRc.map((r) => dmy(r[0]) + ' – ' + dmy(r[1])).join(', ')} – деновите се покриени со вкупен промет; за МЕТГ/КДФИ по денови побарајте детален извештај по Z.`,
    );
  if (miss.length)
    add(
      D.length ? 'warn' : 'info',
      'missing',
      `${miss.length} работни денови без дневен финансиски извештај: ${miss.slice(0, 12).map(dmy).join(', ')}${miss.length > 12 ? ' …' : ''} (ако објектот не работел – во ред; ако работел – недостасува Z)`,
    );

  /* 2. Z numbers — in order, no gaps or duplicates */
  const Zs = D.filter((d) => /^\d+$/.test(d.z)).map((d) => ({ ...d, n: +d.z }));
  const seen: Record<number, string> = {};
  for (const d of Zs) {
    if (seen[d.n]) add('bad', 'zDuplicate', `Z бр. ${d.n} се појавува двапати (${dmy(seen[d.n])} и ${dmy(d.date)})`);
    seen[d.n] = d.date;
  }
  const S2 = [...Zs].sort((x, y) => x.n - y.n);
  for (let i = 1; i < S2.length; i++) {
    const a = S2[i - 1]!;
    const b = S2[i]!;
    const gap = b.n - a.n;
    if (gap > 1) add('bad', 'zGap', `Прескокнати Z броеви ${a.n + 1}${gap > 2 ? '–' + (b.n - 1) : ''} (меѓу ${dmy(a.date)} и ${dmy(b.date)})`);
    if (b.date < a.date) add('bad', 'zOrder', `Z бр. ${b.n} има постар датум од Z бр. ${a.n}`);
  }

  /* 3. several reports a day, zero turnover, estimated */
  const byD: Record<string, DfiDay[]> = {};
  for (const d of D) (byD[d.date] = byD[d.date] || []).push(d);
  for (const [dt, L] of Object.entries(byD)) if (L.filter((x) => !x.pos).length > 1) add('warn', 'sameDay', `${dmy(dt)}: ${L.length} дневни извештаи во ист ден`);
  const zero = D.filter((d) => !d.total && !d.est);
  if (zero.length) add('info', 'zero', `${zero.length} извештаи со нула промет (${zero.slice(0, 6).map((d) => dmy(d.date)).join(', ')})`);
  const est = D.filter((d) => d.est);
  if (est.length) add('warn', 'estimated', `${est.length} денови се <b>распределени</b> (проценка) – побарајте детален извештај по Z`);

  /* 4. cash in the register — bank deposits */
  const byDay: Record<string, number> = {};
  for (const l of input.ledger) if (String(l.account).startsWith('102')) byDay[l.date] = (byDay[l.date] || 0) + cents(l.debit) - cents(l.credit);
  let bal = 0;
  let since = '';
  const max = num(O.cashMax);
  let worst: { d: string; v: number } | null = null;
  for (const dt of Object.keys(byDay).sort()) {
    if (dt > to) break;
    bal = r2(bal + fromCents(byDay[dt]!));
    if (bal > 0.5 && !since) since = dt;
    if (bal <= 0.5) since = '';
    if (max && bal > max && dt >= from && (!worst || bal > worst.v)) worst = { d: dt, v: bal };
  }
  if (worst) add('warn', 'cashMax', `Готовината во благајна ${fmtMk(worst.v)} ден. на ${dmy(worst.d)} е над благајничкиот максимум ${fmtMk(max)} – пазарот не е уплатен навреме`);
  if (since && dayDiffIso(since, to) > (num(O.depDays) || 3))
    add('warn', 'cashUndeposited', `Готовина од ${dmy(since)} не е уплатена во банка (салдо 102.. ${fmtMk(bal)} ден.) – проверете ги изводите / полозите`);

  /* 5. card receivables */
  const cardK = O.cardK || input.posAccount || '1200001';
  const c = fromCents(input.ledger.filter((l) => String(l.account) === String(cardK) && l.date <= to).reduce((s, l) => s + cents(l.debit) - cents(l.credit), 0));
  if (c > 1) add('info', 'cardOpen', `Плаќања со картичка ${fmtMk(c)} ден. (конто ${cardK}) сè уште не се затворени со прилив од банката`);
  return { D, F, miss };
}
