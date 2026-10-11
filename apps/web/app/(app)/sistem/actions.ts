'use server';
/**
 * Legacy `bkNow` (ACT_NEED `settings`), `bkRestoreGo` (ACT_NEED `del`, administrator only) — server version:
 * a copy of the current firm stored as a JSON document in the archive, and restore of a firm from such a copy
 * (with an automatic copy of the current state first, like legacy).
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import {
  audit, BACKUP_FILE_PREFIX, exportFirm, FirmDataError, files, firms, parseFirmBackup, PRE_RESTORE_PREFIX, restoreFirm,
} from '@wise/db';
import { Forbidden, requireCan, requireUser } from '@/lib/auth';
import { actionError, type ActionState } from '@/lib/books';
import { currentFirm } from '@/lib/context';
import { db } from '@/lib/db';
import { getObjectBytes } from '@/lib/storage';
import { backupName, fileRow, putBackup } from '@/lib/sysdata';

const err = (e: unknown): ActionState => (e instanceof FirmDataError ? { error: e.message } : actionError(e));

export async function backupNowAction(): Promise<ActionState> {
  try {
    const u0 = await requireUser();
    const firm = await currentFirm(u0);
    if (!firm) return { error: 'Изберете фирма.' };
    const u = await requireCan('settings', firm.id);
    const B = await exportFirm(db(), firm.id);
    const f = await putBackup(firm.id, backupName(BACKUP_FILE_PREFIX, firm.name), B);
    await db().transaction(async (tx) => {
      const id = await fileRow(tx, f, u.id);
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'bkNow', entityType: 'file', entityId: id, data: { size: f.size } });
    });
    revalidatePath('/sistem');
    return { ok: `Копијата е зачувана (${Math.max(1, Math.round(f.size / 1024))} KB).` };
  } catch (e) { return err(e); }
}

/** After uploading a backup file: open the restore confirmation for it. */
export async function pickRestoreAction(_p: ActionState, form: FormData): Promise<ActionState> {
  await requireCan('settings');
  const id = String(form.getAll('fileIds').at(-1) ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: 'Прикачете ја датотеката со копијата (JSON).' };
  redirect(`/sistem?r=${id}`);
}

/** Restore from a backup file of the current firm's archive (uploaded or made with „Направи копија“). */
export async function restoreAction(fileId: string): Promise<ActionState> {
  try {
    const u0 = await requireUser();
    const firm = await currentFirm(u0);
    if (!firm) return { error: 'Изберете фирма.' };
    const u = await requireCan('del', firm.id);
    if (u.role !== 'admin') throw new Forbidden('bkRestoreGo');
    const [file] = await db().select().from(files).where(and(eq(files.id, fileId), eq(files.firmId, firm.id), eq(files.status, 'ready'))).limit(1);
    if (!file) return { error: 'Датотеката не постои.' };
    const B = parseFirmBackup(new TextDecoder().decode(await getObjectBytes(file.bucketKey)));
    const target = String(B.firm.id);
    // Copy of the current state first (legacy: „Пред враќањето автоматски се прави нова копија“).
    const [exists] = await db().select({ id: firms.id, name: firms.name }).from(firms).where(eq(firms.id, target)).limit(1);
    const pre = exists ? await putBackup(target, backupName(PRE_RESTORE_PREFIX, exists.name), await exportFirm(db(), target)) : null;
    const r = await db().transaction(async (tx) => {
      const res = await restoreFirm(tx, B, { userId: u.id });
      if (pre) await fileRow(tx, pre, u.id);
      return res;
    });
    revalidatePath('/', 'layout');
    return { ok: `Фирмата „${String(B.firm.name ?? '')}“ е вратена: ${r.inserted} записи.${r.skipped.length ? ` Прескокнати непознати збирки: ${r.skipped.join(', ')}.` : ''}${pre ? ' Претходната состојба е зачувана во архивата.' : ''}` };
  } catch (e) { return err(e); }
}
