'use server';
/** Legacy ACT `fxSave` / `fxDel` (need `settings`) — office-wide rate list, no firm needed. */
import { revalidatePath } from 'next/cache';
import { deleteFxList, saveFxList } from '@wise/db';
import { requireCan } from '@/lib/auth';
import { bankError, isDate, num, str } from '@/lib/bank';
import { db } from '@/lib/db';
import type { FormState } from '@/components/bank-form';

export async function saveFxAction(_p: FormState, form: FormData): Promise<FormState> {
  try {
    const u = await requireCan('fxSave');
    const date = str(form.get('date'));
    if (!isDate(date)) return { error: 'Внесете датум.' };
    const curs = form.getAll('cur').map(String);
    const rates = form.getAll('rate');
    const rows = curs.map((cur, i) => ({ cur, rate: num(rates[i] ?? null) ?? 0 })).filter((r) => r.cur.trim() && r.rate);
    const n = await db().transaction((tx) => saveFxList(tx, { userId: u.id, date, rows }));
    revalidatePath('/kursna');
    return { ok: `Зачувани ${n} курсеви за ${date.split('-').reverse().join('.')}.` };
  } catch (e) { return bankError(e); }
}

export async function deleteFxAction(date: string): Promise<FormState> {
  try {
    const u = await requireCan('fxDel');
    await db().transaction((tx) => deleteFxList(tx, { userId: u.id, date }));
    revalidatePath('/kursna');
    return { ok: 'Избришано.' };
  } catch (e) { return bankError(e); }
}
