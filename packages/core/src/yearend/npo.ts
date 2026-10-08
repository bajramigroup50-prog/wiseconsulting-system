/**
 * Non-profit organisations (Сл. весник 117/05): balance sheet and income/expense statement, tax on economic
 * activity, close journal. Legacy `NPO_*` 10412–10449, `npoMode` 10450, `npoCompute` 10451, `npoDb` 10460,
 * `npoClose` 10486.
 */
import { r2 } from '../money';
import npoData from '../data/yearend-npo.json';
import { yeSumPref, type YeBalances, type YeLine } from './balances';
import { NPO_RESULT_ACCOUNTS, YEAR_RESULT_ACCOUNTS } from './close';

/** Header `[id, '', title]` or data `[id, aop, name, konta, sign, formula]`. */
export type NpoRow = readonly [string, string, string] | readonly [string, string, string, string, number, string];
export const NPO_ACC: readonly (readonly [string, string])[] = npoData.accounts as [string, string][];
export const NPO_SCH: Readonly<Record<string, string>> = npoData.scheme;
export const NPO_BS: readonly NpoRow[] = npoData.bs as unknown as NpoRow[];
export const NPO_PR: readonly NpoRow[] = npoData.pr as unknown as NpoRow[];
/** Company chart → NPO AOP map, used when an NPO keeps books on the company chart (`co` mode). */
export const NPO_CO: Readonly<Record<string, string>> = npoData.companyMap;

/** Tax-free threshold of economic activity for NPOs (denars) and the rate on the excess. */
export const NPO_TAX_FREE = 1_000_000;
export const NPO_TAX_RATE = 0.01;

export type NpoChart = 'npo' | 'co';
/**
 * Which chart the NPO books on (legacy `npoMode`: `'npo'` when the firm chart contains 730 "Приходи од членарини").
 * Whether the firm IS an NPO is decided by the entity type, not by this.
 */
export const npoChart = (accounts: Readonly<Record<string, unknown>> | null | undefined): NpoChart => (accounts && accounts['730'] ? 'npo' : 'co');

export interface NpoDb {
  r01: number;
  econ: number;
  red: number;
  base: number;
  tax: number;
}
/** Legacy `npoDb`: 1% on economic-activity income above 1 000 000. */
export function npoDb(econ: number): NpoDb {
  const b = r2(Math.max(0, econ - NPO_TAX_FREE));
  return { r01: 0, econ: r2(econ), red: r2(Math.min(econ, NPO_TAX_FREE)), base: b, tax: r2(b * NPO_TAX_RATE) };
}

export interface NpoInput {
  pre: YeBalances;
  all: YeBalances;
  /** year closed (a close journal exists) */
  closed: boolean;
  chart: NpoChart;
  /** tax booked by the close (when closed) */
  closeTax?: number;
}
export interface NpoResult {
  V: Record<string, number>;
  inc: number;
  exp: number;
  sur: number;
  tax: number;
  econ: number;
  dbnp: NpoDb;
  closed: boolean;
  /** balances on accounts the forms do not map */
  un: { k: string; s: number }[];
}

