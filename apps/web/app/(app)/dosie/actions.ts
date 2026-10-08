'use server';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { entryStatusFor } from '@wise/core';
import { DOS_CAT } from '@wise/core/office';
import { audit, clientEntries, dossierDocs, fileLinks, firmContacts, firmDeadlines, OFFICE_FILE_ENTITY } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { fdate, fv, linkFiles, officeAction, officeError } from '@/lib/office';

/**
 * Legacy `dosSave` (12786) / `archiveFile`. Office users save directly; a `klient` gets a pending
 * client entry instead (legacy `save()` set `pend:true` on docs for clients) — decided server-side.
 */
export async function saveDossierDoc(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('write');
    const category = fv(f, 'category') ?? '';
    if (!(DOS_CAT as readonly string[]).includes(category)) return { error: 'Изберете категорија.' };
    const v = { category, title: fv(f, 'title'), number: fv(f, 'number'), date: fdate(f, 'date'), validTo: fdate(f, 'validTo'), note: fv(f, 'note') };
    const ids = f.getAll('fileIds');
    const pending = entryStatusFor(u.principal) === 'pending';
    await db().transaction(async (tx) => {
      if (pending) {
        const [e] = await tx.insert(clientEntries).values({ firmId: firm.id, kind: 'dossier', data: v, submittedBy: u.id }).returning({ id: clientEntries.id });
        await linkFiles(tx, ids, firm.id, OFFICE_FILE_ENTITY.clientEntry, e!.id);
        await audit(tx, { userId: u.id, firmId: firm.id, action: 'dosSave', entityType: 'client_entry', entityId: e!.id, data: { pending: true, category } });
      } else {
        const [d] = await tx.insert(dossierDocs).values({ ...v, firmId: firm.id, createdBy: u.id }).returning({ id: dossierDocs.id });
        const n = await linkFiles(tx, ids, firm.id, OFFICE_FILE_ENTITY.dossier, d!.id);
        await audit(tx, { userId: u.id, firmId: firm.id, action: 'dosSave', entityType: 'dossier_doc', entityId: d!.id, data: { category, files: n } });
      }
    });
    revalidatePath('/dosie');
    return { ok: pending ? 'Испратено до канцеларијата – чека одобрување.' : 'Зачувано во досието.' };
  } catch (e) { return officeError(e); }
}

/** Legacy `dosDel` (ACT_NEED `del`). The files stay in the archive; only the dossier entry and its links go. */
export async function deleteDossierDoc(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('del');
    await db().transaction(async (tx) => {
      const [d] = await tx.delete(dossierDocs).where(and(eq(dossierDocs.id, id), eq(dossierDocs.firmId, firm.id))).returning();
      if (!d) return;
      await tx.delete(fileLinks).where(and(eq(fileLinks.entityType, OFFICE_FILE_ENTITY.dossier), eq(fileLinks.entityId, id)));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'dosDel', entityType: 'dossier_doc', entityId: id, data: { category: d.category, title: d.title } });
    });
    revalidatePath('/dosie');
    return { ok: 'Избришано.' };
  } catch (e) { return officeError(e); }
}

/** Legacy `fcSave` (firm.contacts). */
export async function saveContact(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    const name = fv(f, 'name');
    if (!name) return { error: 'Внесете име.' };
    await db().transaction(async (tx) => {
      const [c] = await tx.insert(firmContacts).values({ firmId: firm.id, name, role: fv(f, 'role'), email: fv(f, 'email'), phone: fv(f, 'phone'), note: fv(f, 'note') }).returning({ id: firmContacts.id });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'fcSave', entityType: 'firm_contact', entityId: c!.id, data: { name } });
    });
    revalidatePath('/dosie');
    return { ok: 'Контактот е зачуван.' };
  } catch (e) { return officeError(e); }
}

export async function deleteContact(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    await db().transaction(async (tx) => {
      const r = await tx.delete(firmContacts).where(and(eq(firmContacts.id, id), eq(firmContacts.firmId, firm.id))).returning({ id: firmContacts.id });
      if (r.length) await audit(tx, { userId: u.id, firmId: firm.id, action: 'fcDel', entityType: 'firm_contact', entityId: id });
    });
    revalidatePath('/dosie');
    return { ok: 'Избришано.' };
  } catch (e) { return officeError(e); }
}

export async function saveDeadline(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    const title = fv(f, 'title'), due = fdate(f, 'due');
    if (!title || !due) return { error: 'Внесете опис и рок.' };
    const remindDays = Math.max(0, Math.min(365, Math.round(Number(f.get('remindDays')) || 7)));
    await db().transaction(async (tx) => {
      const [d] = await tx.insert(firmDeadlines).values({ firmId: firm.id, title, due, remindDays, note: fv(f, 'note'), createdBy: u.id }).returning({ id: firmDeadlines.id });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'dlSave', entityType: 'firm_deadline', entityId: d!.id, data: { title, due } });
    });
    revalidatePath('/dosie');
    return { ok: 'Рокот е зачуван.' };
  } catch (e) { return officeError(e); }
}

export async function setDeadlineDone(id: string, done: boolean): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    await db().transaction(async (tx) => {
      await tx.update(firmDeadlines).set({ done }).where(and(eq(firmDeadlines.id, id), eq(firmDeadlines.firmId, firm.id)));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'dlDone', entityType: 'firm_deadline', entityId: id, data: { done } });
    });
    revalidatePath('/dosie');
    return { ok: 'Зачувано.' };
  } catch (e) { return officeError(e); }
}
