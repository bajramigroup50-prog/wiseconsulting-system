'use server';
/**
 * ⚖️ Законски промени — legacy `ACT.lawSeenAll`, `ACT.lawDel` (administrator → `del`), `ACT.lawAsk` (answered by the
 * worker job `law.ask`) and a manual run of the daily robot (`settings`). Every mutation writes `audit_log`.
 */
import { revalidatePath } from 'next/cache';
import { desc, eq } from 'drizzle-orm';
import { audit, lawAsks, lawChanges, lawSeen } from '@wise/db';
import { Forbidden, requireCan, requireUser } from '@/lib/auth';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/jobs';
import { isUuid } from '@/lib/office';

const err = (e: unknown): ActionState => { if (e instanceof Forbidden) return { error: e.message }; throw e; };

/** Mark everything as read (legacy `lk_lawSeen` = newest `at`). */
export async function lawSeenAll(): Promise<ActionState> {
  try {
    // a per-user reading mark (legacy localStorage): every office role, incl. `view`
    const u = await requireUser();
    if (u.role === 'klient' || u.role === 'teren') throw new Forbidden('lawSeenAll');
    const [x] = await db().select({ at: lawChanges.createdAt }).from(lawChanges).orderBy(desc(lawChanges.createdAt)).limit(1);
    const at = x?.at ?? new Date();
    await db().transaction(async (tx) => {
      await tx.insert(lawSeen).values({ userId: u.id, seenAt: at }).onConflictDoUpdate({ target: lawSeen.userId, set: { seenAt: at } });
      await audit(tx, { userId: u.id, action: 'lawSeenAll', entityType: 'law_change' });
    });
    revalidatePath('/zakoni');
    revalidatePath('/');
    return {};
  } catch (e) { return err(e); }
}

export async function lawDelete(id: string): Promise<ActionState> {
  try {
    if (!isUuid(id)) return { error: 'Непознат запис.' };
    const u = await requireCan('del');
    await db().transaction(async (tx) => {
      const [x] = await tx.delete(lawChanges).where(eq(lawChanges.id, id)).returning({ title: lawChanges.title });
      if (x) await audit(tx, { userId: u.id, action: 'lawDel', entityType: 'law_change', entityId: id, data: { title: x.title } });
    });
    revalidatePath('/zakoni');
    return {};
  } catch (e) { return err(e); }
}

export async function lawAskStart(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await requireCan('office');
    const q = String(f.get('q') ?? '').trim().slice(0, 2000);
    if (!q) return { error: 'Внесете прашање.' };
    const id = await db().transaction(async (tx) => {
      const [r] = await tx.insert(lawAsks).values({ userId: u.id, question: q }).returning({ id: lawAsks.id });
      await audit(tx, { userId: u.id, action: 'lawAsk', entityType: 'law_ask', entityId: r!.id });
      return r!.id;
    });
    await enqueue('law.ask', { id });
    revalidatePath('/zakoni');
    return { ok: '⏳ Се бара одговор…' };
  } catch (e) { return err(e); }
}

/** Run the robot now (otherwise daily at 06:52). */
export async function lawRunNow(): Promise<ActionState> {
  try {
    const u = await requireCan('settings');
    await db().transaction((tx) => audit(tx, { userId: u.id, action: 'lawRobotRun', entityType: 'law_run' }));
    await enqueue('law.robot', {});
    return { ok: 'Роботот е пуштен – новите записи ќе се појават за неколку минути.' };
  } catch (e) { return err(e); }
}