/** Legacy `npoCompute(year)`. */
export function npoCompute({ pre: B, all: BA, closed: cl, chart: MO, closeTax }: NpoInput): NpoResult {
  const inc = -yeSumPref(B, ['7'], 1);
  const exp = yeSumPref(B, ['4'], 1);
  const sur = r2(inc - exp);
  const econ =
    MO === 'co'
      ? yeSumPref(B, ['73', '740', '741', '742', '743', '744', '748', '749', '710', '715', '747'], -1)
      : yeSumPref(B, ['710', '715', '740', '750'], -1);
  const dbnp = npoDb(econ);
  // the close nets 810 to zero, so a closed year takes the tax the close booked when the caller knows it
  const tax = cl ? (closeTax ?? r2(yeSumPref(BA, ['810', '811'], 1))) : dbnp.tax;
  const V: Record<string, number> = {};
  const run = (R: readonly NpoRow[], BB: YeBalances) => {
    for (let p = 0; p < 3; p++)
      for (const row of R) {
        if (row.length === 3) continue;
        const [id, , , k0, s, f] = row;
        const k = MO === 'co' ? (f && !/^\+/.test(f) ? '' : NPO_CO[id] || '') : k0;
        let v = k ? yeSumPref(BB, String(k).split(',').filter(Boolean), +s || 1) : 0;
        const F = String(f || '');
        if (F === '+SUR') {
          if (!cl) v = r2(v + Math.max(0, sur - tax));
        } else if (F === '+DEF') {
          if (!cl) v = r2(v + Math.max(0, -sur));
        } else if (F === 'SURG') v = Math.max(0, sur);
        else if (F === 'DEFG') v = Math.max(0, -sur);
        else if (F === 'TAX') v = sur > 0 ? Math.min(tax, sur) : 0;
        else if (F) {
          let t = 0;
          for (const m of F.matchAll(/([+-]?)\s*(\d+i?)/g)) t += (m[1] === '-' ? -1 : 1) * (V[m[2]!] || 0);
          v = r2(t);
        }
        V[id] = r2(v);
      }
  };
  run(NPO_PR, B);
  run(NPO_BS, cl ? BA : B);
  if (!cl && tax > 0 && sur > 0) {
    V['054'] = r2((V['054'] ?? 0) + tax);
    V['051'] = r2((V['051'] ?? 0) + tax);
    V['069'] = r2((V['069'] ?? 0) + tax);
  }
  const known =
    MO === 'co'
      ? ['0', '1', '2', '30', '31', '32', '35', '60', '63', '65', '66', '67', '4', '70', '7', '8', '90', '91', '93', '94', '95', '96', '99']
      : ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '15', '16', '17', '19', '21', '22', '24', '25', '26', '27', '28', '29', '31', '32', '36', '60', '63', '66', '4', '7', '8', '90', '91', '94', '95', '97', '98', '99'];
  const un = Object.entries(cl ? BA : B)
    .filter(([k, v]) => Math.abs(v.s) > 0.004 && !known.some((p) => k.startsWith(p)))
    .map(([k, v]) => ({ k, s: v.s }));
  return { V, inc, exp, sur, tax, econ, dbnp, closed: cl, un };
}

/**
 * NPO close journal (legacy `npoClose`): classes 4/7 → 800, tax 800→810→payable, surplus/deficit.
 * In `co` mode the payable/result accounts follow the company mapping (2330 / 951 / 961).
 * Fix: the result carries `net` (legacy omitted it, so screens printed `undefined`).
 */
export function npoCloseLines(pre: YeBalances, C: Pick<NpoResult, 'sur' | 'tax'>, chart: NpoChart): { lines: YeLine[]; profit: number; tax: number; net: number } {
  const lines: YeLine[] = [];
  const L = (account: string, debit: number, credit: number) => lines.push({ account, debit, credit });
  // FIX(P8 #3): on the company chart the close uses the company closing accounts 8000/8100 (legacy always used the
  // NPO-chart 800/810); NPOs on the NPO chart keep 800/810.
  const A: Record<keyof typeof NPO_RESULT_ACCOUNTS, string> = chart === 'co'
    ? { ...NPO_RESULT_ACCOUNTS, preTax: YEAR_RESULT_ACCOUNTS.preTax, taxExpense: YEAR_RESULT_ACCOUNTS.taxExpense }
    : NPO_RESULT_ACCOUNTS;
  for (const [k, v] of Object.entries(pre)) {
    if (!/^[47]/.test(k) || Math.abs(v.s) < 0.005) continue;
    if (v.s > 0) {
      L(k, 0, v.s);
      L(A.preTax, v.s, 0);
    } else {
      L(k, -v.s, 0);
      L(A.preTax, 0, -v.s);
    }
  }
  const co = chart === 'co';
  const K = {
    taxL: co ? YEAR_RESULT_ACCOUNTS.taxPayable : A.taxPayable,
    sur: co ? YEAR_RESULT_ACCOUNTS.currentProfit : A.surplus,
    def: co ? YEAR_RESULT_ACCOUNTS.currentLoss : A.deficit,
  };
  let net = 0;
  if (C.sur > 0) {
    if (C.tax) {
      L(A.preTax, C.tax, 0);
      L(A.taxExpense, 0, C.tax);
      L(A.taxExpense, C.tax, 0);
      L(K.taxL, 0, C.tax);
    }
    net = r2(C.sur - C.tax);
    if (net) {
      L(A.preTax, net, 0);
      L(K.sur, 0, net);
    }
  } else if (C.sur < 0) {
    net = C.sur;
    L(K.def, -C.sur, 0);
    L(A.preTax, 0, -C.sur);
  }
  const M: Record<string, YeLine> = {};
  for (const l of lines) {
    const key = l.account + '|' + (l.debit ? 'd' : 'p');
    const m = (M[key] ??= { account: l.account, debit: 0, credit: 0 });
    m.debit = r2(m.debit + l.debit);
    m.credit = r2(m.credit + l.credit);
  }
  return { lines: Object.values(M).filter((l) => l.debit || l.credit), profit: C.sur, tax: C.tax, net };
}
