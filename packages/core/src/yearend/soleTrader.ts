/**
 * Sole trader / self-employed (ТП, самостојна дејност): Образец Б and ДЛД-ДБ (legacy `DLD_ND` 10496, `tpData` 10497).
 *
 * Fix T1: legacy took income as −Σ class 7 and expenses as Σ class 4. Cost of goods sold (70x/71x) is a class-7
 * DEBIT, so it was netted into income, while the expense table listed it again and "Останати расходи"
 * (= expenses − 70/71 − …) went negative by the same amount. Income is now class 7 without 70/71 and expenses are
 * class 4 plus 70/71; the result (and so the tax) is unchanged.
 */
import { r2 } from '../money';
import misc from '../data/yearend-misc.json';
import { yeSumPref, type YeBalances } from './balances';

/** Non-deductible expense categories of ДЛД-ДБ `[key, label]`. */
export const DLD_ND: readonly (readonly [string, string])[] = misc.dldNd as [string, string][];
export const DLD_RATE = 0.1;

export type DldAdj = Partial<Record<string, number | string>>;

export interface TpResult {
  A: DldAdj;
  inc: number;
  exp: number;
  res: number;
  ND: { k: string; n: string; v: number }[];
  nd: number;
  base: number;
  red: number;
  b2: number;
  tax: number;
  ak: number;
  diff: number;
  /** income lines of Образец Б */
  I: [string, number][];
  /** expense lines of Образец Б */
  E: [string, number][];
}

export function tpCompute(B: YeBalances, adj: DldAdj | null | undefined, opt: { legacy?: boolean } = {}): TpResult {
  const A = adj ?? {};
  const G = (p: string[], s = 1) => r2(yeSumPref(B, p, s));
  const cogs = opt.legacy ? 0 : G(['70', '71']);
  const inc = r2(yeSumPref(B, ['7'], -1) + cogs);
  const exp = r2(yeSumPref(B, ['4'], 1) + cogs);
  const res = r2(inc - exp);
  const ND = DLD_ND.map(([k, n]) => ({ k, n, v: +(A[k] ?? 0) || 0 }));
  const nd = r2(ND.reduce((s, x) => s + x.v, 0));
  const base = r2(Math.max(0, res + nd));
  const red = +(A.red ?? 0) || 0;
  const b2 = r2(Math.max(0, base - red));
  const tax = r2(b2 * DLD_RATE);
  const ak = +(A.ak ?? 0) || 0;
  const sales = G(['74', '73'], -1);
  return {
    A,
    inc,
    exp,
    res,
    ND,
    nd,
    base,
    red,
    b2,
    tax,
    ak,
    diff: r2(tax - ak),
    I: [
      ['Приходи од продажба на производи, стоки и услуги', sales],
      ['Останати приходи', r2(inc - sales)],
    ],
    E: [
      ['Набавна вредност на продадени стоки', G(['70', '71'])],
      ['Материјали и енергија', G(['40'])],
      ['Услуги', G(['41'])],
      ['Амортизација', G(['43'])],
      ['Плати и надоместоци', G(['42'])],
      ['Останати расходи', r2(exp - G(['70', '71', '40', '41', '43', '42']))],
    ],
  };
}
