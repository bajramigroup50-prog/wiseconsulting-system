'use server';
import { revalidatePath } from 'next/cache';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { can, firmAllowed } from '@wise/core';
import { audit, files, firms, OfficeError } from '@wise/db';
import { dropUnsavedReads, fileInUse } from '@/lib/archive';
import { db } from '@/lib/db';
import { officeAction, officeError } from '@/lib/office';
import { deleteObject } from '@/lib/storage';
import { deleteDossierDoc } from '../dosie/actions';

type Res = { ok?: string; error?: string };

/** Legacy `arDel`: remove an archived (dossier) document from the archive. */
export async function arDel(id: string) {
  const r = await deleteDossierDoc(id);
  revalidatePath('/arhiva');
  return r;
}

const uuids = (ids: unknown) => (Array.isArray(ids) ? ids : [ids]).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));

/** The current firm's ready files among `ids` (others — another firm, unknown — are simply not found). */
async function ownFiles(firmId: string, ids: unknown) {
  const L = [...new Set(uuids(ids))];
  if (!L.length) throw new OfficeError('Изберете датотека.');
  return db().select().from(files).where(and(eq(files.firmId, firmId), eq(files.status, 'ready'), inArray(files.id, L)));
}

const skipped = (bad: string[]) => (bad.length ? ` Прескокнати (${bad.length}): ${bad.slice(0, 5).join('; ')}${bad.length > 5 ? '…' : ''}.` : '');

/**
 * Server addition: delete files of the archive that are attached to nothing („Датотека“ rows — e.g. a statement
 * uploaded into the wrong firm or a read that failed). Needs `del` on the firm; files in use are refused. The row
 * goes (with the unsaved AI reads of it), the stored object after the commit.
 */
export async function arFileDel(ids: string[]): Promise<Res> {
  try {
    const { u, firm } = await officeAction('del');
    // dossier documents ticked together with the files („d:<id>“)
    const D = (Array.isArray(ids) ? ids : []).map(String).filter((x) => x.startsWith('d:')).map((x) => x.slice(2));
    let nd = 0;
    for (const id of D) if (!(await deleteDossierDoc(id)).error) nd++;
    const fids = (Array.isArray(ids) ? ids : []).map(String).filter((x) => !x.startsWith('d:'));
    const F = fids.length ? await ownFiles(firm.id, fids) : [];
    if (!F.length) { revalidatePath('/arhiva'); return nd ? { ok: `Избришани ${nd} документи од архивата.` } : { error: 'Датотеката не е пронајдена во оваа фирма.' }; }
    const bad: string[] = [];
    const gone = await db().transaction(async (tx) => {
      const G: typeof F = [];
      for (const f of F) {
        const why = await fileInUse(tx, f);
        if (why) { bad.push(`„${f.name}“ – ${why}`); continue; }
        await dropUnsavedReads(tx, f.id);
        await tx.delete(files).where(eq(files.id, f.id));
        await audit(tx, { userId: u.id, firmId: firm.id, action: 'fileDelete', entityType: 'file', entityId: f.id, data: { name: f.name, size: f.size, sha256: f.sha256, bucketKey: f.bucketKey } });
        G.push(f);
      }
      return G;
    });
    for (const f of gone) await deleteObject(f.bucketKey);
    revalidatePath('/arhiva');
    if (!gone.length) return nd ? { ok: `Избришани ${nd} документи од архивата.${skipped(bad)}` } : { error: `Ништо не е избришано.${skipped(bad)}` };
    return { ok: `Избришани ${gone.length} ${gone.length === 1 ? 'датотека' : 'датотеки'}${nd ? ` и ${nd} документи` : ''}.${skipped(bad)}` };
  } catch (e) { return officeError(e); }
}

/**
 * Server addition: move files attached to nothing to another firm the user works in (statements uploaded into the
 * wrong firm). Needs `write` on both firms; a file the target firm already has (same content) is refused — there
 * the copy in this firm is simply deleted. The stored object keeps its key; only the owner changes.
 */
export async function arFileMove(ids: string[], toFirmId: string): Promise<Res> {
  try {
    const { u, firm } = await officeAction('write');
    if (u.role === 'klient') return { error: 'Немате дозвола за оваа активност.' };
    const to = String(toFirmId ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(to)) return { error: 'Изберете фирма.' };
    if (to === firm.id) return { error: 'Датотеката е веќе во оваа фирма.' };
    const [T] = await db().select({ id: firms.id, name: firms.name, active: firms.active, ownerId: firms.ownerId }).from(firms).where(eq(firms.id, to)).limit(1);
    if (!T || !T.active || !firmAllowed(u.principal, T.id, T.ownerId) || !can(u.principal, 'write', T.id)) return { error: 'Немате дозвола за избраната фирма.' };
    const F = await ownFiles(firm.id, ids);
    if (!F.length) return { error: 'Датотеката не е пронајдена во оваа фирма.' };
    const bad: string[] = [];
    const n = await db().transaction(async (tx) => {
      let k = 0;
      for (const f of F) {
        const why = await fileInUse(tx, f);
        if (why) { bad.push(`„${f.name}“ – ${why}`); continue; }
        const [dup] = await tx.select({ id: files.id }).from(files)
          .where(and(eq(files.firmId, T.id), eq(files.sha256, f.sha256), eq(files.status, 'ready'), ne(files.id, f.id))).limit(1);
        if (dup) { bad.push(`„${f.name}“ – веќе постои во „${T.name}“ (избришете ја тука)`); continue; }
        await dropUnsavedReads(tx, f.id);
        await tx.update(files).set({ firmId: T.id }).where(eq(files.id, f.id));
        const data = { name: f.name, from: firm.id, fromName: firm.name, to: T.id, toName: T.name };
        await audit(tx, { userId: u.id, firmId: firm.id, action: 'fileMove', entityType: 'file', entityId: f.id, data });
        await audit(tx, { userId: u.id, firmId: T.id, action: 'fileMove', entityType: 'file', entityId: f.id, data });
        k++;
      }
      return k;
    });
    revalidatePath('/arhiva');
    if (!n) return { error: `Ништо не е преместено.${skipped(bad)}` };
    return { ok: `Преместени ${n} ${n === 1 ? 'датотека' : 'датотеки'} во „${T.name}“.${skipped(bad)}` };
  } catch (e) { return officeError(e); }
}
