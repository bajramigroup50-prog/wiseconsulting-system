'use server';
/**
 * Legacy `zyAdd` (upload into the year's dossier; a generated role replaces the previous file, „Друго“ adds) and
 * `dosMail` for the selected files. Files are linked with `file_links` (`ye_dossier`, `<firmId>:<year>`, role).
 */
import { revalidatePath } from 'next/cache';
import { and, eq, inArray } from 'drizzle-orm';
import { isZyRole } from '@wise/core/firms/zsdos';
import { audit, fileLinks, files, textMailHtml, YE_DOSSIER_ENTITY } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { dispatchMail, queueMail, validAddresses } from '@/lib/mail';
import { isUuid, linkFiles, officeAction, officeError } from '@/lib/office';

const yearOk = (y: unknown) => { const n = Number(y); return Number.isInteger(n) && n > 1990 && n < 2100 ? n : null; };

export async function uploadYearDocs(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('write');
    const year = yearOk(f.get('year')), role = f.get('role');
    if (!year || !isZyRole(role)) return { error: 'Изберете година и вид на документ.' };
    const ids = f.getAll('fileIds').filter(isUuid);
    if (!ids.length) return { error: 'Прикачете датотека.' };
    const key = `${firm.id}:${year}`;
    const n = await db().transaction(async (tx) => {
      if (role !== 'oth') await tx.delete(fileLinks).where(and(eq(fileLinks.entityType, YE_DOSSIER_ENTITY), eq(fileLinks.entityId, key), eq(fileLinks.role, role)));
      const k = await linkFiles(tx, role === 'oth' ? ids : ids.slice(-1), firm.id, YE_DOSSIER_ENTITY, key, role);
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'zyAdd', entityType: YE_DOSSIER_ENTITY, entityId: key, data: { role, files: k } });
      return k;
    });
    revalidatePath('/zsDos');
    return n ? { ok: `Прикачено во досието за ${year}.` } : { error: 'Датотеката не е пронајдена.' };
  } catch (e) { return officeError(e); }
}

/** Remove a file from the year's dossier (the file stays in the archive). */
export async function unlinkYearDoc(year: number, role: string, fileId: string): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('del');
    const key = `${firm.id}:${yearOk(year)}`;
    await db().transaction(async (tx) => {
      const r = await tx.delete(fileLinks).where(and(eq(fileLinks.entityType, YE_DOSSIER_ENTITY), eq(fileLinks.entityId, key), eq(fileLinks.role, role), eq(fileLinks.fileId, fileId))).returning();
      if (r.length) await audit(tx, { userId: u.id, firmId: firm.id, action: 'zyDel', entityType: YE_DOSSIER_ENTITY, entityId: key, data: { role, fileId } });
    });
    revalidatePath('/zsDos');
    return { ok: 'Отстрането од досието.' };
  } catch (e) { return officeError(e); }
}

/** Legacy `dosMail` for the ticked dossier files. */
export async function mailYearDocs(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('write');
    const to = String(f.get('to') ?? '').trim();
    if (!validAddresses(to)) return { error: 'Внесете валидна е-пошта.' };
    const want = [...new Set(f.getAll('sel').filter(isUuid))];
    if (!want.length) return { error: 'Изберете датотеки.' };
    // Only files linked to this firm's year dossier.
    const ok = await db().select({ id: files.id }).from(fileLinks).innerJoin(files, eq(files.id, fileLinks.fileId))
      .where(and(eq(fileLinks.entityType, YE_DOSSIER_ENTITY), inArray(fileLinks.fileId, want), eq(files.firmId, firm.id)));
    const att = [...new Set(ok.map((r) => r.id))];
    if (!att.length) return { error: 'Датотеките не се пронајдени.' };
    const subject = String(f.get('subject') ?? '').trim().slice(0, 300) || `Годишна сметка – ${firm.name}`;
    const body = String(f.get('body') ?? '').trim().slice(0, 10000) || 'Почитувани,\n\nВо прилог Ви ги доставуваме документите од годишната сметка.';
    const ids = await db().transaction(async (tx) => {
      const id = await queueMail(tx, { firmId: firm.id, to, subject, html: textMailHtml(body), attachments: att, entityType: YE_DOSSIER_ENTITY, entityId: firm.id, userId: u.id });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'dosMail', entityType: YE_DOSSIER_ENTITY, entityId: firm.id, data: { to, files: att.length } });
      return [id];
    });
    await dispatchMail(ids);
    revalidatePath('/mailhist');
    return { ok: `Испратено на ${to} (${att.length} датотеки).` };
  } catch (e) { return officeError(e); }
}
