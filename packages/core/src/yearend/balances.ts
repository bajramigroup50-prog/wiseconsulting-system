/**
 * Account balances for the year-end engine.
 *
 * Legacy builds balances from the computed ledger (`balances(ledger(...))`, legacy 3600) and sums them by
 * account prefix with `sumPref` (3601). The rebuild feeds the engine a trial balance instead.
 */
import { r2 } from '../money';

/** One trial-balance row. `debit`/`credit` are the year's turnover WITHOUT the opening balance and WITHOUT the closing journal. */
export interface YeTrialBalanceRow {
  account: string;
  debit: number;
  credit: number;
  openingDebit?: number;
  openingCredit?: number;
}

/** A plain journal line (account, debit, credit). */
export interface YeLine {
  account: string;
  debit: number;
  credit: number;
  partner?: string;
}

export interface YeBalance {
  d: number;
  p: number;
  /** d - p */
  s: number;
}
export type YeBalances = Record<string, YeBalance>;

const finish = (by: Record<string, { d: number; p: number }>): YeBalances => {
  const out: YeBalances = {};
  for (const [k, v] of Object.entries(by)) {
    const d = r2(v.d);
    const p = r2(v.p);
    out[k] = { d, p, s: r2(d - p) };
  }
  return out;
};

const add = (by: Record<string, { d: number; p: number }>, k: string, d: number, p: number) => {
  const b = (by[k] ??= { d: 0, p: 0 });
  b.d += +d || 0;
  b.p += +p || 0;
};

/** Legacy `balances(L)` over a list of lines. */
export function yeBalancesFromLines(lines: readonly YeLine[]): YeBalances {
  const by: Record<string, { d: number; p: number }> = {};
  for (const l of lines) add(by, String(l.account), l.debit, l.credit);
  return finish(by);
}

export interface YeBalanceSet {
  /** opening + turnover, without the closing journal (legacy `ledger({excl:['close']})`) */
  pre: YeBalances;
  /** pre + closing journal (legacy `ledger()`) */
  all: YeBalances;
  /** opening balance only (legacy `ledger(...).filter(l=>l.kind==='open')`) */
  opening: YeBalances;
}

/** Build the three balance views the engine needs from a trial balance and an optional closing journal. */
export function yeBalanceSet(tb: readonly YeTrialBalanceRow[], closeLines: readonly YeLine[] = []): YeBalanceSet {
  const pre: Record<string, { d: number; p: number }> = {};
  const all: Record<string, { d: number; p: number }> = {};
  const opening: Record<string, { d: number; p: number }> = {};
  for (const r of tb) {
    const k = String(r.account);
    const od = +(r.openingDebit ?? 0) || 0;
    const op = +(r.openingCredit ?? 0) || 0;
    if (od || op) add(opening, k, od, op);
    add(pre, k, od + (+r.debit || 0), op + (+r.credit || 0));
    add(all, k, od + (+r.debit || 0), op + (+r.credit || 0));
  }
  for (const l of closeLines) add(all, String(l.account), l.debit, l.credit);
  return { pre: finish(pre), all: finish(all), opening: finish(opening) };
}

/**
 * Legacy `sumPref(B, prefs, sign)`: sum of `s * sign` over accounts that start with any included prefix and with no
 * `!`-excluded prefix.
 */
export function yeSumPref(B: YeBalances, prefs: readonly string[], sign = 1): number {
  const inc = prefs.filter((p) => p[0] !== '!');
  const exc = prefs.filter((p) => p[0] === '!').map((p) => p.slice(1));
  let t = 0;
  for (const [k, v] of Object.entries(B)) {
    if (inc.some((p) => k.startsWith(p)) && !exc.some((p) => k.startsWith(p))) t += v.s * sign;
  }
  return r2(t);
}

/** Split a legacy konta list ("73,74,!745") into prefixes. */
export const yeSplitKonta = (k: string): string[] => String(k).split(/[,; ]+/).filter(Boolean);
