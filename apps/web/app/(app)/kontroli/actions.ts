'use server';
/**
 * „Анализа на решение / записник од контрола“ — server actions. The firm always comes from the session; every
 * mutation needs `office` (removing a case needs `del`) and is audited in its transaction (services in @wise/db).
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import type { KontrolaAiResult } from '@wise/core/compliance';
import {
  applyKontrolaAi, audit, deleteKontrola, deleteKontrolaFinding, fileLinks, findingEvidence, kontrolaFindings, kontroli, KONTROLA_FILE_ENTITY,
  saveKontrola, saveKontrolaAction, saveKontrolaFinding, setKontrolaActionDone,
} from '@wise/db';
import { loadAiResult, markAiReadsSaved } from '@/lib/ai';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { fdate, fv, isUuid, linkFiles, officeAction, officeError, today } from '@/lib/office';
import { OWNER_ONLY_MSG, isOfficeOwner } from '@/lib/office-owner';

const PATH = '/kontroli';
const tri = (v: FormDataEntryValue | null): boolean | null => (v === 'yes' ? true : v === 'no' ? false : null);

export async function kSave(_p: ActionState, f: FormData): Promise<ActionState> {
  let id = '';
  const isNew = !fv(f, 'id');
  try {
    const { u, firm } = await officeAction('office');
    const prev = fv(f, 'id');
    if (prev && !isUuid(prev)) return { error: 'Неважечка контрола.' };
    id = await db().transaction(async (tx) => {
      const id = await saveKontrola(tx, firm.id, {
        id: prev, auth: fv(f, 'auth') ?? '', doc: fv(f, 'doc') ?? '', docNo: fv(f, 'docNo'), docDate: fdate(f, 'docDate'), delivered: fdate(f, 'delivered'),
        dueOverride: fdate(f, 'dueOverride'), periodFrom: fdate(f, 'periodFrom'), periodTo: fdate(f, 'periodTo'), subject: fv(f, 'subject'), status: fv(f, 'status'),
        filedOn: fdate(f, 'filedOn'), clientVisible: f.get('clientVisible') === 'on',
      }, u.id);
      await linkFiles(tx, f.getAll('fileIds'), firm.id, KONTROLA_FILE_ENTITY, id);
      return id;
    });
  } catch (e) { return officeError(e); }
  revalidatePath(PATH);
  if (isNew) redirect(`${PATH}?id=${id}`);
  return { ok: 'Зачувано.' };
}

export async function kDelete(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('del');
    if (!(await isOfficeOwner(u))) return { error: OWNER_ONLY_MSG };
    await db().transaction((tx) => deleteKontrola(tx, firm.id, id, u.id));
  } catch (e) { return officeError(e); }
  revalidatePath(PATH);
  redirect(PATH);
}

export async function kFinding(kid: string, _p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    await db().transaction((tx) => saveKontrolaFinding(tx, firm.id, kid, {
      id: fv(f, 'fid'), no: Number(fv(f, 'no')) || null, area: fv(f, 'area'), text: fv(f, 'text') ?? '', article: fv(f, 'article'),
      claimed: fv(f, 'claimed'), interest: fv(f, 'interest'), fine: fv(f, 'fine'), ours: fv(f, 'ours'), oursSource: fv(f, 'oursSource'), account: fv(f, 'account'),
      verdict: fv(f, 'verdict'), officeOk: tri(f.get('officeOk')), systemError: tri(f.get('systemError')), analysis: fv(f, 'analysis'), recommendation: fv(f, 'recommendation'),
    }, u.id));
  } catch (e) { return officeError(e); }
  revalidatePath(PATH);
  return { ok: 'Наодот е зачуван.' };
}

export async function kFindingDelete(kid: string, fid: string): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    await db().transaction((tx) => deleteKontrolaFinding(tx, firm.id, kid, fid, u.id));
  } catch (e) { return officeError(e); }
  revalidatePath(PATH);
  return { ok: 'Избришано.' };
}

/** „Земи од книгите“: the amount recalculated from our books becomes the finding's `ours`. */
export async function kRecalc(kid: string, fid: string): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    const msg = await db().transaction(async (tx) => {
      const [k] = await tx.select().from(kontroli).where(and(eq(kontroli.id, kid), eq(kontroli.firmId, firm.id))).limit(1);
      const [fd] = await tx.select().from(kontrolaFindings).where(and(eq(kontrolaFindings.id, fid), eq(kontrolaFindings.kontrolaId, kid))).limit(1);
      if (!k || !fd) return { error: 'Наодот не е пронајден.' };
      const ev = await findingEvidence(tx, firm.id, k, fd);
      if (!ev.recalc) return { error: 'За ова подрачје програмата не може сама да пресмета износ – внесете конто или износ рачно.' };
      const ours = (ev.recalc.cents / 100).toFixed(2);
      await tx.update(kontrolaFindings).set({ ours, oursSource: ev.recalc.source }).where(eq(kontrolaFindings.id, fid));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'kontrolaRecalc', entityType: 'kontrola_finding', entityId: fid, data: { ours, source: ev.recalc.source } });
      return { ok: `Од книгите: ${ours} ден. (${ev.recalc.source})` };
    });
    revalidatePath(PATH);
    return msg;
  } catch (e) { return officeError(e); }
}

