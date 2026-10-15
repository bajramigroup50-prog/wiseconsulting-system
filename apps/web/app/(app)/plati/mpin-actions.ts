'use server';
/**
 * Delete a month's accepted МПИН of one firm (legacy `mpinDel`, administrator only → `del`). Shared by „Плати“ (the
 * selected firm) and „МПИН од УЈП (сите фирми)“; in the payroll folder so a 🔒 book-only colleague keeps it on „Плати“.
 */
import { revalidatePath } from 'next/cache';
import { mpinPeriodOk } from '@wise/core/law';
import { deleteMpinAck, MpinError, PostingError } from '@wise/db';
import { Forbidden, requireCan } from '@/lib/auth';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { isUuid } from '@/lib/office';

export async function deleteMpinMonth(firmId: string, month: string): Promise<ActionState> {
  try {
    if (!isUuid(firmId) || !mpinPeriodOk(month)) return { error: 'Неважечки податоци.' };
    const u = await requireCan('del', firmId);
    // Legacy `mpinAdm()`: only the administrator deletes an accepted MPIN (for a correction).
    if (u.role !== 'admin') return { error: 'Бришењето е дозволено само за администраторот.' };
    const r = await db().transaction((tx) => deleteMpinAck(tx, { firmId, month, userId: u.id }));
    revalidatePath('/mpinIn');
    revalidatePath('/plati');
    return { ok: `МПИН за ${month} е избришан${r.journal ? ' (и налогот)' : ''}. Сега може да прикачите друг.` };
  } catch (e) {
    if (e instanceof MpinError || e instanceof Forbidden || e instanceof PostingError) return { error: e.message };
    throw e;
  }
}
