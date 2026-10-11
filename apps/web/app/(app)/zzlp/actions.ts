'use server';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { can, firmAllowed } from '@wise/core';
import { gdprDue, isGdprKind, ZZ_CHK } from '@wise/core/office';
import { audit, gdprRecords, OFFICE_FILE_ENTITY, patchOfficeProfile } from '@wise/db';
import { requireCan } from '@/lib/auth';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { fdate, fv, isUuid, linkFiles, officeError, today } from '@/lib/office';

/** A register entry (DPA with a client, staff confidentiality statement, processing activity, breach, request). */
export async function saveGdpr(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await requireCan('office');
    const kind = fv(f, 'kind');
    if (!isGdprKind(kind)) return { error: 'Изберете вид.' };
    const subject = fv(f, 'subject');
    if (!subject) return { error: 'Внесете опис / субјект.' };
    const firmId = fv(f, 'firmId');
    if (firmId && (!isUuid(firmId) || !firmAllowed(u.principal, firmId))) return { error: 'Немате пристап до фирмата.' };
    const date = fdate(f, 'date') ?? today();
    await db().transaction(async (tx) => {
      const [r] = await tx.insert(gdprRecords).values({
        kind, subject, firmId: firmId || null, date, validTo: fdate(f, 'validTo'), due: gdprDue(kind, date),
        status: kind === 'breach' || kind === 'request' ? 'open' : 'signed', data: { note: fv(f, 'note') }, createdBy: u.id,
      }).returning({ id: gdprRecords.id });
      await linkFiles(tx, f.getAll('fileIds'), null, OFFICE_FILE_ENTITY.gdpr, r!.id);
      await audit(tx, { userId: u.id, firmId: firmId || null, action: 'zzSave', entityType: 'gdpr_record', entityId: r!.id, data: { kind } });
    });
    revalidatePath('/zzlp');
    return { ok: 'Зачувано во регистарот.' };
  } catch (e) { return officeError(e); }
}

export async function closeGdpr(id: string): Promise<ActionState> {
  try {
    const u = await requireCan('office');
    await db().transaction(async (tx) => {
      await tx.update(gdprRecords).set({ status: 'closed' }).where(eq(gdprRecords.id, id));
      await audit(tx, { userId: u.id, action: 'zzClose', entityType: 'gdpr_record', entityId: id });
    });
    revalidatePath('/zzlp');
    return { ok: 'Затворено.' };
  } catch (e) { return officeError(e); }
}

/** Office compliance checklist (legacy `zzSaveOff` — now a jsonb merge, FIX #7). */
export async function saveZzChecklist(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await requireCan('settings');
    const chk = Object.fromEntries(ZZ_CHK.map(([k]) => [k, f.get(`chk_${k}`) === 'on']));
    await db().transaction(async (tx) => {
      await patchOfficeProfile(tx, { zzlp: { chk } }, u.id);
      await audit(tx, { userId: u.id, action: 'zzSaveOff', entityType: 'app_settings', entityId: 'office', data: chk });
    });
    revalidatePath('/zzlp');
    return { ok: 'Зачувано.' };
  } catch (e) { return officeError(e); }
}

/** Legacy `zzSigned` („✓ Потпишан“ / „↺“ per client): the processing agreement with the client is signed (or undone). */
export async function zzSigned(firmId: string, signed: boolean): Promise<ActionState> {
  try {
    const u = await requireCan('office', firmId);
    // legacy `zzSigned`: un-marking a signed DPA removes the record — only the responsible person (`del`)
    if (!signed && !can(u.principal, 'del', firmId)) return { error: 'Само одговорното лице може да врати.' };
    await db().transaction(async (tx) => {
      const L = await tx.select({ id: gdprRecords.id, kind: gdprRecords.kind }).from(gdprRecords).where(eq(gdprRecords.firmId, firmId));
      const ids = L.filter((r) => r.kind === 'dpa').map((r) => r.id);
      if (signed && !ids.length) await tx.insert(gdprRecords).values({ kind: 'dpa', subject: 'Договор за обработка на лични податоци', firmId, date: today(), status: 'signed', data: {}, createdBy: u.id });
      if (!signed) for (const id of ids) await tx.delete(gdprRecords).where(eq(gdprRecords.id, id));
      await audit(tx, { userId: u.id, firmId, action: 'zzSigned', entityType: 'firm', entityId: firmId, data: { signed } });
    });
    revalidatePath('/zzlp');
    return { ok: signed ? 'Означено како потпишан.' : 'Вратено.' };
  } catch (e) { return officeError(e); }
}
