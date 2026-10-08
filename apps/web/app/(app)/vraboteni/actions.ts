'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { audit, employees, payrollEmp, type NewEmployee } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { payAction, payError } from '@/lib/payroll/server';

const opt = z.string().trim().max(300).transform((s) => s || null);
const dateOpt = opt.refine((s) => !s || /^\d{4}-\d{2}-\d{2}$/.test(s), 'Неважечки датум.');
const numOpt = z.string().trim().transform((s) => (s === '' ? null : s.replace(',', '.'))).refine((s) => s == null || Number.isFinite(+s), 'Внесете број.');
const EmployeeInput = z.object({
  no: opt,
  name: z.string().trim().min(2, 'Внесете име и презиме.').max(200),
  embg: opt.refine((s) => !s || /^\d{13}$/.test(s), 'ЕМБГ има 13 цифри.'),
  position: opt, oe: opt, city: opt, address: opt,
  email: opt.refine((s) => !s || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s), 'Неважечка е-пошта.'),
  netBase: numOpt, coef: numOpt, stazPrev: numOpt, stazY: numOpt, hNorm: numOpt, leaveDays: numOpt,
  start: dateOpt, end: dateOpt, m1Date: dateOpt, lekDate: dateOpt, bzrDate: dateOpt,
  contract: z.enum(['', 'определено', 'неопределено']).transform((s) => s || null),
  bankAcc: opt, bank: opt,
  mpOps: opt.refine((s) => !s || /^\d{1,4}$/.test(s), 'Шифра на општина.'),
  mpZan: opt.refine((s) => !s || /^\d{4,6}$/.test(s), 'Шифра на подрачна единица.'),
  mpC26: opt,
  active: z.boolean(),
});
const TEXT = ['no', 'name', 'embg', 'position', 'oe', 'city', 'address', 'email', 'netBase', 'coef', 'stazPrev', 'stazY', 'hNorm', 'leaveDays',
  'start', 'end', 'm1Date', 'lekDate', 'bzrDate', 'contract', 'bankAcc', 'bank', 'mpOps', 'mpZan', 'mpC26'] as const;

class UserError extends Error {}

/** Legacy `saveS('employees')` / `addEmpNow` (number = max + 1, leave 20 days, coef 1). */
export async function saveEmployee(_prev: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get('id') ?? '') || null;
  let back = '/vraboteni';
  try {
    const { u, firm } = await payAction('write');
    const parsed = EmployeeInput.safeParse({ ...Object.fromEntries(TEXT.map((k) => [k, String(form.get(k) ?? '')])), active: form.get('active') === 'on' });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Неважечки податоци.' };
    const v = parsed.data;
    const row: Partial<NewEmployee> = {
      ...v, netBase: v.netBase ?? '0', coef: v.coef ?? '1', leaveDays: v.leaveDays ? Math.round(+v.leaveDays) : 20,
      stazPrev: v.stazPrev, stazY: v.stazY, hNorm: v.hNorm,
    };
    await db().transaction(async (tx) => {
      if (!row.no) {
        const [{ m }] = (await tx.select({ m: sql<number>`coalesce(max(case when ${employees.no} ~ '^[0-9]+$' then ${employees.no}::int end), 0)::int` })
          .from(employees).where(eq(employees.firmId, firm.id))) as [{ m: number }];
        row.no = String(m + 1);
      }
      if (row.embg) {
        const [dup] = await tx.select({ name: employees.name }).from(employees)
          .where(and(eq(employees.firmId, firm.id), eq(employees.embg, row.embg), id ? ne(employees.id, id) : undefined)).limit(1);
        if (dup) throw new UserError(`ЕМБГ ${row.embg} веќе е внесен кај „${dup.name}“.`);
      }
      if (id) {
        const [before] = await tx.select().from(employees).where(and(eq(employees.id, id), eq(employees.firmId, firm.id))).limit(1);
        if (!before) throw new UserError('Вработениот не постои.');
        await tx.update(employees).set(row).where(eq(employees.id, id));
        const changed = Object.fromEntries(Object.entries(row).filter(([k, x]) => String(before[k as keyof typeof before] ?? '') !== String(x ?? '')));
        await audit(tx, { userId: u.id, firmId: firm.id, action: 'saveS', entityType: 'employee', entityId: id, data: changed });
      } else {
        const [e] = await tx.insert(employees).values({ ...row, name: v.name, firmId: firm.id }).returning({ id: employees.id });
        await audit(tx, { userId: u.id, firmId: firm.id, action: 'addEmpNow', entityType: 'employee', entityId: e!.id, data: { name: v.name, no: row.no } });
      }
    });
    back = String(form.get('back') || '/vraboteni');
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    return payError(e);
  }
  revalidatePath('/vraboteni');
  redirect(back.startsWith('/') ? back : '/vraboteni');
}

/** Delete an employee that is not in any payroll run (otherwise mark inactive). Needs `del`. */
export async function deleteEmployee(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await payAction('del');
    const msg = await db().transaction(async (tx) => {
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(payrollEmp)
        .where(and(eq(payrollEmp.firmId, firm.id), eq(payrollEmp.employeeId, id)))) as [{ n: number }];
      if (n) return `Не може да се избрише – вработениот е во ${n} пресметки на плата. Означете го како неактивен.`;
      const [e] = await tx.delete(employees).where(and(eq(employees.id, id), eq(employees.firmId, firm.id))).returning();
      if (e) await audit(tx, { userId: u.id, firmId: firm.id, action: 'delS', entityType: 'employee', entityId: id, data: { name: e.name, embg: e.embg } });
      return null;
    });
    if (msg) return { error: msg };
  } catch (e) { return payError(e); }
  revalidatePath('/vraboteni');
  return { ok: 'Избришано.' };
}

/** Legacy `activateEmp` / deactivate. */
export async function setEmployeeActive(id: string, active: boolean): Promise<ActionState> {
  try {
    const { u, firm } = await payAction('write');
    await db().transaction(async (tx) => {
      await tx.update(employees).set({ active }).where(and(eq(employees.id, id), eq(employees.firmId, firm.id)));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'activateEmp', entityType: 'employee', entityId: id, data: { active } });
    });
  } catch (e) { return payError(e); }
  revalidatePath('/vraboteni');
  return { ok: 'Зачувано.' };
}
