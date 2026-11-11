'use server';
/**
 * Колеги и известувања: the firms each colleague follows (`respFirms`) and „📨 Прати на колегите“ – every colleague gets,
 * inside WISE, a notice with the open notifications of their own firms (shown when they next open the program).
 */
import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { alSentFor, autopilotFindings, markAlSent, respFirms, saveRespFirms, users, type AlSent } from '@wise/db';
import { requireUser } from '@/lib/auth';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { isUuid, officeError } from '@/lib/office';

async function admin() {
  const u = await requireUser();
  if (u.role !== 'admin' || u.principal.demo) throw new Error('Само администраторот ги распределува фирмите.');
  return u;
}

export async function saveRespAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await admin();
    const userId = String(f.get('userId') ?? '');
    if (!isUuid(userId)) return { error: 'Изберете колега.' };
    const [c] = await db().select({ id: users.id, name: users.name }).from(users).where(and(eq(users.id, userId), eq(users.demo, false))).limit(1);
    if (!c) return { error: 'Колегата не постои.' };
    const ids = f.getAll('f').map(String).filter(isUuid);
    await db().transaction((tx) => saveRespFirms(tx, { userId, firmIds: ids, by: u.id }));
    revalidatePath('/izvestuvanja');
    return { ok: `${c.name}: ${ids.length} фирми.` };
  } catch (e) { return officeError(e); }
}

/** Every colleague with firms gets the count of open notifications (urgent + attention) of their firms. */
export async function sendToColleaguesAction(): Promise<ActionState> {
  try {
    const u = await admin();
    const M = await respFirms(db());
    const ids = Object.keys(M).filter(isUuid);
    if (!ids.length) return { error: 'Прво распределете ги фирмите по колеги.' };
    const U = await db().select({ id: users.id, name: users.name, active: users.active, demo: users.demo }).from(users).where(inArray(users.id, ids));
    const sent: string[] = [];
    for (const c of U) {
      if (!c.active || c.demo || c.id === u.id) continue;
      const F = M[c.id] ?? [];
      if (!F.length) continue;
      const L = await db().select({ lvl: autopilotFindings.lvl }).from(autopilotFindings)
        .where(and(inArray(autopilotFindings.firmId, F), isNull(autopilotFindings.resolvedAt), isNull(autopilotFindings.ackAt)));
      const bad = L.filter((x) => x.lvl === 'bad').length, n = bad + L.filter((x) => x.lvl === 'warn').length;
      await db().transaction((tx) => markAlSent(tx, { userId: c.id, by: u.name, byId: u.id, n, bad }));
      sent.push(`${c.name} (${n})`);
    }
    return sent.length ? { ok: `Испратено: ${sent.join(', ')}.` } : { error: 'Нема колеги со распределени фирми.' };
  } catch (e) { return officeError(e); }
}

/** The last notice sent to the signed-in colleague (for the reminder when WISE opens). */
export async function myAlSent(): Promise<AlSent | null> {
  const u = await requireUser();
  if (u.role === 'klient' || u.role === 'teren') return null;
  return alSentFor(db(), u.id);
}