/** Apply a finished AI read of the uploaded record / decision: findings + blank header fields, the file is linked. */
export async function kApplyAi(kid: string, aiId: string): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    const d = await loadAiResult(firm.id, aiId, 'kontrola');
    if (!d) return { error: 'Читањето не е завршено.' };
    const n = await db().transaction(async (tx) => {
      const n = await applyKontrolaAi(tx, firm.id, kid, (d.result ?? {}) as KontrolaAiResult, u.id);
      if (d.fileId) {
        const [l] = await tx.select({ id: fileLinks.fileId }).from(fileLinks).where(and(eq(fileLinks.fileId, d.fileId), eq(fileLinks.entityType, KONTROLA_FILE_ENTITY), eq(fileLinks.entityId, kid))).limit(1);
        if (!l) await linkFiles(tx, [d.fileId], firm.id, KONTROLA_FILE_ENTITY, kid);
      }
      await markAiReadsSaved(tx, firm.id, [aiId]);
      return n;
    });
    revalidatePath(PATH);
    return { ok: n ? `Прочитани ${n} наоди – проверете ги и дополнете ја анализата.` : 'Не се пронајдени наоди во документот – внесете ги рачно.' };
  } catch (e) { return officeError(e); }
}

export async function kAction(kid: string, _p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    const owner = fv(f, 'ownerId');
    await db().transaction((tx) => saveKontrolaAction(tx, firm.id, kid, {
      text: fv(f, 'text') ?? '', findingId: fv(f, 'findingId'), ownerId: owner && isUuid(owner) ? owner : null, ownerName: fv(f, 'ownerName'), due: fdate(f, 'due'), note: fv(f, 'note'),
    }, u.id));
  } catch (e) { return officeError(e); }
  revalidatePath(PATH);
  return { ok: 'Мерката е зачувана.' };
}

export async function kActionDone(id: string, done: boolean): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    await db().transaction((tx) => setKontrolaActionDone(tx, firm.id, id, done ? today() : null, u.id));
  } catch (e) { return officeError(e); }
  revalidatePath(PATH);
  return { ok: done ? 'Извршено.' : 'Вратено.' };
}

/** The edited text of the objection / appeal draft (kept with the case; the Word export uses it). */
export async function kDraft(kid: string, _p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    const text = String(f.get('draft') ?? '').slice(0, 100_000);
    await db().transaction(async (tx) => {
      const [k] = await tx.select({ data: kontroli.data }).from(kontroli).where(and(eq(kontroli.id, kid), eq(kontroli.firmId, firm.id))).limit(1);
      if (!k) throw new Error('not found');
      await tx.update(kontroli).set({ data: { ...(k.data ?? {}), draft: text.trim() ? text : undefined }, updatedBy: u.id }).where(eq(kontroli.id, kid));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'kontrolaDraft', entityType: 'kontrola', entityId: kid, data: { chars: text.length } });
    });
  } catch (e) { if (e instanceof Error && e.message === 'not found') return { error: 'Контролата не е пронајдена.' }; return officeError(e); }
  revalidatePath(PATH);
  return { ok: 'Текстот е зачуван.' };
}
