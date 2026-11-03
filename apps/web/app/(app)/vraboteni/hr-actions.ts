'use server';
/** „🎓 Кадровска евиденција“: add / delete a record in `employees.data.hr` (audit `hrRec`). */
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { audit, employees } from '@wise/db';
import { actionError, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { isDate } from '@/lib/finance';
import { HR_KINDS, type HrRec } from '@/lib/payroll/hr-recs';
import { payAction } from '@/lib/payroll/server';

async function setRecs(empId: string, f: (L: HrRec[]) => HrRec[]): Promise<void> {
  const { u, firm } = await payAction('hrRec');
  await db().transaction(async (tx) => {
    const [e] = await tx.select().from(employees).where(and(eq(employees.id, empId), eq(employees.firmId, firm.id))).limit(1);
    if (!e) throw new Error('Вработениот не постои.');
    const data = (e.data ?? {}) as Record<string, unknown>;
    const hr = f(Array.isArray(data.hr) ? (data.hr as HrRec[]) : []);
    await tx.update(employees).set({ data: { ...data, hr } }).where(eq(employees.id, e.id));
    await audit(tx, { userId: u.id, firmId: firm.id, action: 'hrRec', entityType: 'employee', entityId: e.id, data: { n: hr.length } });
  });
  revalidatePath(`/vraboteni/${empId}/kadrovska`);
  revalidatePath('/vraboteni');
}

export async function hrRecSaveAction(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const g = (k: string) => String(form.get(k) ?? '').trim();
    const r: HrRec = { id: crypto.randomUUID(), kind: g('kind'), date: g('date'), title: g('title'),
      ...(g('issuer') ? { issuer: g('issuer') } : {}), ...(g('until') ? { until: g('until') } : {}), ...(g('note') ? { note: g('note') } : {}) };
    if (!(HR_KINDS as readonly string[]).includes(r.kind)) return { error: 'Изберете вид.' };
    if (!isDate(r.date)) return { error: 'Внесете датум.' };
    if (!r.title) return { error: 'Внесете опис.' };
    if (r.until && !isDate(r.until)) return { error: 'Неважечки датум „важи до“.' };
    await setRecs(g('emp'), (L) => [...L, r]);
    return { ok: 'Зачувано.' };
  } catch (e) { return actionError(e); }
}

export async function hrRecDelAction(empId: string, id: string): Promise<ActionState> {
  try {
    await setRecs(empId, (L) => L.filter((x) => x.id !== id));
    return { ok: 'Избришано.' };
  } catch (e) { return actionError(e); }
}
