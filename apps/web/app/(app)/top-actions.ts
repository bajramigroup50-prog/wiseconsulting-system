'use server';
/** Top bar / dashboard actions: client message „✓ Обработено“ (legacy `ainbDone`), notification list for the
 * daily reminder (legacy `alStartup`) and „✉ Испрати“ of the notifications (legacy `alMail`, now through the mail queue). */
import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { alMailBody, type AlItem } from '@wise/core/firms/picker';
import { audit, autopilotFindings, inboxItems } from '@wise/db';
import { requireCan, requireUser } from '@/lib/auth';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { dispatchMail, queueMail, validAddresses } from '@/lib/mail';
import { allowedFirms, isUuid, officeError, today } from '@/lib/office';

/** Legacy `ACT.ainbDone`: mark a client message handled. */
export async function ainbDone(id: string): Promise<ActionState> {
  try {
    if (!isUuid(id)) return { error: 'Непозната порака.' };
    const [i] = await db().select({ firmId: inboxItems.firmId }).from(inboxItems).where(eq(inboxItems.id, id)).limit(1);
    if (!i) return { error: 'Пораката не постои.' };
    const u = await requireCan('office', i.firmId);
    await db().transaction(async (tx) => {
      await tx.update(inboxItems).set({ done: true, doneBy: u.id, doneAt: new Date() }).where(eq(inboxItems.id, id));
      await audit(tx, { userId: u.id, firmId: i.firmId, action: 'ainbDone', entityType: 'inbox_item', entityId: id });
    });
    revalidatePath('/', 'layout');
    return { ok: 'Означено како обработено.' };
  } catch (e) { return officeError(e); }
}

/** Open (unacknowledged) notifications of the user's firms, for the reminder window / voice / e-mail. */
export async function alertItems(): Promise<(AlItem & { fid: string })[]> {
  const u = await requireUser();
  if (u.role === 'klient' || u.role === 'teren') return [];
  const F = await allowedFirms(u);
  if (!F.length) return [];
  const N = new Map(F.map((f) => [f.id, f.name]));
  const L = await db().select({ f: autopilotFindings.firmId, lvl: autopilotFindings.lvl, txt: autopilotFindings.txt }).from(autopilotFindings)
    .where(and(inArray(autopilotFindings.firmId, F.map((f) => f.id)), isNull(autopilotFindings.resolvedAt), isNull(autopilotFindings.ackAt)));
  const o = { bad: 0, warn: 1, info: 2 } as Record<string, number>;
  return L.map((x) => ({ fid: x.f, firm: N.get(x.f) ?? '', lvl: (x.lvl as AlItem['lvl']), txt: x.txt })).sort((a, b) => (o[a.lvl] ?? 3) - (o[b.lvl] ?? 3));
}

/** Legacy `alMailNow` / the daily automatic reminder: the notification summary by e-mail. */
export async function mailAlerts(to: string, auto = false): Promise<ActionState> {
  try {
    const u = await requireCan('office');
    if (!validAddresses(to)) return { error: 'Внесете е-пошта.' };
    const I = await alertItems();
    const td = today();
    const m = alMailBody(I, td.split('-').reverse().join('.'), auto);
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const id = await db().transaction(async (tx) => {
      const id = await queueMail(tx, { firmId: null, to, subject: m.subject, html: `<pre style="font-family:inherit;white-space:pre-wrap">${esc(m.body)}</pre>`, entityType: 'alerts', userId: u.id });
      await audit(tx, { userId: u.id, action: 'alMail', entityType: 'mail_log', entityId: id, data: { to, auto, n: I.length } });
      return id;
    });
    const d = await dispatchMail([id]);
    return { ok: `Испратено на ${to}${d.deferred ? ' (ќе замине за неколку минути)' : ''}.` };
  } catch (e) { return officeError(e); }
}
