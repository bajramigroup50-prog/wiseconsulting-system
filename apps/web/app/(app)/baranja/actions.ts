'use server';
/** Legacy ACT `tplSave` / `tplDel` (ACT_NEED `office`) and `formSaveEmbg` (fill the firm's empty fields from a form). */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eq, sql } from 'drizzle-orm';
import { INST } from '@wise/core/firms/requests';
import { audit, firms, requestTemplates } from '@wise/db';
import { requireCan } from '@/lib/auth';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { fv, isUuid, officeError, officeGlobal } from '@/lib/office';

export async function saveTemplate(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await officeGlobal('office');
    const id = fv(f, 'id'), baseId = fv(f, 'baseId');
    const name = fv(f, 'name');
    if (!name) return { error: 'Внесете назив на образецот.' };
    const inst = (INST as readonly string[]).includes(fv(f, 'inst') ?? '') ? fv(f, 'inst')! : 'Друго';
    const v = { name: name.slice(0, 300), inst, to: fv(f, 'to'), title: String(f.get('title') ?? '').slice(0, 2000), body: String(f.get('body') ?? '').slice(0, 20000), createdBy: u.id };
    await db().transaction(async (tx) => {
      let tid = id && isUuid(id) ? id : null;
      if (tid) await tx.update(requestTemplates).set(v).where(eq(requestTemplates.id, tid));
      else tid = (await tx.insert(requestTemplates).values({ ...v, baseId: baseId && /^b_\w+$/.test(baseId) ? baseId : null }).returning({ id: requestTemplates.id }))[0]!.id;
      await audit(tx, { userId: u.id, action: 'tplSave', entityType: 'request_template', entityId: tid, data: { name: v.name } });
    });
    revalidatePath('/baranja');
  } catch (e) { return officeError(e); }
  redirect('/baranja');
}

export async function deleteTemplate(id: string): Promise<ActionState> {
  try {
    const u = await officeGlobal('office');
    await db().transaction(async (tx) => {
      const r = await tx.delete(requestTemplates).where(eq(requestTemplates.id, id)).returning({ name: requestTemplates.name });
      if (r.length) await audit(tx, { userId: u.id, action: 'tplDel', entityType: 'request_template', entityId: id, data: { name: r[0]!.name } });
    });
    revalidatePath('/baranja');
    return { ok: 'Избришано.' };
  } catch (e) { return officeError(e); }
}

const COLS = ['name', 'email', 'phone', 'edb', 'activity'] as const;
const SETS = ['signer', 'signerEmbg'] as const;

/** Legacy `formSaveEmbg`: values typed in an official form are kept on the firm for next time (only empty fields; ЕМБГ 13 digits). */
export async function saveFirmFromForm(firmId: string, vals: Record<string, string>): Promise<ActionState> {
  try {
    const u = await requireCan('write', firmId);
    const [f] = await db().select().from(firms).where(eq(firms.id, firmId)).limit(1);
    if (!f) return {};
    const s = (f.settings ?? {}) as Record<string, unknown>;
    const col: Record<string, string> = {}, set: Record<string, string> = {};
    for (const k of COLS) { const v = String(vals[k] ?? '').trim().slice(0, 300); if (v && !(f as Record<string, unknown>)[k]) col[k] = v; }
    for (const k of SETS) { const v = String(vals[k] ?? '').trim().slice(0, 200); if (v && (k !== 'signerEmbg' ? !s[k] : /^\d{13}$/.test(v) && v !== s[k])) set[k] = v; }
    if (!Object.keys(col).length && !Object.keys(set).length) return {};
    await db().transaction(async (tx) => {
      await tx.update(firms).set({ ...col, ...(Object.keys(set).length ? { settings: sql`${firms.settings} || ${JSON.stringify(set)}::jsonb` } : {}) }).where(eq(firms.id, firmId));
      await audit(tx, { userId: u.id, firmId, action: 'formSaveEmbg', entityType: 'firm', entityId: firmId, data: { fields: [...Object.keys(col), ...Object.keys(set)] } });
    });
    return { ok: 'Податоците се зачувани кај фирмата за следниот пат.' };
  } catch (e) { return officeError(e); }
}
