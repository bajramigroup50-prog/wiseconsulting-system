'use server';
/**
 * Legacy `ACT.npoPlan` 10485 (ACT_NEED settings): add the three-digit NPO accounts (Сл. весник 117/05) to the firm's
 * chart, merge the NPO posting schemes into the firm's schemes and mark the firm as an NPO. Existing postings stay.
 */
import { revalidatePath } from 'next/cache';
import { NPO_ACC, NPO_SCH } from '@wise/core/yearend/npo';
import { accounts, audit } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { patchFirmSettings } from '@/lib/firms-office';

export async function npoPlanAction(): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('settings');
    const s = (firm.settings ?? {}) as { accounts?: Record<string, unknown>; sch?: Record<string, unknown> };
    await db().transaction(async (tx) => {
      const acc: Record<string, unknown> = { ...(s.accounts ?? {}) };
      for (const [k, n] of NPO_ACC) acc[k] = { mk: n };
      await tx.insert(accounts).values(NPO_ACC.map(([code, name]) => ({ firmId: firm.id, code, name }))).onConflictDoNothing();
      await patchFirmSettings(tx, firm.id, { accounts: acc, sch: { ...(s.sch ?? {}), ...NPO_SCH }, ent: 'npo' });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'npoPlan', entityType: 'firm', entityId: firm.id, data: { accounts: NPO_ACC.length } });
    });
    revalidatePath('/', 'layout');
    return { ok: 'Сметковниот план за НПО е применет.' };
  } catch (e) { return actionError(e); }
}
