'use server';
/**
 * „Анализа на решение / записник од контрола“ — server actions. The firm always comes from the session; every
 * mutation needs `office` (removing a case needs `del`) and is audited in its transaction (services in @wise/db).
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { chooseSubmission, suggestTasks, type KontrolaAiResult } from '@wise/core/compliance';
import {
  acceptKontrolaVersion, aiBudgetStatus, applyKontrolaAi, audit, deleteKontrola, deleteKontrolaFinding, discardKontrolaVersion, failKontrolaAi, fileLinks, findingEvidence,
  kontrolaActions, kontrolaFindings, kontroli, KONTROLA_FILE_ENTITY, loadKontrolaCase, markKontrolaFinding, queueKontrolaAi, saveKontrola, saveKontrolaAction, saveKontrolaFinding,
  saveKontrolaText, setKontrolaActionDone, setKontrolaSubType, snapshotKontrolaDocs,
} from '@wise/db';
import { loadAiResult, markAiReadsSaved } from '@/lib/ai';
import type { ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/jobs';
import { autoVersion, dispatchKontrolaReads, kontrolaReads, startKontrolaReads } from '@/lib/kontrola';
import { fdate, fv, isUuid, linkFiles, officeAction, officeError, today } from '@/lib/office';
import { OWNER_ONLY_MSG, isOfficeOwner } from '@/lib/office-owner';

const PATH = '/kontroli';
const tri = (v: FormDataEntryValue | null): boolean | null => (v === 'yes' ? true : v === 'no' ? false : null);

export async function kSave(_p: ActionState, f: FormData): Promise<ActionState> {
  let id = '';
  let reads: string[] = [];
  let fid = '', uid = '';
  const isNew = !fv(f, 'id');
  try {
    const { u, firm } = await officeAction('office');
    fid = firm.id; uid = u.id;
    const prev = fv(f, 'id');
    if (prev && !isUuid(prev)) return { error: 'Неважечка контрола.' };
    [id, reads] = await db().transaction(async (tx) => {
      const id = await saveKontrola(tx, firm.id, {
        id: prev, auth: fv(f, 'auth') ?? '', doc: fv(f, 'doc') ?? '', docNo: fv(f, 'docNo'), docDate: fdate(f, 'docDate'), delivered: fdate(f, 'delivered'),
        dueOverride: fdate(f, 'dueOverride'), periodFrom: fdate(f, 'periodFrom'), periodTo: fdate(f, 'periodTo'), subject: fv(f, 'subject'), status: fv(f, 'status'),
        filedOn: fdate(f, 'filedOn'), clientVisible: f.get('clientVisible') === 'on',
      }, u.id);
      const ids = f.getAll('fileIds').filter(isUuid);
      await linkFiles(tx, ids, firm.id, KONTROLA_FILE_ENTITY, id);
      // the attached act (PDF / photo / Word) is read right away — the case page shows the progress and the findings
      return [id, await startKontrolaReads(tx, firm.id, u.id, id, ids)] as const;
    });
  } catch (e) { return officeError(e); }
  await dispatchKontrolaReads(reads);
  if (!isNew) await autoVersion(fid, id, uid);
  revalidatePath(PATH);
  if (isNew) redirect(`${PATH}?id=${id}`);
  return { ok: reads.length ? 'Зачувано. Прикачениот акт се чита – наодите ќе се појават подолу.' : 'Зачувано.' };
}

/** „↻ Прочитај го прикачениот акт“: read an act already attached to the case (again). */
export async function kReadFile(kid: string, fileId: string): Promise<ActionState> {
  let reads: string[] = [];
  try {
    const { u, firm } = await officeAction('office');
    if (!isUuid(kid) || !isUuid(fileId)) return { error: 'Неважечки податоци.' };
    reads = await db().transaction(async (tx) => {
      const [k] = await tx.select({ id: kontroli.id }).from(kontroli).where(and(eq(kontroli.id, kid), eq(kontroli.firmId, firm.id))).limit(1);
      if (!k) return null;
      const [l] = await tx.select({ id: fileLinks.fileId }).from(fileLinks).where(and(eq(fileLinks.fileId, fileId), eq(fileLinks.entityType, KONTROLA_FILE_ENTITY), eq(fileLinks.entityId, kid))).limit(1);
      if (!l) return null;
      return startKontrolaReads(tx, firm.id, u.id, kid, [fileId]);
    }) ?? [];
    if (!reads.length) return { error: 'Документот не е пронајден или не може да се чита (PDF, слика, Word или TXT).' };
  } catch (e) { return officeError(e); }
  await dispatchKontrolaReads(reads);
  revalidatePath(PATH);
  return { ok: 'Се чита…' };
}

