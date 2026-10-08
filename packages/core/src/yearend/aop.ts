/**
 * AOP engine for the ЦРМ annual account (Биланс на состојба `bs` 001–112, Биланс на успех `bu` 201–293).
 *
 * Ported from the final effective `zsCompute` chain in legacy/index.html:
 *   7620 (base) → 10940 (manual `zsMan` amounts) → 17099 ("АОП без дени": integer rounding + A/P balancing).
 * Rules: `ZS_DEF` 7411–7617, `ZS_FIX` 7618, `zsRules` 7619. Simple statements (`POS_BS`/`POS_IS`/`statements`)
 * 3626–3664 are only needed for the `+PROFIT` token.
 *
 * Deliberate fixes (see YEAREND.md in this folder; pass `{ legacy: true }` to reproduce the old behaviour):
 *  - F1 tax before close: legacy sets bu252 = 0 until the year is closed, so bu255 shows pre-tax profit and the
 *       balance sheet carries the gross profit. Now bu252 = `provisionalTax` (default: ДБ AOP 56 computed from the
 *       same statement) and the same amount is added to bs101 "Тековни даночни обврски", so A = P still holds.
 *  - F2 manual amounts: the legacy rounding pass recomputed formula rows that had manual (`zsMan`) values and
 *       silently overwrote them. Manual keys are now never recomputed.
 *  - F3 bs077/bs078 (`+BU255`/`+BU256`) were rounded from the UNROUNDED bu255, so 077 could exceed 255 by one
 *       denar (ЦРМ rule 2024). Now they are rebuilt from the rounded bu values.
 */
import { r2 } from '../money';
import zsData from '../data/yearend-zs-def.json';
import miscData from '../data/yearend-misc.json';
import { yeSplitKonta, yeSumPref, type YeBalances } from './balances';

export type ZsReport = 'bu' | 'bs';
export interface ZsRule {
  r: ZsReport;
  aop: string;
  n: string;
  /** comma-separated account prefixes, `!` excludes */
  k: string;
  s: number;
  /** '' | "202+203" | "P:…" | "N:…" | TAX | +PROFIT | +BUnnn | INV0 | INV1 | EMP | MONTHS */
  f: string;
  custom?: boolean;
}

type ZsTuple = [string, string, string, string, number, string];
/** Default AOP rules (legacy `ZS_DEF`, 205 rows). */
export const ZS_DEF: readonly ZsRule[] = (zsData.rows as ZsTuple[]).map(([r, aop, n, k, s, f]) => ({ r: r as ZsReport, aop, n, k, s, f }));
/** Totals whose formula is forced unless the firm rule is marked `custom` (legacy `ZS_FIX`). */
export const ZS_FIX: Readonly<Record<string, string>> = zsData.fix;

/**
 * Effective rules for a firm (legacy `zsRules`): the firm's own rules with ZS_FIX applied, plus any ZS_DEF row the
 * firm list is missing. (Legacy cached the result on a non-enumerable `_fx` property of the firm array — dropped.)
 */
export function zsRules(firmRules?: readonly ZsRule[] | null): readonly ZsRule[] {
  if (!firmRules || !firmRules.length) return ZS_DEF;
  const out: ZsRule[] = firmRules.map((x) => {
    const fx = ZS_FIX[x.r + x.aop];
    return fx && String(x.f || '').replace(/\s/g, '') !== fx && !x.custom ? { ...x, f: fx } : x;
  });
  for (const d of ZS_DEF) if (!out.some((x) => x.r === d.r && x.aop === d.aop)) out.push(d);
  return out;
}

/* ---------------- simple statements (legacy POS_BS / POS_IS / statements) ---------------- */

type PosTuple = [string, string, string[] | null, number?];
export const POS_BS = miscData.posBs as PosTuple[];
export const POS_IS = miscData.posIs as PosTuple[];

export interface SimpleStatements {
  IS: { c: string; n: string; v: number }[];
  rev: number;
  exp: number;
  profit: number;
  tax: number;
  net: number;
  BS: { c: string; n: string; v?: number; head?: boolean }[];
  assets: number;
  liab: number;
  closed: boolean;
}

