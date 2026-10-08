'use server';
import { revalidatePath } from 'next/cache';
import { CLIENT_ENTRY_KINDS, isClientEntryKind } from '@wise/core/office';
import { r2 } from '@wise/core';
import { audit, clientEntries, inboxItems, OFFICE_FILE_ENTITY } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { fdate, fnum, fv, linkFiles, officeAction, officeError } from '@/lib/office';

/**
 * Legacy `VIEWS.klSend` 9066: the client sends a document / message to the office (`docs.type='inbox'`).
 * Needs `write` on the client's own firm (firm from the session, never from the form).
 */
export async function sendToOffice(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('write');
    const note = fv(f, 'note');
    const ids = f.getAll('fileIds');
    if (!note && !ids.length) return { error: 'Прикачете документ или напишете порака.' };
    await db().transaction(async (tx) => {
      const [i] = await tx.insert(inboxItems).values({ firmId: firm.id, note, subject: fv(f, 'subject'), fromUserId: u.id, fromName: u.name }).returning({ id: inboxItems.id });
      const n = await linkFiles(tx, ids, firm.id, OFFICE_FILE_ENTITY.inbox, i!.id);
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'klSend', entityType: 'inbox_item', entityId: i!.id, data: { files: n } });
    });
    // TODO(mail): notify the office (legacy `alBell` / inbox badge is shown in /klInbox; e-mail via Phase 6 `mail.send`).
    revalidatePath('/klSend');
    return { ok: 'Испратено до канцеларијата. ✓' };
  } catch (e) { return officeError(e); }
}

/**
 * The client enters a purchase / invoice / daily sale. Always stored as a *pending* client entry — it never
 * reaches the books until the office approves it in /klInbox (FIX #1: enforced here, server-side).
 */
export async function submitEntry(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('write');
    const kind = fv(f, 'kind');
    if (!isClientEntryKind(kind) || kind === 'dossier') return { error: 'Изберете вид на документ.' };
    const date = fdate(f, 'date');
    if (!date) return { error: 'Внесете датум.' };
    const total = r2(fnum(f, 'total')), vat = r2(fnum(f, 'vat'));
    if (total <= 0) return { error: 'Внесете износ.' };
    const data = { number: fv(f, 'number'), date, partnerName: fv(f, 'partnerName'), partnerEdb: fv(f, 'partnerEdb'), total, vat, due: fdate(f, 'due'), note: fv(f, 'note') };
    await db().transaction(async (tx) => {
      const [e] = await tx.insert(clientEntries).values({ firmId: firm.id, kind, data, submittedBy: u.id }).returning({ id: clientEntries.id });
      await linkFiles(tx, f.getAll('fileIds'), firm.id, OFFICE_FILE_ENTITY.clientEntry, e!.id);
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'klAddRec', entityType: 'client_entry', entityId: e!.id, data: { kind, total } });
    });
    revalidatePath('/klSend');
    return { ok: `${CLIENT_ENTRY_KINDS[kind]} е внесена – чека одобрување од канцеларијата.` };
  } catch (e) { return officeError(e); }
}
