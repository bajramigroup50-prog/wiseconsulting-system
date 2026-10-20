'use server';
/** 📥 Прием на документи – a new receipt of the current firm (number of the office's book 01) and „↩ Вратено“. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { PRIEM_KINDS, priemItemsClean, type PriemItem } from '@wise/core/office/priem';
import { createReceipt, markReceiptReturned, PriemError } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { fdate, fv, isUuid, officeAction, officeError } from '@/lib/office';

const PATH = '/priem';
const err = (e: unknown): ActionState => (e instanceof PriemError ? { error: e.message } : officeError(e));

export async function priemSave(_p: ActionState, f: FormData): Promise<ActionState> {
  let id = '';
  try {
    const { u, firm } = await officeAction('write');
    const items: PriemItem[] = priemItemsClean(PRIEM_KINDS.map(([k]) => ({ k, n: Number(fv(f, 'n_' + k) ?? 0), pack: f.get('p_' + k) === 'on', text: fv(f, 't_' + k) ?? undefined })));
    const r = await db().transaction((tx) => createReceipt(tx, {
      firmId: firm.id, period: fv(f, 'period') ?? '', broughtBy: fv(f, 'broughtBy'), items, note: fv(f, 'note'), returnDue: fdate(f, 'returnDue'),
    }, u.id));
    id = r.id;
  } catch (e) { return err(e); }
  revalidatePath(PATH);
  redirect(`${PATH}?id=${id}`);
}

export async function priemReturned(id: string, _p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u } = await officeAction('write');
    if (!isUuid(id)) return { error: 'Непознат прием.' };
    await db().transaction((tx) => markReceiptReturned(tx, id, fv(f, 'to'), u.id));
  } catch (e) { return err(e); }
  revalidatePath(PATH);
  return { ok: 'Оригиналите се означени како вратени.' };
}
