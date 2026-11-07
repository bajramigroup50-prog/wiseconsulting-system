'use server';
/** „🗓 Отсуства“ — save / delete an absence (with its decision attached) and re-apply the register to a draft month. */
import { revalidatePath } from 'next/cache';
import { AbsenceError, deleteAbsence, reapplyToRun, saveAbsence, type Tx } from '@wise/db';
import { actionError, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { payAction } from '@/lib/payroll/server';

const fail = (e: unknown): ActionState => (e instanceof AbsenceError ? { error: e.message } : actionError(e));

export async function saveAbsenceAction(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await payAction('payAbsence');
    const g = (k: string) => String(form.get(k) ?? '').trim();
    const fileIds = form.getAll('fileIds').map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
    await db().transaction((tx) => saveAbsence(tx as unknown as Tx, firm.id, {
      id: /^[0-9a-f-]{36}$/i.test(g('id')) ? g('id') : null, employeeId: g('emp'), code: g('code'), from: g('from'), to: g('to'), docNo: g('docNo'), note: g('note'), fileIds,
    }, u.id));
    revalidatePath('/payOds');
    return { ok: 'Зачувано. Новата плата за месеците на отсуството ги зема часовите сама; за веќе направена (непрокнижена) плата притиснете „⟳ Примени во платата“.' };
  } catch (e) { return fail(e); }
}

export async function deleteAbsenceAction(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await payAction('payAbsence');
    await db().transaction((tx) => deleteAbsence(tx as unknown as Tx, firm.id, id, u.id));
    revalidatePath('/payOds');
    return { ok: 'Избришано.' };
  } catch (e) { return fail(e); }
}

export async function reapplyAction(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await payAction('payAbsence');
    const month = String(form.get('month') ?? '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { error: 'Изберете месец.' };
    const r = await db().transaction((tx) => reapplyToRun(tx as unknown as Tx, firm.id, month, u.id));
    revalidatePath('/payOds'); revalidatePath(`/plati/${month}`);
    return { ok: `✓ Платата за ${month.split('-').reverse().join('/')} е освежена (${r.emps} вработени): отсуствата и задршките се внесени, редовните часови намалени.` };
  } catch (e) { return fail(e); }
}
