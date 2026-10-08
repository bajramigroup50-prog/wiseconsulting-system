/**
 * Trial balance imported AFTER the year was closed (legacy `obRebuild` 17158 + the `obAi`/`saveOpen`/`bbImpDel`
 * wrappers 17171–17176).
 *
 * A post-close trial balance has classes 4 and 7 at zero (only their turnover is left) and the result already on
 * 951/961 and 2330. To get the income statement back, the revenue/expense balances are rebuilt from the turnover and a
 * separate closing journal (`close-<Y>`, imported) reverses them, so `bbimp` + close = the imported balances.
 *
 * FIX(P8 #3): legacy put the balancing "Резултат (пред затворање)" row and its close line on 800 (the NPO-chart
 * account); the company chart closes on 8000 (YEAR_RESULT_ACCOUNTS.preTax), like `closeYearLines`.
 */
import { r2 } from '../money';
import { YEAR_RESULT_ACCOUNTS } from './close';
import type { YeLine } from './balances';

export interface ObRebuildRow {
  account: string;
  name?: string;
  partnerId?: string | null;
  /** closing balance */
  debit: number;
  credit: number;
  /** turnover of the year */
  turnoverDebit?: number;
  turnoverCredit?: number;
}

export interface ObRebuildResult {
  /** rows for the imported trial balance (`bbimp-<Y>`), pre-close */
  rows: ObRebuildRow[];
  close: { lines: YeLine[]; profit: number; tax: number; net: number; n: number; rev: number; exp: number; ok: boolean };
}

/** Returns null when no closed revenue/expense account was found (the trial balance is not post-close). */
export function obRebuild(rows: readonly ObRebuildRow[]): ObRebuildResult | null {
  const by: Record<string, ObRebuildRow[]> = {};
  for (const r of rows) (by[r.account] ??= []).push(r);
  const pre: ObRebuildRow[] = [];
  const cl: YeLine[] = [];
  let rev = 0;
  let exp = 0;
  let tax = 0;
  let n = 0;
  const keep = new Set<ObRebuildRow>();
  for (const [k, L] of Object.entries(by)) {
    if (!/^[478]/.test(k)) continue;
    const net = r2(L.reduce((s, r) => s + (+r.debit || 0) - (+r.credit || 0), 0));
    const tD = r2(L.reduce((s, r) => s + (+(r.turnoverDebit ?? 0) || 0), 0));
    const tP = r2(L.reduce((s, r) => s + (+(r.turnoverCredit ?? 0) || 0), 0));
    if (/^81/.test(k)) tax = r2(tax + tD);
    if (Math.abs(net) >= 0.5 || (!tD && !tP)) continue;
    for (const r of L) keep.add(r);
    if (/^(8|49|79)/.test(k)) continue;
    n++;
    for (const r of L) {
      const d = +r.debit || 0;
      const p = +r.credit || 0;
      if ((d || p) && r.partnerId) {
        pre.push({ account: k, name: r.name, partnerId: r.partnerId, debit: d, credit: p });
        if (k[0] === '7') rev = r2(rev + p - d);
        else exp = r2(exp + d - p);
      } else if (d || p) cl.push({ account: k, debit: r2(d), credit: r2(p) });
      else {
        const a = k[0] === '7' ? +(r.turnoverCredit ?? 0) || 0 : +(r.turnoverDebit ?? 0) || 0;
        if (!a) continue;
        if (k[0] === '7') {
          pre.push({ account: k, name: r.name, partnerId: r.partnerId, debit: 0, credit: a });
          cl.push({ account: k, debit: a, credit: 0 });
          rev = r2(rev + a);
        } else {
          pre.push({ account: k, name: r.name, partnerId: r.partnerId, debit: a, credit: 0 });
          cl.push({ account: k, debit: 0, credit: a });
          exp = r2(exp + a);
        }
      }
    }
  }
  if (!n) return null;
  const out: ObRebuildRow[] = rows
    .filter((r) => !keep.has(r))
    .map((r): ObRebuildRow => ({ account: r.account, name: r.name, partnerId: r.partnerId, debit: +r.debit || 0, credit: +r.credit || 0 }))
    .concat(pre);
  const D = r2(out.reduce((s, r) => s + (+r.debit || 0), 0));
  const P = r2(out.reduce((s, r) => s + (+r.credit || 0), 0));
  const bal = r2(D - P);
  const K = YEAR_RESULT_ACCOUNTS.preTax;
  if (Math.abs(bal) >= 0.01) {
    out.push({ account: K, name: 'Резултат (пред затворање)', debit: bal < 0 ? -bal : 0, credit: bal > 0 ? bal : 0 });
    cl.push({ account: K, debit: bal > 0 ? bal : 0, credit: bal < 0 ? -bal : 0 });
  }
  const cD = r2(cl.reduce((s, l) => s + l.debit, 0));
  const cP = r2(cl.reduce((s, l) => s + l.credit, 0));
  return { rows: out, close: { lines: cl, profit: r2(rev - exp), tax, net: r2(rev - exp - tax), n, rev, exp, ok: Math.abs(cD - cP) < 0.01 } };
}

const amt = (v: unknown): number => {
  let s = String(v ?? '').trim().replace(/\s/g, '');
  if (!s) return 0;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  return +s || 0;
};

/**
 * Rows of a pasted / CSV trial balance with turnover, columns:
 * `конто; назив; промет должи; промет побарува; салдо должи; салдо побарува`. Header and total rows are skipped
 * (only rows whose first cell is an account code are kept).
 */
export function parseTurnoverTb(grid: readonly (readonly unknown[])[]): ObRebuildRow[] {
  const out: ObRebuildRow[] = [];
  for (const r of grid) {
    const k = String(r[0] ?? '').trim();
    if (!/^\d{2,10}$/.test(k)) continue;
    const [td, tp, d, p] = [amt(r[2]), amt(r[3]), amt(r[4]), amt(r[5])];
    if (!td && !tp && !d && !p) continue;
    out.push({ account: k, name: String(r[1] ?? '').trim(), debit: r2(d), credit: r2(p), turnoverDebit: r2(td), turnoverCredit: r2(tp) });
  }
  return out;
}