/** The drop zone on the case page: the uploaded act is attached to the case and read. */
export async function kReadUpload(kid: string, fileIds: string[]): Promise<{ ids?: string[]; error?: string }> {
  let reads: string[] = [];
  try {
    const { u, firm } = await officeAction('office');
    if (!isUuid(kid)) return { error: 'Неважечка контрола.' };
    const ids = fileIds.filter(isUuid).slice(0, 10);
    reads = await db().transaction(async (tx) => {
      const [k] = await tx.select({ id: kontroli.id }).from(kontroli).where(and(eq(kontroli.id, kid), eq(kontroli.firmId, firm.id))).limit(1);
      if (!k) return null;
      await linkFiles(tx, ids, firm.id, KONTROLA_FILE_ENTITY, kid);
      return startKontrolaReads(tx, firm.id, u.id, kid, ids);
    }) ?? [];
    if (!reads.length) return { error: 'Изберете PDF, слика (JPG/PNG), Word (.docx) или TXT.' };
  } catch (e) { return officeError(e); }
  await dispatchKontrolaReads(reads);
  return { ids: reads };
}

/** ✕ on a failed / unwanted read: it is no longer shown on the case. */
export async function kDismissRead(kid: string, aiId: string): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    await db().transaction(async (tx) => {
      const [k] = await tx.select({ data: kontroli.data }).from(kontroli).where(and(eq(kontroli.id, kid), eq(kontroli.firmId, firm.id))).limit(1);
      if (!k) return;
      await tx.update(kontroli).set({ data: { ...(k.data ?? {}), reads: kontrolaReads(k).filter((r) => r.id !== aiId) }, updatedBy: u.id }).where(eq(kontroli.id, kid));
    });
  } catch (e) { return officeError(e); }
  revalidatePath(PATH);
  return { ok: 'Отстрането.' };
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
    await autoVersion(firm.id, kid, u.id);
  } catch (e) { return officeError(e); }
  revalidatePath(PATH);
  return { ok: 'Наодот е зачуван.' };
}

export async function kFindingDelete(kid: string, fid: string): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    await db().transaction((tx) => deleteKontrolaFinding(tx, firm.id, kid, fid, u.id));
    await autoVersion(firm.id, kid, u.id);
  } catch (e) { return officeError(e); }
  revalidatePath(PATH);
  return { ok: 'Избришано.' };
}

/** „⚖ Оспори“ / „½ Делумно“ / „✓ Прифати“ / „↺ авто“ on a finding — the documents follow (auto version). */
export async function kMark(kid: string, fid: string, rec: string | null): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    if (!isUuid(kid) || !isUuid(fid)) return { error: 'Неважечки податоци.' };
    await db().transaction((tx) => markKontrolaFinding(tx, firm.id, kid, fid, rec, u.id));
    await autoVersion(firm.id, kid, u.id);
  } catch (e) { return officeError(e); }
  revalidatePath(PATH);
  return { ok: 'Означено.' };
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
    if (msg.ok) await autoVersion(firm.id, kid, u.id);
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
    // applied already (another tab / a second poll): the findings are not added twice
    if (d.status === 'saved') return { ok: 'Наодите од овој документ се веќе додадени.' };
    const noai = d.model === 'noai' || !!(d.result as KontrolaAiResult | null)?.noai;
    const n = await db().transaction(async (tx) => {
      const n = await applyKontrolaAi(tx, firm.id, kid, (d.result ?? {}) as KontrolaAiResult, u.id);
      if (d.fileId) {
        const [l] = await tx.select({ id: fileLinks.fileId }).from(fileLinks).where(and(eq(fileLinks.fileId, d.fileId), eq(fileLinks.entityType, KONTROLA_FILE_ENTITY), eq(fileLinks.entityId, kid))).limit(1);
        if (!l) await linkFiles(tx, [d.fileId], firm.id, KONTROLA_FILE_ENTITY, kid);
      }
      await markAiReadsSaved(tx, firm.id, [aiId]);
      return n;
    });
    if (n) await autoVersion(firm.id, kid, u.id);
    revalidatePath(PATH);
    const tag = noai ? ' (прочитано без AI – проверете ги наодите)' : '';
    return n ? { ok: `Прочитани ${n} наоди${tag} – проверете ги и дополнете ја анализата.` } : { error: `Не се пронајдени наоди во документот${tag} – внесете ги рачно („✎ Внеси рачно“).` };
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

/** The edited text of the external document (`which=external`) or of the internal analysis (`which=internal`); kept as a version. */
export async function kDraft(kid: string, _p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    if (!isUuid(kid)) return { error: 'Неважечка контрола.' };
    const which = f.get('which') === 'internal' ? 'internal' : 'external';
    const text = String(f.get('draft') ?? '');
    await db().transaction((tx) => saveKontrolaText(tx, firm.id, kid, which, text, u.id));
  } catch (e) { return officeError(e); }
  revalidatePath(PATH);
  return { ok: 'Текстот е зачуван (нова верзија).' };
}

/** The document type the office picks instead of the program's choice (empty = automatic). */
export async function kSubType(kid: string, _p: ActionState, f: FormData): Promise<ActionState> {
  let fid = '', uid = '';
  try {
    const { u, firm } = await officeAction('office');
    if (!isUuid(kid)) return { error: 'Неважечка контрола.' };
    await db().transaction((tx) => setKontrolaSubType(tx, firm.id, kid, fv(f, 'subType'), u.id));
    fid = firm.id; uid = u.id;
  } catch (e) { return officeError(e); }
  await autoVersion(fid, kid, uid);
  revalidatePath(PATH);
  return { ok: 'Видот на документот е променет.' };
}

