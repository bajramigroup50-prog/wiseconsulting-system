'use server';
import { revalidatePath } from 'next/cache';
import { and, eq, inArray } from 'drizzle-orm';
import { audit, docPackages, dossierDocs, fileLinks, files, OFFICE_FILE_ENTITY, OfficeError, textMailHtml } from '@wise/db';
import { dispatchMail, queueMail, validAddresses } from '@/lib/mail';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { fv, isUuid, officeAction, officeError } from '@/lib/office';

/** Legacy `pkgBuild` (8195+): a named set of dossier documents for a bank / institution. */
export async function savePackage(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    const name = fv(f, 'name');
    if (!name) return { error: 'Внесете назив на пакетот.' };
    const ids = f.getAll('dossierId').map(String).filter(isUuid);
    if (!ids.length) return { error: 'Изберете барем еден документ.' };
    const D = await db().select({ id: dossierDocs.id, title: dossierDocs.title, category: dossierDocs.category, number: dossierDocs.number })
      .from(dossierDocs).where(and(eq(dossierDocs.firmId, firm.id), inArray(dossierDocs.id, ids)));
    const items = ids.map((id) => D.find((d) => d.id === id)).filter((d): d is NonNullable<typeof d> => !!d)
      .map((d) => ({ dossierId: d.id, label: `${d.title || d.category}${d.number ? ` бр. ${d.number}` : ''}` }));
    await db().transaction(async (tx) => {
      const [p] = await tx.insert(docPackages).values({ firmId: firm.id, name, recipient: fv(f, 'recipient'), coverNote: fv(f, 'coverNote'), items, createdBy: u.id }).returning({ id: docPackages.id });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'pkgBuild', entityType: 'doc_package', entityId: p!.id, data: { name, items: items.length } });
    });
    revalidatePath('/paket');
    return { ok: 'Пакетот е зачуван.' };
  } catch (e) { return officeError(e); }
}

/**
 * Legacy `pkgMail` / `pkgMailGo`: send the package by e-mail — the cover note as the message, every file of its
 * dossier documents and generated reports attached (Phase 6 mailer: `mail_log` row + `mail.send`).
 */
export async function mailPackage(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    const id = fv(f, 'id');
    const to = fv(f, 'to') ?? '';
    if (!isUuid(id)) return { error: 'Пакетот не постои.' };
    if (!validAddresses(to)) return { error: 'Внесете важечка е-пошта на примачот.' };
    const ids = await db().transaction(async (tx) => {
      const [p] = await tx.select().from(docPackages).where(and(eq(docPackages.id, id), eq(docPackages.firmId, firm.id))).limit(1);
      if (!p) throw new OfficeError('Пакетот не постои.');
      const dIds = p.items.map((i) => i.dossierId).filter((x): x is string => !!x);
      const L = dIds.length ? await tx.select({ id: files.id }).from(fileLinks).innerJoin(files, eq(files.id, fileLinks.fileId))
        .where(and(eq(fileLinks.entityType, OFFICE_FILE_ENTITY.dossier), inArray(fileLinks.entityId, dIds), eq(files.firmId, firm.id), eq(files.status, 'ready'))) : [];
      const att = [...new Set([...L.map((x) => x.id), ...p.items.map((i) => i.fileId).filter((x): x is string => !!x)])];
      if (!att.length) throw new OfficeError('Пакетот нема датотеки.');
      const body = `${p.recipient ? `До: ${p.recipient}\n\n` : ''}${p.coverNote ? p.coverNote + '\n\n' : ''}Во прилог ги доставуваме следните документи (${firm.name}):\n${p.items.map((i, k) => `${k + 1}. ${i.label}`).join('\n')}`;
      const mid = await queueMail(tx, { firmId: firm.id, to, subject: fv(f, 'subject') || `${p.name} – ${firm.name}`, html: textMailHtml(body), attachments: att, entityType: 'doc_package', entityId: p.id, userId: u.id });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'pkgMail', entityType: 'doc_package', entityId: p.id, data: { to, files: att.length } });
      return [mid];
    });
    await dispatchMail(ids);
    revalidatePath('/paket');
    return { ok: `Пакетот е испратен на ${to}.` };
  } catch (e) { return officeError(e); }
}

export async function deletePackage(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    await db().transaction(async (tx) => {
      const r = await tx.delete(docPackages).where(and(eq(docPackages.id, id), eq(docPackages.firmId, firm.id))).returning({ id: docPackages.id });
      if (r.length) await audit(tx, { userId: u.id, firmId: firm.id, action: 'pkgRm', entityType: 'doc_package', entityId: id });
    });
    revalidatePath('/paket');
    return { ok: 'Избришано.' };
  } catch (e) { return officeError(e); }
}
