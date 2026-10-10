'use server';
/** Legacy `errFix` / `errDelFixed` — administrator only (legacy: `S.user.role === 'admin'`), audited. */
import { revalidatePath } from 'next/cache';
import { deleteFixedErrors, fixError } from '@wise/db';
import { Forbidden, requireCan } from '@/lib/auth';
import { actionError, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';

async function admin() {
  const u = await requireCan('users');
  if (u.role !== 'admin') throw new Forbidden('greski');
  return u;
}

export async function fixErrorAction(id: string): Promise<ActionState> {
  try {
    const u = await admin();
    await db().transaction((tx) => fixError(tx, { userId: u.id, id }));
    revalidatePath('/greski');
    return { ok: 'Решено.' };
  } catch (e) { return actionError(e); }
}

export async function deleteFixedAction(): Promise<ActionState> {
  try {
    const u = await admin();
    const n = await db().transaction((tx) => deleteFixedErrors(tx, { userId: u.id }));
    revalidatePath('/greski');
    return { ok: `Избришани ${n}.` };
  } catch (e) { return actionError(e); }
}
