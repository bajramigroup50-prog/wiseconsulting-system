'use server';
/**
 * „📥 Пристигнати документи“ (UX P7 / P32) — the inbox's actions. Every action re-checks the firm of the ROW (never
 * the form): `write` on the firm it acts in (`office` for the client's portal messages, like /klInbox); an
 * office-wide row (no firm) only for the owner / unrestricted admins (`lib/incoming-scope.ts`).
 */
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { INBOX_ROUTES, INCOMING_JOB, type InboxRoute } from '@wise/core/office';
import { addIncoming, assignIncomingFirm, audit, inboxItems, incomingDocs, routeIncoming, routeInboxFiles, skipIncoming } from '@wise/db';
import { requireCan, requireUser, type SessionUser } from '@/lib/auth';
import { currentFirm } from '@/lib/context';
import { db } from '@/lib/db';
import { dispatchAiReads, queueAiReads } from '@/lib/ai';
import { enqueue } from '@/lib/jobs';
import { isUuid, officeError } from '@/lib/office';
import { isOfficeOwner } from '@/lib/office-owner';
import { viewsOf } from '@/lib/view-access';
import { inboxScope } from '@/lib/incoming-scope';
import { selectFirm } from '@/app/(app)/actions';
import type { ActionState } from '@/lib/books';

const P = '/prist';

/** May this user handle office-wide rows (no firm)? */
async function officeOk(u: SessionUser): Promise<boolean> {
  return inboxScope(u, { firmIds: [], restricted: await viewsOf(db(), u), owner: await isOfficeOwner(u) }).office;
}

/** The row, with the permission checked for its firm (`write`) or, office-wide, the owner / admin rule. */
async function rowFor(id: string) {
  if (!isUuid(id)) throw new Error('Непознат документ.');
  const [r] = await db().select().from(incomingDocs).where(eq(incomingDocs.id, id)).limit(1);
  if (!r) throw new Error('Документот не постои.');
  if (r.firmId) return { r, u: await requireCan('write', r.firmId) };
  const u = await requireUser();
  if (!(await officeOk(u))) throw new Error('Само за сопственикот / администраторот.');
  return { r, u };
}

const err = (e: unknown): ActionState => {
  if (e instanceof Error && !('digest' in e) && /^(Непознат|Документот|Само за|Изберете|Датотеката|Немате)/.test(e.message)) return { error: e.message };
  return officeError(e);
};

/** Files uploaded in the inbox (`<Uvoz>`): into the selected firm, or office-wide when no firm is selected. */
export async function addIncomingAction(fileIds: string[]): Promise<ActionState & { ids?: string[] }> {
  try {
    const ids0 = fileIds.filter(isUuid).slice(0, 100);
    if (!ids0.length) return { error: 'Нема прикачени датотеки.' };
    const u0 = await requireUser();
    const firm = await currentFirm(u0);
    if (!firm && !(await officeOk(u0))) return { error: 'Изберете фирма.' };
    const u = firm ? await requireCan('write', firm.id) : u0;
    const ids = await db().transaction((tx) => addIncoming(tx, { firmId: firm?.id ?? null, fileIds: ids0, userId: u.id }));
    for (const id of ids) await enqueue(INCOMING_JOB, { id });
    revalidatePath(P);
    return { ok: `Примени ${ids.length} документи – се препознаваат.`, ids };
  } catch (e) { return err(e); }
}

/**
 * One click: a purchase / issued invoice → the scan review (`/skan`, the multi-invoice split included), МПИН → the
 * МПИН list, decisions / contracts / other → the dossier; `bank` → the statement import into the row's firm (the job,
 * with the reconciliation and duplicate checks). Switches the working firm and returns where to continue.
 */
export async function routeIncomingAction(id: string, route: InboxRoute, category?: string | null): Promise<ActionState & { go?: string | null }> {
  try {
    if (!(route in INBOX_ROUTES)) return { error: 'Непозната цел.' };
    const { r, u } = await rowFor(id);
    if (!r.firmId) return { error: 'Изберете ја фирмата на документот („→ Фирма“).' };
    if (route === 'bank') {
      await enqueue(INCOMING_JOB, { id, firmId: r.firmId });
      revalidatePath(P);
      return { ok: 'Изводот се увезува во налогот за неговиот период…' };
    }
    const x = await db().transaction((tx) => routeIncoming(tx, { id, firmId: r.firmId!, route, category, userId: u.id }));
    await dispatchAiReads(x.aiDocIds);
    for (const rowId of x.mpinRowIds) await enqueue('mpin.read', { rowId });
    if (x.go) await selectFirm(r.firmId);
    revalidatePath(P);
    return { ok: `→ ${INBOX_ROUTES[route]}${x.aiDocIds.length ? ': се чита (бесплатно прво)' : ''}.`, go: x.go };
  } catch (e) { return err(e); }
}