/** Legacy `statements()` (3652). `closeTax` = tax of the closing journal, `null` when the year is not closed. */
export function simpleStatements(pre: YeBalances, all: YeBalances, closeTax: number | null): SimpleStatements {
  const IS = POS_IS.map(([c, n, pr, sg]) => ({ c, n, v: yeSumPref(pre, pr ?? [], sg ?? 1) }));
  const rev = IS.filter((x) => x.c[0] === 'U').reduce((s, x) => s + x.v, 0);
  const exp = IS.filter((x) => x.c[0] === 'R').reduce((s, x) => s + x.v, 0);
  const profit = r2(rev - exp);
  const cl = closeTax != null;
  const tax = cl ? +closeTax || 0 : 0;
  const B = cl ? all : pre;
  const BS = POS_BS.map(([c, n, pr, sg]) => {
    if (!pr) return { c, n, head: true };
    let v = yeSumPref(B, pr, sg ?? 1);
    if (!cl && c === 'P1') v = r2(v + profit);
    return { c, n, v };
  });
  const assets = r2(BS.filter((x) => x.c[0] === 'A' && !x.head).reduce((s, x) => s + (x.v ?? 0), 0));
  const liab = r2(BS.filter((x) => x.c[0] === 'P' && !x.head).reduce((s, x) => s + (x.v ?? 0), 0));
  return { IS, rev: r2(rev), exp: r2(exp), profit, tax, net: r2(profit - tax), BS, assets, liab, closed: cl };
}

/* ---------------- zsCompute ---------------- */

/** One v2 payroll run of the year (only the totals the AOP engine needs; see payroll `payTotals`). */
export interface ZsPayrollRun {
  month: string;
  /** number of employees on the run */
  employees: number;
  /** personal income tax */
  tax: number;
  /** all contributions: pio+zdr+dop+vrab (+ the d* additional contributions) */
  contrib: number;
}

export interface ZsInput {
  year: number;
  pre: YeBalances;
  all: YeBalances;
  opening: YeBalances;
  /** the closing journal of the year, if the year is closed */
  close?: { tax: number } | null;
  rules?: readonly ZsRule[];
  /** manual amounts for this year (`firm.zsMan[year]`), keys like `bs001` */
  manual?: Readonly<Record<string, number | string>> | null;
  /** v2 payroll runs of the year (bu214–216 split and bu257) */
  payroll?: readonly ZsPayrollRun[];
  /** active employees, used for bu257 when there are no payroll runs */
  activeEmployees?: number;
  /** `firm.regDate || firm.founded` (YYYY-MM-DD) for bu258 */
  regDate?: string;
  /** first 'YYYY-MM' with a regular posting in the year (no opening, no imported TB) — bu258 when there is no regDate */
  firstPostingMonth?: string;
  /** an opening journal `open-<year>` exists */
  hasOpening?: boolean;
  /** an imported trial balance `bbimp-<year>` exists */
  hasImportedTb?: boolean;
  /** F1: tax shown in bu252 before the year is closed. Default: computed by the caller (see `zsComputeWithTax`). */
  provisionalTax?: number;
  /** reproduce the legacy behaviour exactly (golden tests) */
  legacy?: boolean;
}

export interface ZsResult {
  V: Record<string, number>;
  closed: boolean;
  /** profit of the simple statements (legacy `st.profit`) */
  profit: number;
  manual?: boolean;
  rounded?: { aop: string; d: number };
  /** F1: provisional tax that was put in bu252 / bs101 (only when not closed) */
  provisionalTax?: number;
}

const isFormulaOnly = (x: ZsRule) => {
  const f = String(x.f || '').trim().replace(/^[PN]:/, '');
  return !!f && /^[\d+\-\s]+$/.test(f);
};

/** Evaluate an AOP formula ("P:201-204+205"). `round` = apply r2 to the sum before the P/N part (legacy base engine). */
const evalFormula = (f0: string, get: (n: string) => number, round: boolean): number => {
  let f = f0;
  let mode = '';
  if (/^[PN]:/.test(f)) {
    mode = f[0]!;
    f = f.slice(2);
  }
  let t = 0;
  for (const m of f.matchAll(/([+-]?)\s*(\d+)/g)) t += (m[1] === '-' ? -1 : 1) * get(m[2]!);
  if (round) t = r2(t);
  return mode === 'P' ? Math.max(0, t) : mode === 'N' ? Math.max(0, -t) : t;
};

