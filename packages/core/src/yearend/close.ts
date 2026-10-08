/**
 * Closing the year and carrying the result forward — one consistent account mapping.
 *
 * Legacy `closeYear` 6732, `openYear` 6744, `obResK`/`obResLines` 12386–12389, NPO close 10486–10490.
 *
 * Legacy was inconsistent (LEGACY-MAP Phase 8 §8.4 items 1–3, 16):
 *  - `closeYear` posted the net result to 951/961, `openYear` remapped it to 950/960 — but only when the UI flag
 *    `S.obFull` was off; the "Пренос" help text said 9500/9600 and the "Терки" help text said tax goes to 2340.
 *  - NPO close and `obRebuild` used 800/810 instead of 8000/8100, and the NPO close journal had no `net`.
 *
 * The rebuild uses ONE mapping that matches KONTO_SRC:
 *   8000 "Добивка пред оданочување" ← every class 4 / class 7 balance
 *   8100 "Данок на добивка"          → 2330 "Обврски за данок на добивка" (2340 is PERSONAL income tax on salaries)
 *   8200 "Нето добивка за периодот"
 *   951  "Добивка од тековната година" / 961 "Загуба за тековната година"      — the year's result after close
 *   950  "Задржана (акумулирана) добивка од претходни години" / 960 "Пренесена загуба од претходни години" — after carry-forward
 * 9500/9600 are firm-specific analytic sub-accounts ("…2018"), not the target. ZS_DEF already reads exactly this
 * mapping: bs075 ← 950, bs076 ← 960, bs077 ← 951, bs078 ← 961. The carry-forward remap is unconditional.
 * NPO firms on the NPO chart keep their own statutory accounts (800/810/245/970/092 — Сл. весник 117/05).
 */
import { r2 } from '../money';
import type { YeBalances, YeLine } from './balances';

export const YEAR_RESULT_ACCOUNTS = {
  /** result before tax (closing account for classes 4 and 7) */
  preTax: '8000',
  /** profit tax expense */
  taxExpense: '8100',
  /** net result of the period */
  net: '8200',
  /** profit tax payable */
  taxPayable: '2330',
  /** current-year profit / loss, posted by the year close */
  currentProfit: '951',
  currentLoss: '961',
  /** retained earnings / accumulated loss, the opening balance of the next year */
  retainedProfit: '950',
  retainedLoss: '960',
} as const;

/** NPO chart (Сл. весник 117/05) closing accounts. */
export const NPO_RESULT_ACCOUNTS = {
  preTax: '800',
  taxExpense: '810',
  taxPayable: '245',
  surplus: '970',
  deficit: '092',
} as const;

export interface CloseYearResult {
  lines: YeLine[];
  /** result before tax (legacy `profit`) */
  profit: number;
  tax: number;
  net: number;
}

/**
 * Closing journal `close-<year>` (legacy `closeYear` 6732). Balances are the year WITHOUT an earlier close.
 * `tax` is the profit tax to book — use `computeDb(...).tax` (ДБ AOP 56, whole denars). Legacy used ДБ only when
 * `dbAdj[year]` had entries and otherwise `r2(max(0, profit + nd) * 10%)`; the rebuild always takes the ДБ value
 * so the close, bu252 and the ДБ return can never disagree (LEGACY-MAP §8.4 item 8).
 */
export function closeYearLines(pre: YeBalances, tax: number): CloseYearResult {
  const A = YEAR_RESULT_ACCOUNTS;
  const lines: YeLine[] = [];
  const L = (account: string, debit: number, credit: number) => lines.push({ account, debit, credit });
  let res = 0;
  for (const [k, v] of Object.entries(pre)) {
    if (!(k.startsWith('4') || k.startsWith('7')) || Math.abs(v.s) < 0.005) continue;
    if (v.s > 0) {
      L(A.preTax, v.s, 0);
      L(k, 0, v.s);
    } else {
      L(k, -v.s, 0);
      L(A.preTax, 0, -v.s);
    }
    res -= v.s;
  }
  res = r2(res);
  if (res >= 0 && res) {
    L(A.preTax, res, 0);
    L(A.net, 0, res);
  } else if (res < 0) {
    L(A.net, -res, 0);
    L(A.preTax, 0, -res);
  }
  if (tax) {
    L(A.taxExpense, tax, 0);
    L(A.taxPayable, 0, tax);
    L(A.net, tax, 0);
    L(A.taxExpense, 0, tax);
  }
  const net = r2(res - tax);
  if (net > 0) {
    L(A.net, net, 0);
    L(A.currentProfit, 0, net);
  } else if (net < 0) {
    L(A.currentLoss, -net, 0);
    L(A.net, 0, -net);
  }
  return { lines, profit: res, tax, net };
}

