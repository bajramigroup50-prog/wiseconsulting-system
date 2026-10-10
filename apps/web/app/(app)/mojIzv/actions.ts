'use server';
import { revalidatePath } from 'next/cache';
import { appSettings, audit } from '@wise/db';
import { Forbidden, requireCan } from '@/lib/auth';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { OWNER_KEY, reportOwner } from './data';

/** Legacy `miClaim`: an administrator links the report to their own profile once; nobody else can open it afterwards. */
export async function claimReport(): Promise<ActionState> {
  try {
    const u = await requireCan('users');
    if (u.role !== 'admin') return { error: 'Само администратор.' };
    const ok = await db().transaction(async (tx) => {
      if (await reportOwner()) return false;
      const v = { id: u.id, name: u.name, at: new Date().toISOString() };
      const r = await tx.insert(appSettings).values({ key: OWNER_KEY, value: v, updatedBy: u.id }).onConflictDoNothing().returning({ k: appSettings.key });
      if (!r.length) return false;
      await audit(tx, { userId: u.id, action: 'miClaim', entityType: 'app_settings', entityId: OWNER_KEY });
      return true;
    });
    revalidatePath('/mojIzv');
    return ok ? { ok: '🔒 Извештајот сега е само ваш.' } : { error: 'Извештајот веќе е поврзан со друг профил.' };
  } catch (e) {
    if (e instanceof Forbidden) return { error: e.message };
    throw e;
  }
}