function monthsWorked(inp: ZsInput): number {
  const year = String(inp.year);
  const rd = String(inp.regDate || '');
  let st = 1;
  if (rd.slice(0, 4) === year) st = +rd.slice(5, 7) || 1;
  else if (rd && rd.slice(0, 4) > year) st = 13;
  else if (!rd) {
    const fm = inp.firstPostingMonth;
    if (fm && fm.startsWith(year) && !inp.hasImportedTb && !inp.hasOpening) st = +fm.slice(5, 7) || 1;
  }
  return Math.max(0, Math.min(12, 13 - st));
}

/** Base engine (legacy 7620). */
function zsBase(inp: ZsInput, R: readonly ZsRule[], profit: number, kontaPart: Record<string, number>): Record<string, number> {
  const cl = !!inp.close;
  const V: Record<string, number> = {};
  const P = inp.payroll ?? [];
  for (let pass = 0; pass < 4; pass++)
    for (const x of R) {
      const B = x.r === 'bs' && cl ? inp.all : inp.pre;
      let v = 0;
      if (x.k) v = yeSumPref(B, yeSplitKonta(x.k), +x.s || 1);
      if (x.r === 'bu' && ['214', '215', '216'].includes(x.aop) && !x.custom) {
        const split = yeSumPref(B, ['4201', '4202', '4211', '4212'], 1);
        if (!split && P.length) {
          const tax = r2(P.reduce((s, p) => s + (+p.tax || 0), 0));
          const con = r2(P.reduce((s, p) => s + (+p.contrib || 0), 0));
          if (x.aop === '215') v = tax;
          else if (x.aop === '216') v = con;
          else v = r2(v - tax - con);
        }
      }
      let f = String(x.f || '').trim();
      if (f === 'TAX') v = cl ? +inp.close!.tax || 0 : inp.legacy ? 0 : +(inp.provisionalTax ?? 0) || 0;
      else if (f === '+PROFIT') {
        if (!cl) v = r2(v + profit);
      } else if (/^\+BU\d+$/.test(f)) {
        kontaPart[x.r + x.aop] = v;
        if (!cl) v = r2(v + (V['bu' + f.slice(3)] || 0));
      } else if (f === 'INV0') v = yeSumPref(inp.opening, ['60', '63'], 1);
      else if (f === 'INV1') v = yeSumPref(inp.pre, ['60', '63'], 1);
      else if (f === 'EMP') {
        v = P.length ? Math.round(P.reduce((a, p) => a + (+p.employees || 0), 0) / P.length) : +(inp.activeEmployees ?? 0) || 0;
      } else if (f === 'MONTHS') v = monthsWorked(inp);
      else if (f) v = evalFormula(f, (n) => V[x.r + n] || 0, true);
      V[x.r + x.aop] = r2(v);
    }
  return V;
}

/**
 * Compute every AOP of the balance sheet and income statement (final legacy `zsCompute` chain).
 * Values are integers ("АОП без дени") unless there are more than 20 manual amounts (an imported ЦРМ XML).
 */
