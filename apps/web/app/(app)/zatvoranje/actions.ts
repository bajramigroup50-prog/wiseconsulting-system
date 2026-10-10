'use server';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { zatMonthEnd } from '@wise/core/firms/zatvoranje';
import { audit, firms } from '@wise/db';
import { requireCan } from '@/lib/auth';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { officeError } from '@/lib/office';

/** Legacy `zatLock` (ACT_NEED `fix`): lock the firm's books up to the end of the month (never moves the lock back). */
export async function lockMonth(firmId: string, ym: string): Promise<ActionState> {
  try {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return { error: 'Неважечки месец.' };
    const u = await requireCan('fix', firmId);
    const me = zatMonthEnd(ym);
    const r = await db().transaction(async (tx) => {
      const [f] = await tx.select({ name: firms.name, lock: firms.lockDate }).from(firms).where(eq(firms.id, firmId)).for('update').limit(1);
      if (!f) return { error: 'Фирмата не постои.' };
      if (f.lock && f.lock >= me) return { error: `Фирмата е веќе заклучена до ${f.lock.split('-').reverse().join('.')}.` };
      await tx.update(firms).set({ lockDate: me }).where(eq(firms.id, firmId));
      await audit(tx, { userId: u.id, firmId, action: 'zatLock', entityType: 'firm', entityId: firmId, data: { lockDate: me, before: f.lock } });
      return { ok: `${f.name}: заклучено до ${me.split('-').reverse().join('.')}.` };
    });
    revalidatePath('/zatvoranje');
    return r;
  } catch (e) { return officeError(e); }
}
