/**
 * Loan / court-withholding instalments in a new payroll month (Helix „Кредити“ – „Листа на оброци“): for every employee
 * with loans in the register (`employees.data.loans`) the deduction line „Кредит / судска забрана (задршка)“ of the
 * draft is set to the instalment still due – the monthly rate of each loan in force, at most its open rest after the
 * deductions of the earlier months – and dropped once everything is repaid. Employees without loans are left as they are.
 */
import { and, eq, gte, lt } from 'drizzle-orm';
import { empCalc, isLoanDeduction, payLoanStatus, r2, type PayEmp, type PayLoan } from '@wise/core';
import type { Tx } from './audit';
import { loadRun } from './payroll';
import { employees, payrollRuns } from './schema/index';

export const PAY_LOAN_LINE = 'Кредит / судска забрана (задршка)';

/** The instalment due in `month` from the loans and the earlier deductions (`month` → amount). */
export function loanInstalment(loans: readonly PayLoan[], ded: ReadonlyMap<string, number>, month: string): number {
  const before = new Map([...ded].filter(([m]) => m < month));
  return r2(payLoanStatus(loans, before).filter((l) => l.from.slice(0, 7) <= month && l.rest > 0.009).reduce((a, l) => a + Math.min(+l.monthly > 0 ? +l.monthly : l.rest, l.rest), 0));
}

export async function applyLoanInstalments(tx: Tx, firmId: string, month: string, emps: PayEmp[]): Promise<PayEmp[]> {
  const E = (await tx.select({ id: employees.id, data: employees.data }).from(employees).where(eq(employees.firmId, firmId)))
    .map((e) => ({ id: e.id, loans: (((e.data ?? {}) as { loans?: PayLoan[] }).loans ?? []) })).filter((e) => e.loans.length);
  if (!E.length) return emps;
  const from = E.flatMap((e) => e.loans.map((l) => l.from.slice(0, 7))).sort()[0]!;
  const ded = new Map<string, Map<string, number>>();
  const R = await tx.select({ id: payrollRuns.id }).from(payrollRuns).where(and(eq(payrollRuns.firmId, firmId), gte(payrollRuns.month, from), lt(payrollRuns.month, month)));
  for (const r of R) {
    const run = await loadRun(tx, firmId, { id: r.id });
    if (!run) continue;
    for (const e of run.emps) {
      const v = empCalc(e as PayEmp, run.params).rows.filter((x) => x.ded && isLoanDeduction(x.type)).reduce((a, x) => a + x.ded, 0);
      if (!v || !e.empId) continue;
      const m = ded.get(e.empId) ?? ded.set(e.empId, new Map()).get(e.empId)!;
      m.set(run.month, (m.get(run.month) ?? 0) + v);
    }
  }
  const byId = new Map(E.map((e) => [e.id, e.loans]));
  return emps.map((e) => {
    const loans = byId.get(e.empId);
    if (!loans) return e;
    const amt = loanInstalment(loans, ded.get(e.empId) ?? new Map(), month);
    const lines = (e.lines ?? []).filter((l) => !isLoanDeduction(l.type));
    if (amt > 0) lines.push({ type: PAY_LOAN_LINE, amt, hours: 0, pct: 0, cat: 'sin' });
    return { ...e, lines };
  });
}