export function zsCompute(inp: ZsInput): ZsResult {
  const R = inp.rules ?? ZS_DEF;
  const cl = !!inp.close;
  const legacy = !!inp.legacy;
  const st = simpleStatements(inp.pre, inp.all, cl ? +inp.close!.tax || 0 : null);
  const kontaPart: Record<string, number> = {};
  const V = zsBase(inp, R, st.profit, kontaPart);
  const r: ZsResult = { V, closed: cl, profit: st.profit };

  // F1: provisional tax goes to current tax liabilities so the balance sheet still balances
  const ptax = !cl && !legacy ? +(inp.provisionalTax ?? 0) || 0 : 0;
  if (ptax) {
    r.provisionalTax = ptax;
    V.bs101 = r2((V.bs101 || 0) + ptax);
    // re-run the formula rows that depend on bs101 (bs095/081/111); bs101 itself is a konta row
    recalcFormulas(R, V, new Set(), 4, false);
  }

  // ---- manual amounts (legacy 10940) ----
  const M = inp.manual;
  const manualKeys = new Set<string>();
  if (M && Object.keys(M).length) {
    for (const [k, v] of Object.entries(M))
      if (/^(bs|bu)\d{3}$/.test(k)) {
        V[k] = +v || 0;
        manualKeys.add(k);
      }
    for (let pass = 0; pass < 4; pass++)
      for (const x of R) {
        const key = x.r + x.aop;
        if (M[key] != null) continue;
        const f = String(x.f || '').trim();
        if (!f || /[A-Z]{2,}/.test(f.replace(/^[PN]:/, ''))) continue;
        if (!/^[\d+\-\s]+$/.test(f.replace(/^[PN]:/, ''))) continue;
        V[key] = evalFormula(f, (n) => V[x.r + n] || 0, true);
      }
    r.manual = true;
  }

  // ---- rounding to whole denars + A/P balancing (legacy 17099) ----
  if (M && Object.keys(M).length > 20) return r;
  for (const x of R) {
    const k = x.r + x.aop;
    if (!isFormulaOnly(x) && V[k] != null) V[k] = Math.round(+V[k] || 0);
  }
  const skip = legacy ? new Set<string>() : manualKeys; // F2
  const calc = () => recalcFormulas(R, V, skip, 5, true);
  calc();
  const buLinked = new Set<string>();
  if (!legacy) {
    // F3: +BUnnn rows (bs077/bs078) from the ROUNDED bu values. Open year: rounded konta part + rounded bu.
    // Closed year: the 951/961 balance is the unrounded net result, so a ±1 rounding gap to bu255/256 is closed.
    let changed = false;
    for (const x of R) {
      const f = String(x.f || '').trim();
      const k = x.r + x.aop;
      if (!/^\+BU\d+$/.test(f) || manualKeys.has(k)) continue;
      buLinked.add(k);
      const bu = V['bu' + f.slice(3)] || 0;
      let v = V[k] ?? 0;
      if (!cl && kontaPart[k] != null) v = Math.round(kontaPart[k]!) + bu;
      else if (cl && Math.abs(v - bu) <= 1) v = bu;
      if (v !== V[k]) {
        V[k] = v;
        changed = true;
      }
    }
    if (changed) calc();
  }
  const d = (V.bs063 || 0) - (V.bs111 || 0);
  if (d && Math.abs(d) <= 3) {
    // F3: never put the rounding difference on bs077/bs078 (would break ЦРМ rules 2022/2024) or on a manual amount
    const L = R.filter(
      (x) => x.r === 'bs' && !isFormulaOnly(x) && +x.aop >= 65 && +x.aop <= 111 && (V['bs' + x.aop] || 0) > 0 && (legacy || (!manualKeys.has('bs' + x.aop) && !buLinked.has('bs' + x.aop))),
    ).sort(
      (a, b) => (V['bs' + b.aop] || 0) - (V['bs' + a.aop] || 0),
    );
    const top = L[0];
    if (top) {
      V['bs' + top.aop] = (V['bs' + top.aop] || 0) + d;
      calc();
      r.rounded = { aop: top.aop, d };
    }
  }
  return r;
}

/**
 * Recompute the pure-formula rows (`202+203`, `P:…`), skipping `skip` keys.
 * `integer` = the legacy rounding pass (17101: no r2, AOP numbers padded to 3 digits); otherwise the base-engine
 * semantics (r2 of the sum).
 */
function recalcFormulas(R: readonly ZsRule[], V: Record<string, number>, skip: Set<string>, passes: number, integer: boolean) {
  for (let pass = 0; pass < passes; pass++)
    for (const x of R) {
      if (!isFormulaOnly(x)) continue;
      const key = x.r + x.aop;
      if (skip.has(key)) continue;
      V[key] = integer
        ? evalFormula(String(x.f).trim(), (n) => V[x.r + n.padStart(3, '0')] ?? V[x.r + n] ?? 0, false)
        : evalFormula(String(x.f).trim(), (n) => V[x.r + n] || 0, true);
    }
}

/** Legacy `zsV(rep, aop, C)`. */
export const zsV = (rep: ZsReport, aop: string, C: Pick<ZsResult, 'V'>): number => C.V[rep + aop] || 0;
