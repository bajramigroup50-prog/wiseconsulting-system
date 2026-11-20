'use server';
/** 💱 Курсни разлики: book / undo the month-end revaluation of the firm's foreign-currency bank accounts. */
import { revalidatePath } from 'next/cache';
import { postFxReval, undoFxReval } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { fmt } from '@/lib/fmt';
import { isDate } from '@/lib/finance';

export async function fxRevalAction(date: string): Promise<ActionState> {
  try {
    if (!isDate(date)) return { error: 'Неважечки датум.' };
    const { u, firm } = await firmAction('fxReval');
    const r = await db().transaction((tx) => postFxReval(tx, { firmId: firm.id, date, userId: u.id }));
    revalidatePath('/kursRaz');
    return { ok: `Книжено (налог ${r.journal.number}): позитивни ${fmt(r.gain)} · негативни ${fmt(r.loss)} ден.` };
  } catch (e) { return actionError(e); }
}

export async function fxRevalUndoAction(date: string): Promise<ActionState> {
  try {
    if (!isDate(date)) return { error: 'Неважечки датум.' };
    const { u, firm } = await firmAction('nalDel');
    const n = await db().transaction((tx) => undoFxReval(tx, { firmId: firm.id, date, userId: u.id }));
    revalidatePath('/kursRaz');
    return n ? { ok: 'Налогот за курсни разлики е поништен.' } : { error: 'Нема книжење за тој датум.' };
  } catch (e) { return actionError(e); }
}
