'use server';
/**
 * Codebook actions — legacy `cbSave` 7369, `cbDel` / `cbDelRow` 14291, `cbSeedCity` 7145, `paySifSeed` 7144.
 * Firm codebooks need `write` (delete: `del`) on the current firm; office-wide lists and office-wide rows need
 * `settings`. Every write goes through `@wise/db` (audit in the same transaction).
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { cbInput, cbIsGlobal, cbPerm, isCbKey, CB, type CbKey } from '@wise/core/codebooks';
import { codeScope, CodebookError, deleteCode, saveCode, seedCities, seedPaySif } from '@wise/db';
import { requireCan, requireUser } from '@/lib/auth';
import { actionError, type ActionState } from '@/lib/books';
import { currentFirm } from '@/lib/context';
import { db } from '@/lib/db';

const err = (e: unknown): ActionState => (e instanceof CodebookError ? { error: e.message } : actionError(e));

/** Guard for a change to codebook `k`: returns the user and the firm the row belongs to (`null` = office-wide). */
async function guard(k: CbKey, id: string | null, del = false) {
  const u0 = await requireUser();
  const firm = await currentFirm(u0);
  let global = cbIsGlobal(k);
  if (id) {
    const r = await codeScope(db(), id);
    if (!r || r.cb !== k) throw new CodebookError('Записот не постои.');
    global = r.firmId == null;
    if (!global && r.firmId !== firm?.id) throw new CodebookError('Записот не постои.');
  }
  if (!global && !firm) throw new Error('Изберете фирма.');
  const perm = del && !global ? 'del' : cbPerm(k, global);
  const u = await requireCan(perm, global ? null : firm!.id);
  if (del && global) await requireCan('del');
  return { u, firmId: global ? null : firm!.id };
}

export async function saveCodeAction(k: string, _p: ActionState, form: FormData): Promise<ActionState> {
  if (!isCbKey(k)) return { error: 'Непознат шифрарник.' };
  const id = String(form.get('id') ?? '') || null;
  try {
    const raw = Object.fromEntries(CB[k].f.map(([f]) => [f, String(form.get(f) ?? '')]));
    const input = cbInput(k, raw);
    if ('error' in input) return { error: input.error };
    const { u, firmId } = await guard(k, id);
    await db().transaction((tx) => saveCode(tx, { userId: u.id, firmId, k, id, input }));
  } catch (e) { return err(e); }
  revalidatePath(`/cb_${k}`);
  redirect(`/cb_${k}`);
}

export async function deleteCodeAction(k: string, id: string): Promise<ActionState> {
  if (!isCbKey(k)) return { error: 'Непознат шифрарник.' };
  try {
    const { u, firmId } = await guard(k, id, true);
    const msg = await db().transaction((tx) => deleteCode(tx, { userId: u.id, firmId, id }));
    if (msg) return { error: msg };
  } catch (e) { return err(e); }
  revalidatePath(`/cb_${k}`);
  return { ok: 'Избришано.' };
}

export async function seedCitiesAction(): Promise<ActionState> {
  try {
    const u = await requireCan('settings');
    const n = await db().transaction((tx) => seedCities(tx, u.id));
    revalidatePath('/cb_city');
    return { ok: `Внесени ${n} градови.` };
  } catch (e) { return err(e); }
}

export async function seedPaySifAction(): Promise<ActionState> {
  try {
    const u0 = await requireUser();
    const firm = await currentFirm(u0);
    if (!firm) return { error: 'Изберете фирма.' };
    const u = await requireCan('write', firm.id);
    const n = await db().transaction((tx) => seedPaySif(tx, { userId: u.id, firmId: firm.id }));
    revalidatePath('/cb_paysif');
    return { ok: `Преземени ${n} стандардни шифри.` };
  } catch (e) { return err(e); }
}
