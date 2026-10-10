'use server';
/**
 * Legacy `zyAdd` (upload into the year's dossier; a generated role replaces the previous file, „Друго“ adds) and
 * `dosMail` for the selected files. Files are linked with `file_links` (`ye_dossier`, `<firmId>:<year>`, role).
 * `saveYearXml` is the XML part of `zyGen` (the PDFs are filed through `POST /api/pdf` `save`); `yearDocsToPackage`
 * is legacy `zyToPkg` („📦 Во пакет за банка“).
 */
import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { crmXml } from '@wise/core';
import { and, eq, inArray } from 'drizzle-orm';
import { isZyRole } from '@wise/core/firms/zsdos';
import { audit, docPackages, fileLinks, files, forms3538, loadYear, textMailHtml, yearFindings, YE_DOSSIER_ENTITY } from '@wise/db';
import { currentYear } from '@/lib/context';
import { objectKey, putObjectBytes } from '@/lib/storage';
import { accountNames, todayMk } from '@/lib/yearend';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { dispatchMail, queueMail, validAddresses } from '@/lib/mail';
import { isUuid, linkFiles, officeAction, officeError } from '@/lib/office';
import { OfficeError } from '@wise/db';

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

/** Legacy `zyGenerate` XML part: `GS_<год>_<ЕМБС>.xml` (as the ЦРМ download, behind the findings gate) → role `xml`. */
export async function saveYearXml(year0: number): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('write');
    const year = await currentYear();
    if (yearOk(year0) !== year) return { error: 'XML се зачувува само за тековната година.' };
    const L = await loadYear(db(), firm.id, year);
    const F = await yearFindings(db(), L, todayMk());
    if (F.open.length) return { error: `XML за ЦРМ не е зачуван: ${F.open.length} неразрешени наоди во „Контрола“.` };
    const { de, f35 } = forms3538(L, await accountNames(firm.id));
    const xml = crmXml({
      year, current: L.Y.co.zs, previous: L.prev, rules: L.rules, de38: de, f35, f35Raw: L.statement?.f35Raw ?? null,
      embs: firm.embs ?? '', period: L.statement?.crmPeriod ?? 1,
    }, { prev: false, zeros: false });
    const body = new TextEncoder().encode(xml);
    const name = `GS_${year}_${(firm.embs ?? '').replace(/\D/g, '') || 'firma'}.xml`;
    const key = objectKey(firm.id, name);
    await putObjectBytes(key, body, 'application/xml');
    const ek = `${firm.id}:${year}`;
    await db().transaction(async (tx) => {
      const [f] = await tx.insert(files).values({
        firmId: firm.id, bucketKey: key, name, mime: 'application/xml', size: body.byteLength, sha256: createHash('sha256').update(body).digest('hex'), status: 'ready', uploadedBy: u.id,
      }).returning({ id: files.id });
      await tx.delete(fileLinks).where(and(eq(fileLinks.entityType, YE_DOSSIER_ENTITY), eq(fileLinks.entityId, ek), eq(fileLinks.role, 'xml')));
      await tx.insert(fileLinks).values({ fileId: f!.id, entityType: YE_DOSSIER_ENTITY, entityId: ek, role: 'xml' });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'zyGen', entityType: YE_DOSSIER_ENTITY, entityId: ek, data: { role: 'xml', fileId: f!.id } });
    });
    revalidatePath('/zsDos');
    return { ok: 'XML е зачуван.' };
  } catch (e) { return officeError(e); }
}

/** Legacy `zyToPkg`: the ticked year-dossier files into a document package (a new „Пакет за банка“ or an existing one). */
export async function yearDocsToPackage(_p: ActionState, f: FormData): Promise<ActionState> {
  let id = '';
  try {
    const { u, firm } = await officeAction('office');
    const want = [...new Set(f.getAll('sel').filter(isUuid))];
    if (!want.length) return { error: 'Изберете датотеки.' };
    const F = await db().select({ id: files.id, name: files.name, key: fileLinks.entityId }).from(fileLinks).innerJoin(files, eq(files.id, fileLinks.fileId))
      .where(and(eq(fileLinks.entityType, YE_DOSSIER_ENTITY), inArray(fileLinks.fileId, want), eq(files.firmId, firm.id)));
    const seen = new Set<string>();
    const items = F.filter((x) => !seen.has(x.id) && !!seen.add(x.id)).map((x) => ({ fileId: x.id, label: `${x.name} (${x.key.split(':')[1]})` }));
    if (!items.length) return { error: 'Датотеките не се пронајдени.' };
    const pkg = String(f.get('pkg') ?? '');
    id = await db().transaction(async (tx) => {
      let pid: string;
      if (isUuid(pkg)) {
        const [p] = await tx.select().from(docPackages).where(and(eq(docPackages.id, pkg), eq(docPackages.firmId, firm.id))).limit(1);
        if (!p) throw new OfficeError('Пакетот не постои.');
        await tx.update(docPackages).set({ items: [...p.items, ...items.filter((i) => !p.items.some((x) => x.fileId === i.fileId))] }).where(eq(docPackages.id, p.id));
        pid = p.id;
      } else {
        const [p] = await tx.insert(docPackages).values({ firmId: firm.id, name: `Пакет за банка – ${firm.name}`, items, createdBy: u.id }).returning({ id: docPackages.id });
        pid = p!.id;
      }
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'zyToPkg', entityType: 'doc_package', entityId: pid, data: { files: items.length } });
      return pid;
    });
    revalidatePath('/paket');
  } catch (e) { return officeError(e); }
  redirect(id ? '/paket' : '/zsDos');
}

/** `yearDocsToPackage` as the second submit button of the e-mail form (`formAction`); an error comes back as `?pkgErr=`. */
export async function yearDocsToPackageForm(f: FormData): Promise<void> {
  const r = await yearDocsToPackage({}, f);
  if (r?.error) redirect('/zsDos?pkgErr=' + encodeURIComponent(r.error));
}