/** „🧾 Подготви приговор / жалба“: the current documents are stored as a version of the case (free, from the data). */
export async function kPrepare(kid: string): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    if (!isUuid(kid)) return { error: 'Неважечка контрола.' };
    const added = await db().transaction((tx) => snapshotKontrolaDocs(tx, firm.id, kid, u.id, today()));
    revalidatePath(PATH);
    return { ok: added ? 'Подготвено – документите се зачувани како нова верзија (подолу).' : 'Документите се веќе подготвени и не се променети (подолу).' };
  } catch (e) { return officeError(e); }
}

/** ✓ Прифати / ↺ Врати: a stored version (AI, edit or auto) becomes the case's text. */
export async function kVersionAccept(kid: string, vid: string): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    if (!isUuid(kid) || !isUuid(vid)) return { error: 'Неважечки податоци.' };
    const v = await db().transaction((tx) => acceptKontrolaVersion(tx, firm.id, kid, vid, u.id));
    revalidatePath(PATH);
    return { ok: v.kind === 'ai' ? 'AI текстот е прифатен – проверете го и уредете го пред потпис.' : 'Верзијата е вратена.' };
  } catch (e) { return officeError(e); }
}

/** ✕ Отфрли an AI version (kept in the list, marked discarded). */
export async function kVersionDiscard(kid: string, vid: string): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    if (!isUuid(kid) || !isUuid(vid)) return { error: 'Неважечки податоци.' };
    await db().transaction((tx) => discardKontrolaVersion(tx, firm.id, kid, vid, u.id));
  } catch (e) { return officeError(e); }
  revalidatePath(PATH);
  return { ok: 'Отфрлено.' };
}

/**
 * „💲 AI правна анализа“ (Sonnet) / „🔍 Детално“ (Opus): queued for the worker (`kontrola.ai`) — refused while the AI
 * budget is paused. The result comes back as a new version for the user to accept or discard.
 */
export async function kAiStart(kid: string, deep: boolean): Promise<ActionState> {
  let job: { kid: string; firmId: string; reqId: string; userId: string; deep: boolean } | null = null;
  try {
    const { u, firm } = await officeAction('office');
    if (!isUuid(kid)) return { error: 'Неважечка контрола.' };
    const st = await aiBudgetStatus(db(), firm.id);
    if (st.paused) return { error: st.msg };
    const [n] = await db().select({ id: kontrolaFindings.id }).from(kontrolaFindings).where(and(eq(kontrolaFindings.kontrolaId, kid), eq(kontrolaFindings.firmId, firm.id))).limit(1);
    if (!n) return { error: 'Нема наоди за анализа – внесете ги или прочитајте го актот.' };
    const reqId = await db().transaction((tx) => queueKontrolaAi(tx, firm.id, kid, deep, u.id));
    job = { kid, firmId: firm.id, reqId, userId: u.id, deep };
  } catch (e) { return officeError(e); }
  try { await enqueue('kontrola.ai', job); } catch (e) {
    console.error('[kontrola] ai enqueue', e);
    await db().transaction((tx) => failKontrolaAi(tx, job!.firmId, kid, job!.reqId, 'AI анализата не можеше да започне (серверот за позадинска обработка не одговара) – обидете се повторно.'));
  }
  revalidatePath(PATH);
  return { ok: '⏳ AI анализата се изработува (обично 1–3 минути)…' };
}

/** „+ Додај ги предложените задачи“: the internal analysis' task list becomes corrective actions (those not added yet). */
export async function kAddTasks(kid: string): Promise<ActionState> {
  try {
    const { u, firm } = await officeAction('office');
    if (!isUuid(kid)) return { error: 'Неважечка контрола.' };
    const n = await db().transaction(async (tx) => {
      const c = await loadKontrolaCase(tx, firm.id, kid, today());
      if (!c) return -1;
      const have = new Set((await tx.select({ text: kontrolaActions.text }).from(kontrolaActions).where(eq(kontrolaActions.kontrolaId, kid))).map((a) => a.text));
      let n = 0;
      for (const t of suggestTasks(c.input, chooseSubmission(c.input))) {
        if (have.has(t.text)) continue;
        const fd = t.findingNo == null ? null : c.F.find((f) => f.no === t.findingNo)?.id ?? null;
        await saveKontrolaAction(tx, firm.id, kid, { text: t.text, findingId: fd, ownerName: t.owner, due: t.due }, u.id);
        n++;
      }
      return n;
    });
    if (n < 0) return { error: 'Контролата не е пронајдена.' };
    revalidatePath(PATH);
    return { ok: n ? `Додадени ${n} задачи.` : 'Задачите се веќе додадени.' };
  } catch (e) { return officeError(e); }
}
