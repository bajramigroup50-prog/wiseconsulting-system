'use server';
/** Плата › Кредити и задршки (Helix „Кредити“ / „Извршители“): the register of an employee's loans, in `employees.data.loans`. */
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import type { PayLoan } from '@wise/core';
import { audit, employees } from '@wise/db';
import { actionError, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { isDate } from '@/lib/finance';
import { payAction } from '@/lib/payroll/server';

async function setLoans(empId: string, f: (L: PayLoan[]) => PayLoan[]): Promise<void> {
  const { u, firm } = await payAction('payLoan');
  await db().transaction(async (tx) => {
    const [e] = await tx.select().from(employees).where(and(eq(employees.id, empId), eq(employees.firmId, firm.id))).limit(1);
    if (!e) throw new Error('Вработениот не постои.');
    const data = (e.data ?? {}) as Record<string, unknown>;
    const loans = f(Array.isArray(data.loans) ? (data.loans as PayLoan[]) : []);
    await tx.update(employees).set({ data: { ...data, loans } }).where(eq(employees.id, e.id));
    await audit(tx, { userId: u.id, firmId: firm.id, action: 'payLoan', entityType: 'employee', entityId: e.id, data: { n: loans.length } });
  });
  revalidatePath('/payGod');
}

export async function payLoanSaveAction(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const g = (k: string) => String(form.get(k) ?? '').trim();
    const num = (k: string) => +g(k).replace(/\s/g, '').replace(',', '.') || 0;
    const empId = g('emp');
    const l: PayLoan = { id: crypto.randomUUID(), kind: g('kind') || 'Кредит', creditor: g('creditor'), total: num('total'), monthly: num('monthly'), from: g('from'), ...(g('note') ? { note: g('note') } : {}) };
    if (!empId) return { error: 'Изберете вработен.' };
    if (!l.creditor) return { error: 'Внесете доверител (банка / извршител).' };
    if (!(l.total > 0)) return { error: 'Внесете вкупен износ.' };
    if (!isDate(l.from)) return { error: 'Внесете датум од кога се одбива.' };
    await setLoans(empId, (L) => [...L, l]);
    return { ok: 'Зачувано. Месечниот износ внесете го во платата како „Кредит / судска забрана (задршка)“ – се копира секој месец.' };
  } catch (e) { return actionError(e); }
}

export async function payLoanDelAction(empId: string, id: string): Promise<ActionState> {
  try {
    await setLoans(empId, (L) => L.filter((x) => x.id !== id));
    return { ok: 'Избришано.' };
  } catch (e) { return actionError(e); }
}
