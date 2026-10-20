'use server';
/** ISO квалитет – server actions (office-wide, `office` permission, every change audited in @wise/db). */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isoKind, type IsoStatus } from '@wise/core/office/iso';
import { addIsoStarterDocs, deleteIsoRecord, getOfficeProfile, IsoError, saveIsoRecord, setIsoStatus } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { fdate, fv, isUuid, officeError, officeGlobal, today } from '@/lib/office';

const PATH = '/iso';
const err = (e: unknown): ActionState => (e instanceof IsoError ? { error: e.message } : officeError(e));

export async function isoSave(_p: ActionState, f: FormData): Promise<ActionState> {
  let kind = '';
  try {
    const u = await officeGlobal('office');
    kind = fv(f, 'kind') ?? '';
    const def = isoKind(kind);
    if (!def) return { error: 'Непознат регистар.' };
    const id = fv(f, 'id');
    if (id && !isUuid(id)) return { error: 'Неважечки запис.' };
    const data = Object.fromEntries(def.fields.map((x) => [x.k, x.t === 'date' ? fdate(f, 'd_' + x.k) : fv(f, 'd_' + x.k)]));
    await db().transaction((tx) => saveIsoRecord(tx, {
      id, kind, title: fv(f, 'title') ?? '', status: fv(f, 'status'), due: fdate(f, 'due'),
      firmId: isUuid(fv(f, 'firmId')) ? fv(f, 'firmId') : null, ownerId: isUuid(fv(f, 'ownerId')) ? fv(f, 'ownerId') : null, data,
    }, u.id, today()));
  } catch (e) { return err(e); }
  revalidatePath(PATH);
  redirect(`${PATH}?k=${kind}`);
}

export async function isoStatus(id: string, status: IsoStatus): Promise<ActionState> {
  try {
    const u = await officeGlobal('office');
    if (!isUuid(id)) return { error: 'Неважечки запис.' };
    await db().transaction((tx) => setIsoStatus(tx, id, status, u.id));
  } catch (e) { return err(e); }
  revalidatePath(PATH);
  return { ok: status === 'done' ? 'Затворено.' : 'Отворено повторно.' };
}

export async function isoDelete(id: string): Promise<ActionState> {
  try {
    const u = await officeGlobal('del');
    if (!isUuid(id)) return { error: 'Неважечки запис.' };
    await db().transaction((tx) => deleteIsoRecord(tx, id, u.id));
  } catch (e) { return err(e); }
  revalidatePath(PATH);
  return { ok: 'Избришано.' };
}

export async function isoStarter(): Promise<ActionState> {
  let n = 0;
  try {
    const u = await officeGlobal('office');
    const O = await getOfficeProfile(db());
    n = await db().transaction((tx) => addIsoStarterDocs(tx, O.name ?? '', u.id, today()));
  } catch (e) { return err(e); }
  revalidatePath(PATH);
  return { ok: n ? `Додадени ${n} документи – прегледајте ги, дополнете и одобрете ги.` : 'Основните документи веќе постојат.' };
}
