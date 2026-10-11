'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { INBOX_ROUTES, type InboxRoute } from '@wise/core/office';
import { audit, clientEntries, decideClientEntry, fileLinks, files, firmMail, firms, inboxItems, OFFICE_FILE_ENTITY, routeInboxFiles, textMailHtml } from '@wise/db';
import { dispatchAiReads, queueAiReads } from '@/lib/ai';
import { selectFirm } from '@/app/(app)/actions';
import { requireCan } from '@/lib/auth';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { dispatchMail, queueMail } from '@/lib/mail';
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
    const r = await db().transaction((tx) => decideClientEntry(tx, id, e.firmId, decision, u.id, note));
    await dispatchMail(r.mailIds); // the client is notified by e-mail (after COMMIT; `mail.flush` retries)
  } catch (e) { return officeError(e); }
  revalidatePath('/klInbox');
  return { ok: decision === 'approve' ? 'Одобрено и прокнижено.' : 'Документот е одбиен; клиентот ќе ја види причината.' };
}

/**
 * Legacy `irGo` → `irRoute` (14030 / 14024): send one file (`fileIdx`, upload order) or all files (`null`) of a
 * client message to the module that books it (`@wise/db` `routeInboxFiles`): purchases / issued invoices are queued
 * for AI reading and reviewed in the scan screen, the rest is archived in the dossier under the route's category.
 * Switches the working firm to the message's firm and returns the screen to continue in (`go`).
 * This is the routing boundary: an automatic classification first decides `kind`, then calls this.
 */
export async function routeInboxFile(docId: string, fileIdx: number | null, kind: InboxRoute, category?: string | null): Promise<ActionState & { go?: string | null }> {
  try {
    if (!isUuid(docId)) return { error: 'Непозната порака.' };
    if (!(kind in INBOX_ROUTES)) return { error: 'Непозната цел.' };
    if (fileIdx != null && !(Number.isInteger(fileIdx) && fileIdx >= 0)) return { error: 'Непознат документ.' };
    const [i] = await db().select({ firmId: inboxItems.firmId }).from(inboxItems).where(eq(inboxItems.id, docId)).limit(1);
    if (!i) return { error: 'Пораката не постои.' };
    const u = await requireCan('office', i.firmId);
    const r = await db().transaction((tx) => routeInboxFiles(tx, { itemId: docId, firmId: i.firmId, fileIdx, kind, category, userId: u.id }));
    await dispatchAiReads(r.aiDocIds);
    if (r.go) await selectFirm(i.firmId);
    revalidatePath('/klInbox');
    const what = INBOX_ROUTES[kind];
    return {
      ok: `→ ${what}${r.aiDocIds.length ? `: се читаат ${r.aiDocIds.length} документи` : r.ref ? ': зачувано во досие' : ''}${r.skipped.length ? ` (прескокнато: ${r.skipped.join('; ')})` : ''}.`,
      go: r.go,
    };
  } catch (e) { return officeError(e); }
}

/**
 * Legacy `irGo` with kind `auto` → `irClassify` (14029): read the message's first file with the classification
 * prompt (worker `ai.read-document`, kind `classify`). The client polls the read (`aiReadStatus`), maps it with
 * `inboxClassification` and then calls {@link routeInboxFile} with the detected route.
 */
