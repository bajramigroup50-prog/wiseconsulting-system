'use server';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { DOS_CAT, INBOX_ROUTES, type InboxRoute } from '@wise/core/office';
import { audit, clientEntries, decideClientEntry, dossierDocs, inboxItems, OFFICE_FILE_ENTITY, relinkFiles } from '@wise/db';
import { requireCan } from '@/lib/auth';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { fv, isUuid, officeError } from '@/lib/office';

/**
 * Legacy `klAppr` / `klRej` (9141 / 9143). FIX(#1): legacy let a client trigger these (only the UI hid them);
 * here the office permission is checked server-side against the entry's own firm.
 */
export async function decideEntry(id: string, decision: 'approve' | 'reject', note?: string): Promise<ActionState> {
  try {
    if (!isUuid(id)) return { error: 'Непознат запис.' };
    const [e] = await db().select({ firmId: clientEntries.firmId }).from(clientEntries).where(eq(clientEntries.id, id)).limit(1);
    if (!e) return { error: 'Записот не постои.' };
    const u = await requireCan('office', e.firmId);
    await db().transaction((tx) => decideClientEntry(tx, id, e.firmId, decision, u.id, note));
  } catch (e) { return officeError(e); }
  revalidatePath('/klInbox');
  return { ok: decision === 'approve' ? 'Одобрено.' : 'Одбиено.' };
}

/**
 * Legacy `irGo` / `ainbDone` (14004, 14030): mark a client message handled and record where it was routed.
 * Routing to the dossier creates the dossier document with the message's files; other targets are recorded
 * for the module that books them. TODO(merge): Phase 3 (purchase/sale), 4 (bank/cash), 6 (payroll/employee),
 * 7 (fisk/stock) — open the target editor prefilled with the files. TODO(ai): classify the file (legacy
 * `irClassify` 14044) through Phase 3's AI job.
 */
export async function routeInbox(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const id = fv(f, 'id');
    if (!isUuid(id)) return { error: 'Непозната порака.' };
    const [i] = await db().select().from(inboxItems).where(eq(inboxItems.id, id)).limit(1);
    if (!i) return { error: 'Пораката не постои.' };
    const u = await requireCan('office', i.firmId);
    const route = fv(f, 'route') as InboxRoute | null;
    if (route && !(route in INBOX_ROUTES)) return { error: 'Непозната цел.' };
    await db().transaction(async (tx) => {
      let ref: string | null = null;
      if (route === 'dossier') {
        const cat = fv(f, 'category');
        const [d] = await tx.insert(dossierDocs).values({
          firmId: i.firmId, category: cat && (DOS_CAT as readonly string[]).includes(cat) ? cat : 'Друго',
          title: i.subject ?? i.note?.slice(0, 80) ?? null, date: i.createdAt.toISOString().slice(0, 10), fromInboxId: i.id, createdBy: u.id,
        }).returning({ id: dossierDocs.id });
        await relinkFiles(tx, OFFICE_FILE_ENTITY.inbox, i.id, OFFICE_FILE_ENTITY.dossier, d!.id);
        ref = `dossier_doc:${d!.id}`;
      }
      await tx.update(inboxItems).set({ done: true, doneBy: u.id, doneAt: new Date(), route, routeRef: ref }).where(eq(inboxItems.id, i.id));
      await audit(tx, { userId: u.id, firmId: i.firmId, action: route ? 'irGo' : 'ainbDone', entityType: 'inbox_item', entityId: i.id, data: { route, ref } });
    });
  } catch (e) { return officeError(e); }
  revalidatePath('/klInbox');
  return { ok: 'Обработено.' };
}

/** Legacy `klMsg`: the office writes to the client (portal message). TODO(mail): also e-mail the client. */
export async function replyToClient(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const firmId = fv(f, 'firmId');
    if (!isUuid(firmId)) return { error: 'Изберете фирма.' };
    const u = await requireCan('office', firmId);
    const note = fv(f, 'note');
    if (!note) return { error: 'Напишете порака.' };
    await db().transaction(async (tx) => {
      const [m] = await tx.insert(inboxItems).values({ firmId, fromOffice: true, done: true, subject: fv(f, 'subject'), note, fromUserId: u.id, fromName: u.name })
        .returning({ id: inboxItems.id });
      await audit(tx, { userId: u.id, firmId, action: 'klMsg', entityType: 'inbox_item', entityId: m!.id });
    });
  } catch (e) { return officeError(e); }
  revalidatePath('/klInbox');
  return { ok: 'Пораката е испратена во порталот.' };
}