/** „Увези во <фирма>“ (a proposed firm) or „→ Фирма“: the file moves to that firm; a statement is then imported there. */
export async function assignIncomingAction(id: string, to: string, importBank = false): Promise<ActionState> {
  try {
    if (!isUuid(to)) return { error: 'Изберете фирма.' };
    const { r, u } = await rowFor(id);
    await requireCan('write', to);
    if (r.firmId !== to) await db().transaction((tx) => assignIncomingFirm(tx, { id, from: r.firmId, to, userId: u.id }));
    await enqueue(INCOMING_JOB, importBank ? { id, firmId: to } : { id });
    revalidatePath(P);
    return { ok: importBank ? 'Изводот се увезува…' : 'Документот е преместен во фирмата.' };
  } catch (e) { return err(e); }
}

export async function skipIncomingAction(id: string, skip = true): Promise<ActionState> {
  try {
    const { r, u } = await rowFor(id);
    await db().transaction((tx) => skipIncoming(tx, { id, firmId: r.firmId, userId: u.id, skip }));
    revalidatePath(P);
    return { ok: skip ? 'Прескокнато.' : 'Вратено.' };
  } catch (e) { return err(e); }
}

/** Detect the type again (free). */
export async function redetectIncomingAction(id: string): Promise<ActionState> {
  try {
    await rowFor(id);
    await enqueue(INCOMING_JOB, { id });
    revalidatePath(P);
    return { ok: 'Повторно препознавање…' };
  } catch (e) { return err(e); }
}

/**
 * „🤖 Препознај со AI“ — only on the user's click, for a file the free detection could not tell (a photo, a scan):
 * the classification read (`ai.read-document`, kind `classify`) is itself free first and under the AI budget guard.
 */
export async function classifyIncomingAction(id: string): Promise<ActionState> {
  try {
    const { r, u } = await rowFor(id);
    if (!r.firmId) return { error: 'Прво изберете ја фирмата на документот.' };
    await requireCan('office', r.firmId);
    const ids = await db().transaction(async (tx) => {
      const ids = await queueAiReads(tx, { firmId: r.firmId!, userId: u.id, kind: 'classify', fileIds: [r.fileId], options: { incomingId: r.id } });
      await tx.update(incomingDocs).set({ aiDocId: ids[0] ?? null }).where(eq(incomingDocs.id, r.id));
      await audit(tx, { userId: u.id, firmId: r.firmId, action: 'aiRead', entityType: 'incoming_doc', entityId: r.id, data: { kind: 'classify' } });
      return ids;
    });
    await dispatchAiReads(ids);
    revalidatePath(P);
    return { ok: '🤖 Се препознава…' };
  } catch (e) { return err(e); }
}

/* ---------------- the client's portal messages (the same routing as /klInbox) ---------------- */

async function portalItem(itemId: string) {
  if (!isUuid(itemId)) throw new Error('Непозната порака.');
  const [i] = await db().select({ firmId: inboxItems.firmId }).from(inboxItems).where(eq(inboxItems.id, itemId)).limit(1);
  if (!i) throw new Error('Документот не постои.');
  return { firmId: i.firmId, u: await requireCan('office', i.firmId) };
}

export async function routePortalAction(itemId: string, route: InboxRoute, category?: string | null): Promise<ActionState & { go?: string | null }> {
  try {
    if (!(route in INBOX_ROUTES)) return { error: 'Непозната цел.' };
    const { firmId, u } = await portalItem(itemId);
    const r = await db().transaction((tx) => routeInboxFiles(tx, { itemId, firmId, fileIdx: null, kind: route, category, userId: u.id }));
    await dispatchAiReads(r.aiDocIds);
    for (const rowId of r.mpinRowIds ?? []) await enqueue('mpin.read', { rowId });
    if (r.go) await selectFirm(firmId);
    revalidatePath(P);
    revalidatePath('/klInbox');
    return { ok: `→ ${INBOX_ROUTES[route]}${r.skipped.length ? ` (прескокнато: ${r.skipped.join('; ')})` : ''}.`, go: r.go };
  } catch (e) { return err(e); }
}

/** „Означи како обработено“ (legacy `ainbDone`). */
export async function donePortalAction(itemId: string): Promise<ActionState> {
  try {
    const { firmId, u } = await portalItem(itemId);
    await db().transaction(async (tx) => {
      await tx.update(inboxItems).set({ done: true, doneBy: u.id, doneAt: new Date() }).where(eq(inboxItems.id, itemId));
      await audit(tx, { userId: u.id, firmId, action: 'ainbDone', entityType: 'inbox_item', entityId: itemId });
    });
    revalidatePath(P);
    revalidatePath('/klInbox');
    return { ok: 'Обработено.' };
  } catch (e) { return err(e); }
}
