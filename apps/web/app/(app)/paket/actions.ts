'use server';
import { revalidatePath } from 'next/cache';
import { and, eq, inArray } from 'drizzle-orm';
import { audit, docPackages, dossierDocs } from '@wise/db';
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
