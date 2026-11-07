/**
 * Loan / court-withholding instalments in a new payroll month (Helix „Кредити“ – „Листа на оброци“, „Извршители“): for
 * every employee with orders in the register (`employees.data.loans`) the draft gets ONE deduction line per order in
 * force — „Задршка: Извршител Петров (И.бр. 123/26) #1a2b3c4d“ — its instalment (fixed or % of the net), at most its
 * open rest after the earlier months, within the legal cap of the net before deductions (ЗИ чл. 117: издршка 1/2,
 * other claims 1/3, all together never more than 1/2; `loanCuts`). Repaid orders drop out. Employees without orders
 * are left as they are. The lines carry the order's tag, so every month's deduction is credited to its own order.
 */
import { and, eq, gte, lt } from 'drizzle-orm';
import {
  empCalc, isLoanDeduction, loanCuts, loanLineType, loanOfLine, loanTag, payLoanStatus, r2, resolvePayParams,
  type LoanCut, type LoanMonthDed, type PayEmp, type PayLoan, type PayParams,
} from '@wise/core';
import type { Tx } from './audit';
import { loadRun } from './payroll';
import { employees, payrollRuns } from './schema/index';

export const PAY_LOAN_LINE = 'Кредит / судска забрана (задршка)';
/** The decision of a withholding order is attached through `file_links` with this entity type (id = the order id). */
export const PAY_LOAN_FILE_ENTITY = 'pay_loan';

/** The instalment due in `month` from the loans and the earlier deductions (`month` → amount) – no cap (legacy). */
export function loanInstalment(loans: readonly PayLoan[], ded: ReadonlyMap<string, number | LoanMonthDed>, month: string): number {
  const before = new Map([...ded].filter(([m]) => m < month));
  return r2(payLoanStatus(loans, before).filter((l) => !l.closed && l.from.slice(0, 7) <= month && l.rest > 0.009).reduce((a, l) => a + Math.min(+l.monthly > 0 ? +l.monthly : l.rest, l.rest), 0));
}

/** Loan deductions of one employee in a calculated run, split per order (tagged lines) and the untagged rest. */
export function loanDedOf(e: PayEmp, P: PayParams, loans: readonly PayLoan[]): LoanMonthDed {
  const out: LoanMonthDed = { by: {}, pool: 0 };
  for (const x of empCalc(e, P).rows) {
    if (!x.ded || !isLoanDeduction(x.type)) continue;
    const l = loanOfLine(x.type, loans);
    if (l) out.by[loanTag(l)] = r2((out.by[loanTag(l)] ?? 0) + x.ded);
    else out.pool = r2(out.pool + x.ded);
  }
  return out;
}

/** Every employee's loan deductions per month from the runs in [from, before) (`empId` → month → deductions). */
export async function loanDeductions(tx: Tx, firmId: string, loansOf: ReadonlyMap<string, readonly PayLoan[]>, from: string, before?: string): Promise<Map<string, Map<string, LoanMonthDed>>> {
  const ded = new Map<string, Map<string, LoanMonthDed>>();
  const R = await tx.select({ id: payrollRuns.id }).from(payrollRuns)
    .where(and(eq(payrollRuns.firmId, firmId), gte(payrollRuns.month, from), ...(before ? [lt(payrollRuns.month, before)] : [])));
  for (const r of R) {
    const run = await loadRun(tx, firmId, { id: r.id });
    if (!run) continue;
    for (const e of run.emps) {
      if (!e.empId || !loansOf.has(e.empId)) continue;
      const d = loanDedOf(e as PayEmp, run.params, loansOf.get(e.empId)!);
      if (!d.pool && !Object.keys(d.by).length) continue;
      (ded.get(e.empId) ?? ded.set(e.empId, new Map()).get(e.empId)!).set(run.month, d);
    }
  }
  return ded;
}

export interface LoanApplyNote { empId: string; name: string; cuts: LoanCut[] }

/**
 * Set the withholding lines of the draft `emps` for `month` (one per order, capped). `P` = the month's parameters
 * (needed for the net the cap is measured against). `notes` (optional) collects what was cut by the cap.
 */
export async function applyLoanInstalments(tx: Tx, firmId: string, month: string, emps: PayEmp[], P?: PayParams, notes?: LoanApplyNote[]): Promise<PayEmp[]> {
  const E = (await tx.select({ id: employees.id, data: employees.data }).from(employees).where(eq(employees.firmId, firmId)))
    .map((e) => ({ id: e.id, loans: (((e.data ?? {}) as { loans?: PayLoan[] }).loans ?? []) })).filter((e) => e.loans.length);
  if (!E.length) return emps;
  const params = P ?? resolvePayParams({}, month, []);
  const byId = new Map(E.map((e) => [e.id, e.loans]));
  const from = E.flatMap((e) => e.loans.map((l) => l.from.slice(0, 7))).sort()[0]!;
  const ded = await loanDeductions(tx, firmId, byId, from, month);
  return emps.map((e) => {
    const loans = byId.get(e.empId);
    if (!loans) return e;
    const status = payLoanStatus(loans, ded.get(e.empId) ?? new Map());
    const lines = (e.lines ?? []).filter((l) => !isLoanDeduction(l.type));
    const base = empCalc({ ...e, lines }, params).T;
    const netBefore = r2(base.net + base.ded);
    const cuts = loanCuts(status, netBefore, month);
    for (const c of cuts) if (c.amt > 0) lines.push({ type: loanLineType(c.loan), amt: c.amt, hours: 0, pct: 0, cat: 'sin', code: '603' });
    if (notes && cuts.some((c) => c.capped)) notes.push({ empId: e.empId, name: e.name, cuts });
    return { ...e, lines };
  });
}
