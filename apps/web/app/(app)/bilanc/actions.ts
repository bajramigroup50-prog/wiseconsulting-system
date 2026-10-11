'use server';
/** Legacy v425 13681 (`saveFirmPatch({bbAnK})`): which kontos are printed per partner in the analytic trial balance PDF. */
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { audit, firms } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';

export async function saveBbAnKAction(_p: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('settings');
    const v = String(form.get('bbAnK') ?? '').split(/[,;\s]+/).filter((x) => /^\d{1,10}$/.test(x)).join(' ');
    await db().transaction(async (tx) => {
      const [f] = await tx.select({ settings: firms.settings }).from(firms).where(eq(firms.id, firm.id)).limit(1);
      await tx.update(firms).set({ settings: { ...((f?.settings ?? {}) as Record<string, unknown>), bbAnK: v } }).where(eq(firms.id, firm.id));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'bbAnK', entityType: 'firm', entityId: firm.id, data: { bbAnK: v } });
    });
    revalidatePath('/bilanc');
    return { ok: 'Зачувано.' };
  } catch (e) { return actionError(e); }
}
