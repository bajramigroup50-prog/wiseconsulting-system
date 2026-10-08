/**
 * Feeding the year-end engine from the persisted ledger.
 *
 * Legacy recomputed everything from documents (`ledger()`, `S.data.pay`, …). The rebuild reads the posted journal
 * lines of the year and turns them into the engine inputs: the trial balance (opening split from turnover, without
 * the closing journal), the close lines, partner balances for the carry-forward, the first posting month (bu258) and
 * payroll totals (bu214–216 / bu257) when the payroll module does not supply them.
 */
import { r2 } from '../money';
import type { YeLine, YeTrialBalanceRow } from './balances';
import type { PartnerBalance } from './close';
import type { ZsPayrollRun } from './aop';

/** The fields of a persisted ledger line the year-end reads (a subset of `LedgerLine`). */
export interface YeLedgerLine {
  account: string;
  debit: number;
  credit: number;
  date: string;
  partnerId?: string | null;
  kind?: string | null;
}

export interface YeLedgerInputs {
  /** turnover of the year without opening and without the close, plus the opening balance per account */
  tb: YeTrialBalanceRow[];
  /** lines of the closing journal (kind `close`) */
  closeLines: YeLine[];
  /** debit − credit per partner account (12*, 22*) including the close */
  partnerBalances: PartnerBalance[];
  hasOpening: boolean;
  hasImportedTb: boolean;
  /** first `YYYY-MM` with a regular posting (not open / bbimp / close) */
  firstPostingMonth: string;
}

export function yeInputsFromLedger(lines: readonly YeLedgerLine[]): YeLedgerInputs {
  const by: Record<string, { d: number; p: number; od: number; op: number }> = {};
  const closeLines: YeLine[] = [];
  const pb: Record<string, number> = {};
  let hasOpening = false;
  let hasImportedTb = false;
  let first = '';
  for (const l of lines) {
    const k = String(l.account);
    const d = +l.debit || 0;
    const p = +l.credit || 0;
    if (l.partnerId && /^(12|22)/.test(k)) {
      const key = k + '|' + l.partnerId;
      pb[key] = (pb[key] || 0) + d - p;
    }
    if (l.kind === 'close') {
      closeLines.push({ account: k, debit: d, credit: p, ...(l.partnerId ? { partner: l.partnerId } : {}) });
      continue;
    }
    const b = (by[k] ??= { d: 0, p: 0, od: 0, op: 0 });
    if (l.kind === 'open') {
      hasOpening = true;
      b.od += d;
      b.op += p;
    } else {
      if (l.kind === 'bbimp') hasImportedTb = true;
      else {
        const m = String(l.date).slice(0, 7);
        if (!first || m < first) first = m;
      }
      b.d += d;
      b.p += p;
    }
  }
  const tb: YeTrialBalanceRow[] = Object.keys(by)
    .sort()
    .map((account) => {
      const b = by[account]!;
      return { account, debit: r2(b.d), credit: r2(b.p), openingDebit: r2(b.od), openingCredit: r2(b.op) };
    });
  const partnerBalances: PartnerBalance[] = Object.entries(pb)
    .map(([key, v]) => {
      const [account, partner] = key.split('|') as [string, string];
      return { account, partner, balance: r2(v) };
    })
    .filter((x) => Math.abs(x.balance) >= 0.005);
  return { tb, closeLines, partnerBalances, hasOpening, hasImportedTb, firstPostingMonth: first };
}

/** Accounts of the default payroll scheme (`PAY_SCH0`): personal income tax and the contributions. */
export const YE_PAYROLL_TAX_ACCOUNTS: readonly string[] = ['2340'];
export const YE_PAYROLL_CONTRIB_ACCOUNTS: readonly string[] = ['2341', '2342', '2343', '2344', '2349'];

/**
 * Payroll runs of the year read from the ledger (journals of kind `plati`): per month the credits on the tax and
 * contribution accounts. The number of employees is not in the ledger (0); the payroll module supplies it through
 * {@link YePayrollSource}.
 */
export function yePayrollFromLedger(
  lines: readonly YeLedgerLine[],
  acc: { tax?: readonly string[]; contrib?: readonly string[] } = {},
): ZsPayrollRun[] {
  const T = acc.tax ?? YE_PAYROLL_TAX_ACCOUNTS;
  const C = acc.contrib ?? YE_PAYROLL_CONTRIB_ACCOUNTS;
  const M: Record<string, ZsPayrollRun> = {};
  for (const l of lines) {
    if (l.kind !== 'plati') continue;
    const k = String(l.account);
    const isT = T.includes(k);
    const isC = C.includes(k);
    if (!isT && !isC) continue;
    const m = String(l.date).slice(0, 7);
    const r = (M[m] ??= { month: m, employees: 0, tax: 0, contrib: 0 });
    const v = (+l.credit || 0) - (+l.debit || 0);
    if (isT) r.tax = r2(r.tax + v);
    else r.contrib = r2(r.contrib + v);
  }
  return Object.values(M).sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * What the payroll module (Phase 6) provides to the year-end: the v2 payroll runs of the year with the number of
 * employees, and the number of active employees (bu257 when there were no runs).
 */
export interface YePayrollSource {
  runs(firmId: string, year: number): Promise<ZsPayrollRun[]>;
  activeEmployees(firmId: string, year: number): Promise<number>;
}

/**
 * Merge payroll runs from the payroll module with the ledger-derived ones: a module run wins for its month; ledger
 * months the module does not know are kept (amounts only).
 */
export function yeMergePayroll(fromModule: readonly ZsPayrollRun[], fromLedger: readonly ZsPayrollRun[]): ZsPayrollRun[] {
  const M = new Map<string, ZsPayrollRun>();
  for (const r of fromLedger) M.set(r.month, r);
  for (const r of fromModule) M.set(r.month, r);
  return [...M.values()].sort((a, b) => a.month.localeCompare(b.month));
}
