'use server';
import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { tplKinds } from '@wise/core/office';
import { audit, files, wordTemplates } from '@wise/db';
import { requireCan } from '@/lib/auth';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { scanDocx } from '@/lib/docx';
import { fv, isUuid, officeError } from '@/lib/office';
import { getObjectBytes } from '@/lib/storage';

/**
 * Legacy `tplUpload` (16101): register an uploaded .docx as a template for a document kind. Placeholders are
 * scanned now so the screen can show which ones the firm data fills. A new upload for the same kind and name
 * becomes a new version; older versions are deactivated.
 */
export async function saveTemplate(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await requireCan('office');
    const name = fv(f, 'name');
    const kind = fv(f, 'kind') ?? 'free';
    const fileId = f.getAll('fileIds').map(String).find(isUuid);
    if (!name) return { error: 'Внесете назив.' };
    if (!tplKinds().some((k) => k.key === kind)) return { error: 'Непознат вид на документ.' };
    if (!fileId) return { error: 'Прикачете .docx датотека.' };
    const [file] = await db().select().from(files).where(and(eq(files.id, fileId), eq(files.status, 'ready'))).limit(1);
    if (!file || file.firmId) return { error: 'Датотеката не е пронајдена.' };
    let vars: string[];
    try { vars = scanDocx(await getObjectBytes(file.bucketKey)); } catch { return { error: 'Датотеката не е валиден Word (.docx) документ.' }; }
    await db().transaction(async (tx) => {
      const [{ v }] = (await tx.select({ v: sql<number>`coalesce(max(${wordTemplates.version}), 0)::int` }).from(wordTemplates)
        .where(and(eq(wordTemplates.kind, kind), eq(wordTemplates.name, name)))) as [{ v: number }];
      await tx.update(wordTemplates).set({ active: false }).where(and(eq(wordTemplates.kind, kind), eq(wordTemplates.name, name)));
      const [t] = await tx.insert(wordTemplates).values({ name, kind, fileId, version: v + 1, vars, createdBy: u.id }).returning({ id: wordTemplates.id });
      await audit(tx, { userId: u.id, action: 'tplSave', entityType: 'word_template', entityId: t!.id, data: { name, kind, version: v + 1, vars: vars.length } });
    });
    revalidatePath('/tpl');
    return { ok: `Шаблонот е зачуван (${vars.length} полиња).` };
  } catch (e) { return officeError(e); }
}

/** Legacy `tplOff`: activate / deactivate. */
export async function setTemplateActive(id: string, active: boolean): Promise<ActionState> {
  try {
    const u = await requireCan('office');
    await db().transaction(async (tx) => {
      await tx.update(wordTemplates).set({ active }).where(eq(wordTemplates.id, id));
      await audit(tx, { userId: u.id, action: 'tplOff', entityType: 'word_template', entityId: id, data: { active } });
    });
    revalidatePath('/tpl');
    return { ok: 'Зачувано.' };
  } catch (e) { return officeError(e); }
}

/** Legacy `tplDel` (ACT_NEED `office`) — needs `del` here since it removes a version for good. */
export async function deleteTemplate(id: string): Promise<ActionState> {
  try {
    const u = await requireCan('del');
    await db().transaction(async (tx) => {
      const [t] = await tx.delete(wordTemplates).where(eq(wordTemplates.id, id)).returning();
      if (t) await audit(tx, { userId: u.id, action: 'tplDel', entityType: 'word_template', entityId: id, data: { name: t.name, version: t.version } });
    });
    revalidatePath('/tpl');
    return { ok: 'Избришано.' };
  } catch (e) { return officeError(e); }
}
