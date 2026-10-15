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
import { audit, markRok, patchOfficeProfile, rokWindow, syncRokovi } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { allowedFirms, officeError, officeGlobal, officeGlobalSide, today } from '@/lib/office';
import { refuseDemo } from '@/lib/demo';

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
