'use server';
/**
 * „📅 Календар на рокови“ actions: mark done / open, refresh the deadlines of a month for the user's firms, and the
 * reminder settings (office profile `rok`). All need `office`; every change is audited.
 * 🎭 A demo user works on the demo firms only (`allowedFirms` by side, `officeGlobalSide`); the reminder settings
 * (e-mails to colleagues / clients) are off for it.
 */
import { revalidatePath } from 'next/cache';
import { addDays } from '@wise/core/office';
import { rokYmAdd, type RokSettings } from '@wise/core/office/rokovi';
import {
  audit, markRok, OfficeError, patchOfficeProfile, rokCleanup, rokCleanupCount, rokCleanupUndo, rokMyFirmIds, rokScopeSet, rokWindow, syncRokovi,
} from '@wise/db';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { allowedFirms, officeError, officeGlobal, officeGlobalSide, today } from '@/lib/office';
import { refuseDemo } from '@/lib/demo';
import { ownerContext } from '@/lib/demo-office';
import { rokScopeMine } from '@/lib/rokovi';

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function markRokAction(id: string, done: boolean): Promise<ActionState> {
  try {
    const u = await officeGlobalSide('office');
    const ids = new Set((await allowedFirms(u)).map((f) => f.id));
    await db().transaction((tx) => markRok(tx, { id: String(id), done: !!done, userId: u.id, firmAllowed: (f) => ids.has(f) }));
    revalidatePath('/rokovi');
    return { ok: done ? 'Означено како направено.' : 'Вратено како отворено.' };
  } catch (e) { return officeError(e); }
}

/** Regenerate the deadlines of the month `ym` (and the worker's window) for the firms the user may open. */
export async function syncRokAction(ym: string): Promise<ActionState> {
  try {
    const u = await officeGlobalSide('office');
    const F = await allowedFirms(u);
    const w = rokWindow(today());
    const m = YM.test(ym) ? ym : today().slice(0, 7);
    const from = `${m}-01` < w.from ? `${m}-01` : w.from;
    const end = addDays(`${rokYmAdd(m, 1)}-01`, -1);
    const to = end > w.to ? end : w.to;
    const r = await db().transaction(async (tx) => {
      const x = await syncRokovi(tx, { from, to, firmIds: F.map((f) => f.id) });
      await audit(tx, { userId: u.id, firmId: null, action: 'rokSync', entityType: 'rok', data: { from, to, ...x } });
      return x;
    });
    revalidatePath('/rokovi');
    return { ok: `Освежено: ${r.rows} рокови за ${r.firms} фирми${r.autoDone ? ` · автоматски направени ${r.autoDone}` : ''}.` };
  } catch (e) { return officeError(e); }
}

/** „Само мои фирми / Сите фирми“ — remembered per user (the list and the 📅 counter). */
export async function setRokScopeAction(mine: boolean): Promise<ActionState> {
  try {
    const u = await officeGlobalSide('office');
    await rokScopeSet(db(), u.id, !!mine);
    revalidatePath('/', 'layout');
    return { ok: mine ? 'Само мои фирми.' : 'Сите фирми.' };
  } catch (e) { return officeError(e); }
}

const D = /^\d{4}-\d{2}-\d{2}$/;

/** The clean-up is for the owner / an administrator; on the firms of the user's scope (🎭 a demo user: demo firms only). */
async function cleanupCtx() {
  const u = await officeGlobalSide('office');
  const owner = !!(await ownerContext(u).catch(() => null));
  if (u.role !== 'admin' && !owner) throw new OfficeError('Само за сопственикот или администраторот.');
  const all = (await allowedFirms(u)).map((f) => f.id);
  const ids = (await rokScopeMine(u, owner)) ? await rokMyFirmIds(db(), u.id, all) : all;
  return { u, owner, ids, all };
}

/** Confirm text of „Означи ги минатите како направени“: how many open deadlines before the date. */
export async function rokCleanupPreview(before: string): Promise<{ n: number; error?: string }> {
  try {
    if (!D.test(before)) return { n: 0, error: 'Внесете датум.' };
    const c = await cleanupCtx();
    return { n: await rokCleanupCount(db(), { firmIds: c.ids, before, kdog: c.owner }) };
  } catch (e) { return { n: 0, error: officeError(e).error }; }
}

export async function rokCleanupAction(before: string): Promise<ActionState> {
  try {
    if (!D.test(before)) return { error: 'Внесете датум.' };
    if (before > today()) return { error: 'Датумот не може да биде во иднина.' };
    const c = await cleanupCtx();
    const r = await db().transaction((tx) => rokCleanup(tx, { firmIds: c.ids, before, kdog: c.owner, userId: c.u.id }));
    revalidatePath('/', 'layout');
    return { ok: `Означени како направени: ${r.n} рокови пред ${before.split('-').reverse().join('.')}.` };
  } catch (e) { return officeError(e); }
}

export async function rokCleanupUndoAction(): Promise<ActionState> {
  try {
    const c = await cleanupCtx();
    const r = await db().transaction((tx) => rokCleanupUndo(tx, { firmIds: c.all, userId: c.u.id }));
    revalidatePath('/', 'layout');
    return r.n ? { ok: `Вратени како отворени: ${r.n} рокови.` } : { error: 'Нема чистење за враќање.' };
  } catch (e) { return officeError(e); }
}

export async function saveRokSettings(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    await refuseDemo(undefined, 'rokSettings');
    const u = await officeGlobal('office');
    const n = (k: string, d: number, lo: number, hi: number) => { const v = Math.round(Number(f.get(k))); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
    const rok: RokSettings = {
      days: n('days', 5, 0, 60), mail: f.get('mail') === 'on',
      client: { on: f.get('clOn') === 'on', day: n('clDay', 3, 1, 28), portal: f.get('clPortal') === 'on', mail: f.get('clMail') === 'on' },
    };
    await db().transaction(async (tx) => {
      await patchOfficeProfile(tx, { rok }, u.id);
      await audit(tx, { userId: u.id, firmId: null, action: 'rokSettings', entityType: 'app_settings', entityId: 'office', data: { ...rok } });
    });
    revalidatePath('/rokovi');
    return { ok: 'Поставките за потсетниците се зачувани.' };
  } catch (e) { return officeError(e); }
}
