'use server';
import { redirect } from 'next/navigation';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { audit, files, legacyImportRuns } from '@wise/db';
import { requireCan } from '@/lib/auth';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/jobs';
import type { RowResult } from '@/components/row-action';

/** Start an import run from uploaded backup files (Систем › 📥 Увоз од старата програма). */
export async function startLegacyImport(_prev: RowResult, form: FormData): Promise<RowResult> {
  // Admin only (`users` permission): the import creates firms, users and books for the whole office.
  const u = await requireCan('users');
  const ids = [...new Set(form.getAll('fileIds').map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x)))];
  if (!ids.length) return { error: 'Прикачете барем една резервна копија (ZIP или JSON).' };
  const rows = await db().select({ id: files.id, name: files.name, size: files.size }).from(files)
    .where(and(inArray(files.id, ids), isNull(files.firmId), eq(files.status, 'ready')));
  if (rows.length !== ids.length) return { error: 'Некои датотеки не се прикачени до крај – обидете се повторно.' };
  const bad = rows.find((r) => !/\.(zip|json)$/i.test(r.name));
  if (bad) return { error: `„${bad.name}“ не е ZIP или JSON датотека од старата програма.` };
  const options = { vatBaseLines: form.get('vatBaseLines') === 'on', users: form.get('users') === 'on' };
  const ordered = ids.map((id) => rows.find((r) => r.id === id)!);
  const runId = await db().transaction(async (tx) => {
    const [run] = await tx.insert(legacyImportRuns).values({ files: ordered, options, createdBy: u.id }).returning({ id: legacyImportRuns.id });
    await audit(tx, { userId: u.id, action: 'legacyImportStart', entityType: 'legacy_import_run', entityId: run!.id, data: { files: ordered.map((f) => f.name), options } });
    return run!.id;
  });
  await enqueue('legacy.import', { runId });
  redirect(`/uvozStara?run=${runId}`);
}
