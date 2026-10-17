'use server';
import { revalidatePath } from 'next/cache';
import { can } from '@wise/core';
import { lockFirmMonth, lockPreparedMonths } from '@wise/db';
import { requireCan, requireUser } from '@/lib/auth';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { isDemoUser } from '@/lib/demo';
import { allowedFirms, officeError } from '@/lib/office';

/** Legacy `zatLock` (ACT_NEED `fix`): lock the firm's books up to the end of the month (never moves the lock back). */
export async function lockMonth(firmId: string, ym: string): Promise<ActionState> {
  try {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return { error: 'Неважечки месец.' };
    const u = await requireCan('fix', firmId);
    const r = await db().transaction((tx) => lockFirmMonth(tx, firmId, ym, u.id));
    revalidatePath('/zatvoranje');
    return r;
  } catch (e) { return officeError(e); }
}

/**
 * P35 „🔒 Заклучи ги сите подготвени“ (owner / administrator, with a confirm on the screen): lock every firm the nightly
 * check marked „подготвено за заклучување“ for the month — each one re-checked now, `fix` on each firm, one transaction
 * per firm (`zatLock` audit) + the batch audit `autoCloseLockAll`.
 */
export async function lockAllPrepared(ym: string): Promise<ActionState> {
  try {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return { error: 'Неважечки месец.' };
    const u = await requireUser();
    if (u.role !== 'admin' || isDemoUser(u)) return { error: 'Само сопственикот / администраторот.' };
    const ids = (await allowedFirms(u, { year: 'all' })).filter((f) => can(u.principal, 'fix', f.id)).map((f) => f.id);
    const r = await lockPreparedMonths(db(), { ym, userId: u.id, firmIds: ids });
    revalidatePath('/zatvoranje');
    if (!r.locked.length && !r.skipped.length) return { error: 'Нема подготвени фирми за заклучување.' };
    return { ok: `🔒 Заклучени: ${r.locked.length}${r.skipped.length ? ` · прескокнати: ${r.skipped.join('; ')}` : ''}` };
  } catch (e) { return officeError(e); }
}
