'use server';
/** Legacy `pdOeEd` (14886–14897): assign employees to units (`oe`) for sending the payslips per unit. */
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { audit, employees } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { payAction, payError } from '@/lib/payroll/server';

export async function saveEmployeesOe(changes: { id: string; oe: string }[]): Promise<ActionState> {
  try {
    const L = (Array.isArray(changes) ? changes : []).filter((c) => c && /^[0-9a-f-]{36}$/i.test(c.id)).slice(0, 5000)
      .map((c) => ({ id: c.id, oe: String(c.oe ?? '').trim().slice(0, 120) }));
    if (!L.length) return { ok: 'Нема промени.' };
    const { u, firm } = await payAction('write');
    const n = await db().transaction(async (tx) => {
      let k = 0;
      for (const c of L) {
        const r = await tx.update(employees).set({ oe: c.oe || null }).where(and(eq(employees.id, c.id), eq(employees.firmId, firm.id))).returning({ id: employees.id });
        k += r.length;
      }
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'pdOeSave', entityType: 'employee', data: { n: k } });
      return k;
    });
    revalidatePath('/plati');
    revalidatePath('/vraboteni');
    return { ok: `Зачувано: ${n} вработени.` };
  } catch (e) { return payError(e); }
}
