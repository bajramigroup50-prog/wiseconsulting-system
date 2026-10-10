'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { INSP, type InspProfile } from '@wise/core/office';
import { INSP_FILE_ENTITY, inspCodeInput, inspFileKey as fileKey, inspMergeCodes } from '@wise/core/office/insp-extra';
import { audit, files, firmReshReads, firms, inspectionStates } from '@wise/db';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/jobs';
import { fdate, fnum, fv, isUuid, linkFiles, officeAction, officeError, today } from '@/lib/office';


const known = (id: string | null): id is string => !!id && INSP.some((i) => i.id === id);

/**
 * Legacy `inspOk` / `inspNa` (ACT_NEED `write`): „✓ Имаме“ confirms the check with the document date; clicking it again
 * with the same date un-confirms it. „➖“ toggles „не се однесува“. Attached files stay on the check either way.
 */
export async function setInspState(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    const itemId = fv(f, 'itemId');
    if (!known(itemId)) return { error: 'Непозната проверка.' };
    const op = fv(f, 'op');
    const d = fdate(f, 'd') ?? today();
    let msg = 'Зачувано.';
    await db().transaction(async (tx) => {
      const [cur] = await tx.select().from(inspectionStates).where(and(eq(inspectionStates.firmId, firm.id), eq(inspectionStates.itemId, itemId))).for('update');
      let v: { doneDate: string | null; na: boolean } | null;
      if (op === 'na') v = cur?.na ? null : { doneDate: null, na: true };
      else if (op === 'clear') v = null;
      else v = cur && !cur.na && cur.doneDate === d ? null : { doneDate: d, na: false };
      if (!v) {
        await tx.delete(inspectionStates).where(and(eq(inspectionStates.firmId, firm.id), eq(inspectionStates.itemId, itemId)));
        msg = 'Отштиклирано.';
      } else {
        const row = { ...v, note: fv(f, 'note') ?? cur?.note ?? null, byName: u.name, updatedBy: u.id };
        await tx.insert(inspectionStates).values({ firmId: firm.id, itemId, ...row })
          .onConflictDoUpdate({ target: [inspectionStates.firmId, inspectionStates.itemId], set: row });
        msg = v.na ? 'Означено: не се однесува.' : 'Потврдено.';
      }
      await audit(tx, { userId: u.id, firmId: firm.id, action: op === 'na' ? 'inspNa' : 'inspOk', entityType: 'inspection', entityId: itemId, data: { op, d: v?.doneDate ?? null, cleared: !v } });
    });
    revalidatePath('/insp');
    return { ok: msg };
  } catch (e) { return officeError(e); }
}

/** Legacy `inspAtt` (v537): attach the document itself (PDF / image) — this also confirms the check with the date. */
export async function attachInsp(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    const itemId = fv(f, 'itemId');
    if (!known(itemId)) return { error: 'Непозната проверка.' };
    const d = fdate(f, 'd') ?? today();
    let n = 0;
    await db().transaction(async (tx) => {
      n = await linkFiles(tx, f.getAll('fileIds'), firm.id, INSP_FILE_ENTITY, fileKey(firm.id, itemId));
      if (!n) return;
      const row = { doneDate: d, na: false, byName: u.name, updatedBy: u.id };
      await tx.insert(inspectionStates).values({ firmId: firm.id, itemId, ...row })
        .onConflictDoUpdate({ target: [inspectionStates.firmId, inspectionStates.itemId], set: row });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'inspAtt', entityType: 'inspection', entityId: itemId, data: { files: n, d } });
    });
    if (!n) return { error: 'Изберете документ (PDF / слика).' };
  } catch (e) { return officeError(e); }
  revalidatePath('/insp');
  redirect('/insp');
}

/** Firm inspection profile (legacy `firm.inspProf` + `kasaMax`), merged into `firms.settings`. */
export async function saveInspProfile(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    const prof: InspProfile = { fisk: f.get('fisk') === 'on', alc: f.get('alc') === 'on', web: f.get('web') === 'on', kasaMax: Math.max(0, fnum(f, 'kasaMax')) };
    const j = JSON.stringify(prof);
    await db().transaction(async (tx) => {
      await tx.update(firms).set({ settings: sql`${firms.settings} || jsonb_build_object('inspProf', ${j}::jsonb)` }).where(eq(firms.id, firm.id));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'inspProf', entityType: 'firm', entityId: firm.id, data: prof as Record<string, unknown> });
    });
    revalidatePath('/insp');
    return { ok: 'Зачувано.' };
  } catch (e) { return officeError(e); }
}

const otherOf = (s: unknown) => (((s ?? {}) as { nkdOther?: unknown }).nkdOther as string[] | undefined)?.filter((x) => typeof x === 'string') ?? [];

