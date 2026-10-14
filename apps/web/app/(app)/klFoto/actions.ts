'use server';
/**
 * „📷 Испрати документ“ (`/klFoto`): the client sends photos / PDFs (already uploaded by the page, `lib/upload.ts`) with
 * the kind of document and a note. The firm comes from the session (never from the request); the files must be the
 * client's own uploads of that firm (`linkFiles`). The office gets the message in „📥 Пристигнато од клиенти“ and the
 * responsible colleague an e-mail; several photos of one document are combined into one PDF by the worker
 * (`inbox.combine`). Nothing is read with AI here (the office decides when it routes the message).
 *
 * Offline retries: the page sends the same `cid` again until it gets an answer — a `cid` already stored returns the
 * message it created instead of a second one.
 */
import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { CAPTURE_KINDS, CAPTURE_MAX_FILES, captureSubject, INBOX_COMBINE_JOB, isCaptureKind } from '@wise/core/office';
import { audit, auditLog, inboxItems, inboxRecipients, OFFICE_FILE_ENTITY, OfficeError, textMailHtml } from '@wise/db';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/jobs';
import { dispatchMail, queueMail } from '@/lib/mail';
import { isUuid, linkFiles, officeAction, officeError } from '@/lib/office';

export interface CaptureSend { cid: string; kind: string; note?: string | null; fileIds: string[]; combine?: boolean }

export async function sendCapture(a: CaptureSend): Promise<{ ok?: string; error?: string; id?: string }> {
  try {
    const { u, firm } = await officeAction('write');
    if (!a || !isUuid(a.cid)) return { error: 'Неважечко барање.' };
    if (!isCaptureKind(a.kind)) return { error: 'Изберете вид на документ.' };
    const ids = [...new Set((Array.isArray(a.fileIds) ? a.fileIds : []).filter(isUuid))];
    if (!ids.length) return { error: 'Фотографирајте или изберете документ.' };
    if (ids.length > CAPTURE_MAX_FILES) return { error: `Најмногу ${CAPTURE_MAX_FILES} датотеки во едно праќање.` };
    const note = String(a.note ?? '').trim().slice(0, 2000) || null;
    const [dup] = await db().select({ id: auditLog.entityId }).from(auditLog)
      .where(and(eq(auditLog.firmId, firm.id), eq(auditLog.userId, u.id), eq(auditLog.action, 'klFoto'), sql`${auditLog.data}->>'cid' = ${a.cid}`)).limit(1);
    if (dup?.id) return { ok: 'Веќе е испратено. ✓', id: dup.id };
    const kind = CAPTURE_KINDS[a.kind];
    const r = await db().transaction(async (tx) => {
      const [i] = await tx.insert(inboxItems).values({
        firmId: firm.id, docKind: a.kind, subject: captureSubject(a.kind as keyof typeof CAPTURE_KINDS, ids.length), note, fromUserId: u.id, fromName: u.name,
      }).returning({ id: inboxItems.id });
      const n = await linkFiles(tx, ids, firm.id, OFFICE_FILE_ENTITY.inbox, i!.id);
      if (!n) throw new OfficeError('Документите не се пронајдени – прикачете ги повторно.');
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'klFoto', entityType: 'inbox_item', entityId: i!.id, data: { cid: a.cid, kind: a.kind, files: n, combine: !!a.combine } });
      const to = await inboxRecipients(tx, firm.id);
      const mail = to.length ? [await queueMail(tx, {
        firmId: firm.id, to, subject: `📷 ${kind.label} од клиент: ${firm.name}`,
        html: textMailHtml(`${u.name} (${firm.name}) испрати ${kind.label.toLowerCase()} – ${n} ${n === 1 ? 'датотека' : 'датотеки'} од телефон.${note ? `\n\n${note}` : ''}\n\nОтворете го во „📥 Пристигнато од клиенти“ и со еден клик пратете го каде што треба.`),
        entityType: 'inbox_item', entityId: i!.id, userId: u.id,
      })] : [];
      return { id: i!.id, n, mail };
    });
    await dispatchMail(r.mail);
    // several photos of one document → one PDF (worker, pdf-lib); when the queue is down the photos simply stay
    if (a.combine && r.n > 1) await enqueue(INBOX_COMBINE_JOB, { itemId: r.id }).catch((e) => console.warn('[klFoto] combine not queued:', (e as Error).message));
    revalidatePath('/klFoto');
    revalidatePath('/klInbox');
    return { ok: 'Испратено до канцеларијата. ✓', id: r.id };
  } catch (e) { return officeError(e); }
}
