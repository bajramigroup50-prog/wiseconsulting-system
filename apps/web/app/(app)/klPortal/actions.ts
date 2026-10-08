'use server';
import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { KL_PROF, KL_SEC } from '@wise/core/office';
import { audit, firms } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { officeAction, officeError } from '@/lib/office';

/** Save `firm.settings.kl` with a jsonb merge (only the `kl` key changes — other settings are untouched). */
export async function savePortal(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    const sel = new Set(f.getAll('on').map(String));
    const on = Object.fromEntries(KL_SEC.map((s) => [s[0], sel.has(s[0])]));
    const prof = f.getAll('prof').map(String).filter((p) => KL_PROF.some(([k]) => k === p));
    const kl = JSON.stringify({ on, prof });
    await db().transaction(async (tx) => {
      await tx.update(firms).set({ settings: sql`${firms.settings} || jsonb_build_object('kl', ${kl}::jsonb)` }).where(eq(firms.id, firm.id));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'klSave', entityType: 'firm', entityId: firm.id, data: { on: [...sel], prof } });
    });
    revalidatePath('/klPortal');
    return { ok: 'Зачувано.' };
  } catch (e) { return officeError(e); }
}