/** Legacy `inspCodeAdd`: another activity code of the firm (`settings.nkdOther`). */
export async function addInspCode(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    const v = inspCodeInput(f.get('code'));
    if (!v) return { error: 'Внесете шифра како 46.90' };
    await db().transaction(async (tx) => {
      const [fm] = await tx.select({ settings: firms.settings }).from(firms).where(eq(firms.id, firm.id)).for('update');
      const other = [...new Set([...otherOf(fm?.settings), v])];
      await tx.update(firms).set({ settings: sql`${firms.settings} || jsonb_build_object('nkdOther', ${JSON.stringify(other)}::jsonb)` }).where(eq(firms.id, firm.id));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'inspCodeAdd', entityType: 'firm', entityId: firm.id, data: { code: v } });
    });
    revalidatePath('/insp');
    return { ok: `Додадена шифра ${v}.` };
  } catch (e) { return officeError(e); }
}

/** Legacy `inspCodeRm`. */
export async function removeInspCode(code: string): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    await db().transaction(async (tx) => {
      const [fm] = await tx.select({ settings: firms.settings }).from(firms).where(eq(firms.id, firm.id)).for('update');
      const other = otherOf(fm?.settings).filter((x) => x !== code);
      await tx.update(firms).set({ settings: sql`${firms.settings} || jsonb_build_object('nkdOther', ${JSON.stringify(other)}::jsonb)` }).where(eq(firms.id, firm.id));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'inspCodeRm', entityType: 'firm', entityId: firm.id, data: { code } });
    });
    revalidatePath('/insp');
    return { ok: 'Отстрането.' };
  } catch (e) { return officeError(e); }
}

/**
 * Legacy `inspCodesScan` (v539b): read every activity code from a CRM document (Тековна состојба / Решение за упис).
 * Uses the registration-decision reader (`ai.read-firm-resh`, office-wide upload); the result is applied with
 * {@link applyCodesScan} after the user checks it.
 */
export async function startCodesScan(_p: ActionState, f: FormData): Promise<ActionState> {
  let id = '';
  try {
    const { u, firm } = await officeAction('office');
    const ids = [...new Set(f.getAll('fileIds').map(String).filter(isUuid))].slice(0, 10);
    if (!ids.length) return { error: 'Изберете го документот (PDF / слика).' };
    const ok = await db().select({ id: files.id }).from(files).where(and(inArray(files.id, ids), isNull(files.firmId), eq(files.status, 'ready')));
    if (ok.length !== ids.length) return { error: 'Датотеката не е пронајдена.' };
    id = await db().transaction(async (tx) => {
      const [r] = await tx.insert(firmReshReads).values({ fileIds: ids, createdBy: u.id }).returning({ id: firmReshReads.id });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'inspCodesScan', entityType: 'firm_resh_read', entityId: r!.id, data: { files: ids.length } });
      return r!.id;
    });
    try { await enqueue('ai.read-firm-resh', { id }); } catch { await db().update(firmReshReads).set({ status: 'error', error: 'Читањето (AI) не е достапно – внесете ги шифрите рачно.' }).where(eq(firmReshReads.id, id)); }
  } catch (e) { return officeError(e); }
  redirect(`/insp?scan=${id}`);
}

/** Apply the codes of a finished read (legacy `inspCodesFromFile` merge: main code only when the firm has none). */
export async function applyCodesScan(readId: string): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    if (!isUuid(readId)) return { error: 'Непознато читање.' };
    const [r] = await db().select().from(firmReshReads).where(and(eq(firmReshReads.id, readId), eq(firmReshReads.createdBy, u.id))).limit(1);
    if (!r || r.status !== 'done') return { error: 'Читањето не е завршено.' };
    const res = (r.result ?? {}) as { nkd?: string; otherNkd?: string[] };
    let out = '';
    await db().transaction(async (tx) => {
      const [fm] = await tx.select({ settings: firms.settings, activity: firms.activity }).from(firms).where(eq(firms.id, firm.id)).for('update');
      const st = (fm?.settings ?? {}) as { nkd?: string };
      const M = inspMergeCodes({ nkd: st.nkd ?? fm?.activity, other: otherOf(fm?.settings) }, { priority: res.nkd, codes: res.otherNkd });
      if (!M.all.length) { out = 'Во документот нема шифри на дејност.'; return; }
      const patch: Record<string, unknown> = { nkdOther: M.other, ...(M.nkd ? { nkd: M.nkd } : {}) };
      await tx.update(firms).set({ settings: sql`${firms.settings} || ${JSON.stringify(patch)}::jsonb` }).where(eq(firms.id, firm.id));
      await tx.update(firmReshReads).set({ status: 'saved' }).where(eq(firmReshReads.id, readId));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'inspCodesScan', entityType: 'firm', entityId: firm.id, data: { codes: M.all } });
      out = `✓ Внесени шифри: ${M.all.join(', ')}${M.mismatch ? ` · ⚠ главната во документот е ${M.pri}, а во програмата ${st.nkd ?? fm?.activity}` : ''}`;
    });
    revalidatePath('/insp');
    return { ok: out };
  } catch (e) { return officeError(e); }
}
