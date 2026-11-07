'use server';
/**
 * Плата › Кредити и задршки (Helix „Кредити“ / „Извршители“): the register of an employee's withholding orders, in
 * `employees.data.loans` — creditor / executor with account and case number, the debt, a fixed or % instalment, the
 * legal cap (ЗИ чл. 117), the decision attached (`file_links`, entity `pay_loan`). Every new payroll month gets one
 * deduction line per order and a КТД to the creditor.
 */
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { loanDefaultCap, parseAccount, type PayLoan, type PayLoanCap } from '@wise/core';
import { audit, employees, fileLinks, PAY_LOAN_FILE_ENTITY } from '@wise/db';
import { actionError, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { isDate } from '@/lib/finance';
import { payAction } from '@/lib/payroll/server';

const CAPS: readonly PayLoanCap[] = ['half', 'third', 'fifth', 'none'];

async function setLoans(empId: string, f: (L: PayLoan[]) => PayLoan[], files: { loanId: string; ids: string[] } | null = null): Promise<void> {
  const { u, firm } = await payAction('payLoan');
  await db().transaction(async (tx) => {
    const [e] = await tx.select().from(employees).where(and(eq(employees.id, empId), eq(employees.firmId, firm.id))).limit(1);
    if (!e) throw new Error('Вработениот не постои.');
    const data = (e.data ?? {}) as Record<string, unknown>;
    const loans = f(Array.isArray(data.loans) ? (data.loans as PayLoan[]) : []);
    await tx.update(employees).set({ data: { ...data, loans } }).where(eq(employees.id, e.id));
    for (const id of files?.ids ?? []) await tx.insert(fileLinks).values({ fileId: id, entityType: PAY_LOAN_FILE_ENTITY, entityId: files!.loanId, role: 'attachment' }).onConflictDoNothing();
    await audit(tx, { userId: u.id, firmId: firm.id, action: 'payLoan', entityType: 'employee', entityId: e.id, data: { n: loans.length } });
  });
  revalidatePath('/payGod'); revalidatePath('/payZadr');
}

export async function payLoanSaveAction(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const g = (k: string) => String(form.get(k) ?? '').trim();
    const num = (k: string) => +g(k).replace(/\s/g, '').replace(',', '.') || 0;
    const empId = g('emp');
    const kind = g('kind') || 'Кредит';
    const cap = (CAPS as readonly string[]).includes(g('cap')) ? (g('cap') as PayLoanCap) : loanDefaultCap(kind);
    const accRaw = g('acc');
    const acc = accRaw ? parseAccount(accRaw) : null;
    if (accRaw && !acc) return { error: 'Сметката на доверителот не е валидна (15 цифри или IBAN MK07…).' };
    const id = g('id') || crypto.randomUUID();
    const l: PayLoan = {
      id, kind, creditor: g('creditor'), total: num('total'), monthly: num('monthly'), from: g('from'), cap,
      ...(num('pct') > 0 ? { pct: Math.min(100, num('pct')) } : {}),
      ...(acc?.acc ? { acc: acc.acc, bank: acc.bank } : {}),
      ...(g('caseNo') ? { caseNo: g('caseNo') } : {}), ...(g('ref') ? { ref: g('ref') } : {}), ...(g('note') ? { note: g('note') } : {}),
    };
    if (!empId) return { error: 'Изберете вработен.' };
    if (!l.creditor) return { error: 'Внесете доверител (извршител / банка).' };
    if (!(l.total > 0)) return { error: 'Внесете вкупен износ на долгот.' };
    if (!(l.monthly > 0) && !(l.pct! > 0)) return { error: 'Внесете месечна рата или процент од платата.' };
    if (!isDate(l.from)) return { error: 'Внесете датум од кога се одбива (прием на решението).' };
    const fileIds = form.getAll('fileIds').map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
    await setLoans(empId, (L) => [...L.filter((x) => x.id !== id), l], { loanId: id, ids: fileIds });
    return { ok: 'Зачувано. Секоја нова плата добива посебна ставка „Задршка: …“ за ова решение (во законската граница) и налог КТД до доверителот, додека долгот не се отплати.' };
  } catch (e) { return actionError(e); }
}

export async function payLoanDelAction(empId: string, id: string): Promise<ActionState> {
  try {
    await setLoans(empId, (L) => L.filter((x) => x.id !== id));
    return { ok: 'Избришано.' };
  } catch (e) { return actionError(e); }
}

/** „Затвори / отвори“ – an order paid outside the payroll or revoked stops being deducted. */
export async function payLoanCloseAction(empId: string, id: string, closed: boolean): Promise<ActionState> {
  try {
    await setLoans(empId, (L) => L.map((x) => (x.id === id ? { ...x, closed } : x)));
    return { ok: closed ? 'Затворено – повеќе не се одбива.' : 'Отворено повторно.' };
  } catch (e) { return actionError(e); }
}