export async function classifyInbox(docId: string): Promise<{ id?: string; error?: string }> {
  try {
    if (!isUuid(docId)) return { error: 'Непозната порака.' };
    const [i] = await db().select({ firmId: inboxItems.firmId }).from(inboxItems).where(eq(inboxItems.id, docId)).limit(1);
    if (!i) return { error: 'Пораката не постои.' };
    const u = await requireCan('office', i.firmId);
    const [f] = await db().select({ id: files.id }).from(fileLinks).innerJoin(files, eq(files.id, fileLinks.fileId))
      .where(and(eq(fileLinks.entityType, OFFICE_FILE_ENTITY.inbox), eq(fileLinks.entityId, docId), eq(files.status, 'ready')))
      .orderBy(asc(files.createdAt), asc(files.name)).limit(1);
    if (!f) return { error: 'Пораката нема прикачен документ.' };
    const ids = await db().transaction(async (tx) => {
      const ids = await queueAiReads(tx, { firmId: i.firmId, userId: u.id, kind: 'classify', fileIds: [f.id], options: { inboxId: docId } });
      await audit(tx, { userId: u.id, firmId: i.firmId, action: 'aiRead', entityType: 'inbox_item', entityId: docId, data: { kind: 'classify' } });
      return ids;
    });
    await dispatchAiReads(ids);
    return { id: ids[0] };
  } catch (e) { return officeError(e); }
}

/** Legacy `ainbDone` / `irGo` from the message card: mark handled, or route the files and open the target screen. */
export async function routeInbox(_p: ActionState, f: FormData): Promise<ActionState> {
  let go: string | null | undefined;
  try {
    const id = fv(f, 'id');
    if (!isUuid(id)) return { error: 'Непозната порака.' };
    const route = fv(f, 'route') as InboxRoute | null;
    if (route) {
      const fi = fv(f, 'fileIdx');
      const r = await routeInboxFile(id, fi == null ? null : Number(fi), route, fv(f, 'category'));
      if (r.error) return r;
      go = r.go;
      if (!go) return { ok: r.ok };
    } else {
      const [i] = await db().select().from(inboxItems).where(eq(inboxItems.id, id)).limit(1);
      if (!i) return { error: 'Пораката не постои.' };
      const u = await requireCan('office', i.firmId);
      await db().transaction(async (tx) => {
        await tx.update(inboxItems).set({ done: true, doneBy: u.id, doneAt: new Date() }).where(eq(inboxItems.id, i.id));
        await audit(tx, { userId: u.id, firmId: i.firmId, action: 'ainbDone', entityType: 'inbox_item', entityId: i.id });
      });
    }
  } catch (e) { return officeError(e); }
  revalidatePath('/klInbox');
  if (go) redirect(go);
  return { ok: 'Обработено.' };
}

/** Legacy `klMsg`: the office writes to the client (portal message) and, when the firm has an e-mail, also by e-mail. */
export async function replyToClient(_p: ActionState, f: FormData): Promise<ActionState> {
  let mailed = false;
  try {
    const firmId = fv(f, 'firmId');
    if (!isUuid(firmId)) return { error: 'Изберете фирма.' };
    const u = await requireCan('office', firmId);
    const note = fv(f, 'note');
    if (!note) return { error: 'Напишете порака.' };
    const subject = fv(f, 'subject');
    const ids = await db().transaction(async (tx) => {
      const [m] = await tx.insert(inboxItems).values({ firmId, fromOffice: true, done: true, subject, note, fromUserId: u.id, fromName: u.name })
        .returning({ id: inboxItems.id });
      const to = await firmMail(tx, firmId);
      const [fm] = await tx.select({ name: firms.name }).from(firms).where(eq(firms.id, firmId)).limit(1);
      const ids = to ? [await queueMail(tx, {
        firmId, to, subject: subject || `Порака од сметководствената канцеларија – ${fm?.name ?? ''}`, html: textMailHtml(note),
        entityType: 'inbox_item', entityId: m!.id, userId: u.id,
      })] : [];
      await audit(tx, { userId: u.id, firmId, action: 'klMsg', entityType: 'inbox_item', entityId: m!.id, data: { mail: !!to } });
      return ids;
    });
    mailed = ids.length > 0;
    await dispatchMail(ids);
  } catch (e) { return officeError(e); }
  revalidatePath('/klInbox');
  return { ok: mailed ? 'Пораката е испратена во порталот и по е-пошта.' : 'Пораката е испратена во порталот (фирмата нема е-пошта).' };
}
