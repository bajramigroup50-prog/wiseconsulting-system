'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { INST, isTaskStatus, taskTransition, TEREN_STATUSES, TTYPE, type TaskStatus } from '@wise/core/office';
import { audit, OFFICE_FILE_ENTITY, officeTasks } from '@wise/db';
import { firmAllowed } from '@wise/core';
import { requireCan, type SessionUser } from '@/lib/auth';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { fdate, fv, isUuid, linkFiles, officeError } from '@/lib/office';

const pick = <T extends string>(v: string | null, L: readonly T[], d: T): T => (v && (L as readonly string[]).includes(v) ? (v as T) : d);

/** Legacy `tSave` (ACT_NEED `office`): create or edit a task. */
export async function saveTask(_p: ActionState, f: FormData): Promise<ActionState> {
  let id = fv(f, 'id');
  try {
    const u = await requireCan('office');
    const title = fv(f, 'title');
    if (!title) return { error: 'Внесете наслов.' };
    const firmId = fv(f, 'firmId');
    if (firmId && (!isUuid(firmId) || !firmAllowed(u.principal, firmId))) return { error: 'Немате пристап до фирмата.' };
    const assigneeId = fv(f, 'assigneeId');
    const v = {
      title, type: pick(fv(f, 'type'), TTYPE, 'Друго'), inst: pick(fv(f, 'inst'), INST, 'Друго'),
      firmId: firmId || null, assigneeId: isUuid(assigneeId) ? assigneeId : null, due: fdate(f, 'due'),
      prio: fv(f, 'prio') === 'high' ? 'high' : 'normal', description: fv(f, 'description'),
    };
    await db().transaction(async (tx) => {
      if (id) {
        const [t] = await tx.select().from(officeTasks).where(eq(officeTasks.id, id)).limit(1);
        if (!t) throw new Error('Задачата не постои.');
        const st: TaskStatus = v.assigneeId && t.status === 'new' ? 'assigned' : (t.status as TaskStatus);
        const tr = st !== t.status ? taskTransition(t, st, u.name) : null;
        await tx.update(officeTasks).set({ ...v, ...(tr ?? {}) }).where(eq(officeTasks.id, id));
        await audit(tx, { userId: u.id, firmId: v.firmId, action: 'tSave', entityType: 'office_task', entityId: id, data: { title } });
      } else {
        const st: TaskStatus = v.assigneeId ? 'assigned' : 'new';
        const [t] = await tx.insert(officeTasks).values({ ...v, status: st, createdBy: u.id, hist: taskTransition({ status: 'new', hist: [] }, st, u.name).hist })
          .returning({ id: officeTasks.id });
        id = t!.id;
        await audit(tx, { userId: u.id, firmId: v.firmId, action: 'tNew', entityType: 'office_task', entityId: id, data: { title } });
      }
      await linkFiles(tx, f.getAll('fileIds'), null, OFFICE_FILE_ENTITY.task, id!);
    });
    // TODO(mail): notify the assignee by e-mail (Phase 6 `mail.send`).
  } catch (e) { return officeError(e); }
  revalidatePath('/kanc');
  redirect(`/kanc?t=${id}`);
}

/** Legacy `tSt`: office changes the status. */
export async function setTaskStatus(id: string, st: string, note = ''): Promise<ActionState> {
  try {
    const u = await requireCan('office');
    if (!isTaskStatus(st)) return { error: 'Непознат статус.' };
    await move(u, id, st, note);
  } catch (e) { return officeError(e); }
  revalidatePath('/kanc');
  return { ok: 'Зачувано.' };
}

/** Legacy `tDel`. */
export async function deleteTask(id: string): Promise<ActionState> {
  try {
    const u = await requireCan('office');
    await db().transaction(async (tx) => {
      const [t] = await tx.delete(officeTasks).where(eq(officeTasks.id, id)).returning();
      if (t) await audit(tx, { userId: u.id, firmId: t.firmId, action: 'tDel', entityType: 'office_task', entityId: id, data: { title: t.title } });
    });
  } catch (e) { return officeError(e); }
  revalidatePath('/kanc');
  redirect('/kanc');
}

async function move(u: SessionUser, id: string, st: TaskStatus, note: string, extra: { assigneeId?: string; onlyMine?: boolean; onlyFree?: boolean } = {}) {
  await db().transaction(async (tx) => {
    const [t] = await tx.select().from(officeTasks).where(eq(officeTasks.id, id)).for('update');
    if (!t) throw new Error('Задачата не постои.');
    if (extra.onlyMine && t.assigneeId !== u.id) throw new Error('Задачата не е ваша.');
    if (extra.onlyFree && (t.assigneeId || t.status !== 'new')) throw new Error('Задачата е веќе преземена.');
    const tr = taskTransition(t, st, u.name, note);
    await tx.update(officeTasks).set({ ...tr, ...(extra.assigneeId ? { assigneeId: extra.assigneeId } : {}) }).where(eq(officeTasks.id, id));
    await audit(tx, { userId: u.id, firmId: t.firmId, action: 'tSt', entityType: 'office_task', entityId: id, data: { st, note } });
  });
}

/**
 * Field worker actions (legacy `mzSt/mzTake/mzDone/mzProb`). FIX: legacy had no `ACT_NEED` for them; here they
 * need the `teren` or `office` permission and only work on the user's own (or a free) task.
 */
export async function terenAction(id: string, op: 'take' | 'progress' | 'done' | 'problem', note = ''): Promise<ActionState> {
  try {
    const u = await requireCan('office').catch(() => requireCan('teren'));
    if (op === 'take') await move(u, id, 'progress', 'преземена', { assigneeId: u.id, onlyFree: true });
    else if ((TEREN_STATUSES as readonly string[]).includes(op)) await move(u, id, op as TaskStatus, note, { onlyMine: u.role === 'teren' });
  } catch (e) {
    if (e instanceof Error && /не е ваша|преземена|не постои/.test(e.message)) return { error: e.message };
    return officeError(e);
  }
  revalidatePath('/mojzad');
  return { ok: 'Зачувано.' };
}

/** Field worker attaches scanned documents to the task (legacy `data-up` handler in `mojzad`). */
export async function attachTaskFiles(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await requireCan('office').catch(() => requireCan('teren'));
    const id = fv(f, 'id');
    if (!isUuid(id)) return { error: 'Непозната задача.' };
    await db().transaction(async (tx) => {
      const [t] = await tx.select().from(officeTasks)
        .where(and(eq(officeTasks.id, id), u.role === 'teren' ? eq(officeTasks.assigneeId, u.id) : undefined)).for('update');
      if (!t) throw new Error('Задачата не е ваша.');
      const n = await linkFiles(tx, f.getAll('fileIds'), null, OFFICE_FILE_ENTITY.task, id);
      const received = fv(f, 'received');
      await tx.update(officeTasks).set({
        hist: [...t.hist, { at: new Date().toISOString(), by: u.name, st: t.status, note: `прикачени ${n} документи` }],
        ...(received ? { received } : {}),
      }).where(eq(officeTasks.id, id));
      await audit(tx, { userId: u.id, firmId: t.firmId, action: 'mzUpload', entityType: 'office_task', entityId: id, data: { files: n } });
    });
  } catch (e) {
    if (e instanceof Error && /не е ваша/.test(e.message)) return { error: e.message };
    return officeError(e);
  }
  revalidatePath('/mojzad');
  return { ok: 'Прикачено.' };
}