/** Legacy `closeYear` fallback tax (no ДБ data): 10% of max(0, profit + non-deductible). Kept for reference only. */
export const legacyCloseTax = (profit: number, nonDeductible = 0): number => r2(Math.max(0, profit + nonDeductible) * 0.1);

/** Carry-forward account for an opening line (legacy `obResK`, now unconditional): 951→950, 961→960. */
export function carryForwardAccount(k: string): string {
  const s = String(k || '');
  return /^951/.test(s) ? YEAR_RESULT_ACCOUNTS.retainedProfit : /^961/.test(s) ? YEAR_RESULT_ACCOUNTS.retainedLoss : s;
}

/**
 * Remap opening lines (legacy `obResLines`): 951… / 961… → 950 / 960, merged into one line per target account, and a
 * 950/960 line that ends up with both sides is netted.
 */
export function carryForwardLines<T extends YeLine>(L: readonly T[]): T[] {
  const out: T[] = [];
  const m: Record<string, T> = {};
  for (const l of L) {
    const k = carryForwardAccount(l.account);
    if (k !== String(l.account) && !l.partner) {
      const ex = m[k];
      if (ex) {
        ex.debit = r2((+ex.debit || 0) + (+l.debit || 0));
        ex.credit = r2((+ex.credit || 0) + (+l.credit || 0));
        continue;
      }
      const n = { ...l, account: k };
      m[k] = n;
      out.push(n);
    } else out.push({ ...l });
  }
  for (const k of Object.keys(m)) {
    const x = m[k]!;
    const ex = out.find((l) => l !== x && String(l.account) === k && !l.partner);
    if (ex) {
      ex.debit = r2((+ex.debit || 0) + (+x.debit || 0));
      ex.credit = r2((+ex.credit || 0) + (+x.credit || 0));
      out.splice(out.indexOf(x), 1);
    }
  }
  for (const l of out) {
    const n = r2((+l.debit || 0) - (+l.credit || 0));
    if (/^9[56]0$/.test(String(l.account)) && +l.debit && +l.credit) {
      l.debit = n > 0 ? n : 0;
      l.credit = n < 0 ? -n : 0;
    }
  }
  return out;
}

/** Partner balance on a receivable/payable account (12*, 22*). */
export interface PartnerBalance {
  account: string;
  partner: string;
  /** debit - credit */
  balance: number;
}

/**
 * Opening journal `open-<year+1>` (legacy `openYear` 6744): balance-sheet classes 0, 1, 2, 3, 6, 9 from the closed
 * year (balances INCLUDING the close), receivables/payables (12*, 22*) split by partner, then `carryForwardLines`.
 */
export function openYearLines(all: YeBalances, partnerBalances: readonly PartnerBalance[]): YeLine[] {
  const lines: YeLine[] = [];
  for (const [k, v] of Object.entries(all)) {
    if (!/^[012369]/.test(k) || Math.abs(v.s) < 0.005) continue;
    lines.push(v.s > 0 ? { account: k, debit: v.s, credit: 0 } : { account: k, debit: 0, credit: -v.s });
  }
  const pb: Record<string, number> = {};
  for (const x of partnerBalances) {
    if (!x.partner || !/^(12|22)/.test(x.account)) continue;
    const key = x.account + '|' + x.partner;
    pb[key] = (pb[key] || 0) + (+x.balance || 0);
  }
  const out = lines.filter((l) => !/^(12|22)/.test(l.account));
  for (const [key, s] of Object.entries(pb)) {
    const [k, p] = key.split('|') as [string, string];
    const v = r2(s);
    if (Math.abs(v) < 0.005) continue;
    out.push(v > 0 ? { account: k, debit: v, credit: 0, partner: p } : { account: k, debit: 0, credit: -v, partner: p });
  }
  for (const l of lines.filter((l) => /^(12|22)/.test(l.account))) {
    const withP = Object.entries(pb)
      .filter(([key]) => key.startsWith(l.account + '|'))
      .reduce((s, [, v]) => s + v, 0);
    const rest = r2(l.debit - l.credit - withP);
    if (Math.abs(rest) > 0.005) out.push(rest > 0 ? { account: l.account, debit: rest, credit: 0 } : { account: l.account, debit: 0, credit: -rest });
  }
  return carryForwardLines(out);
}
