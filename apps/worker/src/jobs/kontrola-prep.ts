/**
 * „🤖 Подготви приговор со AI“ (`kontrola.prepare`, started by the office owner on a case of „📑 Контроли и решенија“):
 * one click runs every step of the objection, each recorded in `data.prep.steps` for the case page:
 *
 *  1. the act is read when the case has no findings yet — a finished read is applied, a running one is awaited, an
 *     attached act without a read is read now (the `ai.read-document` reader, same rules and budget);
 *  2. the dispute marks are proposed for the unmarked findings (`proposeKontrolaMarks`; the person changes them);
 *  3. the „💲 AI правна анализа“ with the full stored law texts (`runKontrolaAi`, Sonnet / Opus on „🔍 Детално“);
 *  4. + 5. the remedy document and its numbered attachments are generated into a new AI version (DRAFT: model and
 *     cost shown, nothing applied, filed or sent — the person reviews, edits and clicks „✓ Прифати“).
 * The budget guard / `askText` are those of the analysis; an error stops the chain and is shown on the case.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { isDisputed, type KontrolaAiResult } from '@wise/core/compliance';
import {
  aiDocuments, applyKontrolaAi, fileLinks, files, KONTROLA_FILE_ENTITY, kontrolaAiState, kontrolaFindings, kontroli, loadKontrolaCase, proposeKontrolaMarks,
  updateKontrolaPrep, type Tx,
} from '@wise/db';
import { defineJob } from '../job';
import { runReadDocument } from './ai-read-document';
import { runKontrolaAi } from './kontrola-ai';

export interface KontrolaPrepJob { kid: string; firmId: string; reqId: string; userId?: string | null; deep?: boolean }

export interface KontrolaPrepDeps {
  /** Runs one `ai_documents` read (tests inject a fake). */
  read?: (db: Tx, docId: string) => Promise<void>;
  /** How long a read started elsewhere is awaited (ms). */
  waitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const readable = (f: { name: string; mime: string }) =>
  /^application\/pdf$|^image\/(jpeg|png|webp)$|wordprocessingml|^text\/plain$/.test(f.mime) || /\.(pdf|jpe?g|png|webp|docx|txt)$/i.test(f.name);

interface Read { id: string; fileId: string | null; at: string }

/** Step 1: findings from the act (returns how many the case has afterwards). */
async function readAct(db: Tx, j: KontrolaPrepJob, deps: KontrolaPrepDeps, log: (t: string, ok?: boolean) => Promise<void>): Promise<number> {
  const count = async () => (await db.select({ id: kontrolaFindings.id }).from(kontrolaFindings).where(eq(kontrolaFindings.kontrolaId, j.kid))).length;
  if (await count()) return count();
  const [k] = await db.select().from(kontroli).where(and(eq(kontroli.id, j.kid), eq(kontroli.firmId, j.firmId))).limit(1);
  if (!k) return 0;
  let reads = (((k.data ?? {}) as { reads?: Read[] }).reads ?? []);
  const rows = async () => (reads.length ? db.select().from(aiDocuments).where(and(eq(aiDocuments.firmId, j.firmId), inArray(aiDocuments.id, reads.map((r) => r.id)))) : []);
  // an attached act without any read: read it now
  if (!reads.length) {
    const F = await db.select({ id: files.id, name: files.name, mime: files.mime }).from(fileLinks).innerJoin(files, eq(files.id, fileLinks.fileId))
      .where(and(eq(fileLinks.entityType, KONTROLA_FILE_ENTITY), eq(fileLinks.entityId, j.kid), eq(files.firmId, j.firmId), eq(files.status, 'ready')));
    const ok = F.filter(readable);
    if (!ok.length) return 0;
    const ins = await db.insert(aiDocuments).values(ok.map((f) => ({ firmId: j.firmId, fileId: f.id, kind: 'kontrola' as const, options: { kontrolaId: j.kid }, createdBy: j.userId ?? null }))).returning({ id: aiDocuments.id, fileId: aiDocuments.fileId });
    const at = new Date().toISOString();
    reads = ins.map((r) => ({ id: r.id, fileId: r.fileId, at }));
    await db.update(kontroli).set({ data: { ...(k.data ?? {}), reads } }).where(eq(kontroli.id, j.kid));
    await log(`Читање на актот (${ok.length} ${ok.length === 1 ? 'документ' : 'документи'})…`);
    for (const r of reads) await (deps.read ?? ((d, id) => runReadDocument(d, id)))(db, r.id);
  } else {
    // a read started from the page: wait for it (bounded)
    const until = Date.now() + (deps.waitMs ?? 180_000);
    while ((await rows()).some((d) => d.status === 'queued' || d.status === 'reading') && Date.now() < until) await (deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(3000);
  }
  for (const d of await rows()) {
    if (d.status !== 'done') continue;
    await db.transaction(async (tx) => {
      await applyKontrolaAi(tx, j.firmId, j.kid, (d.result ?? {}) as KontrolaAiResult, j.userId ?? null);
      await tx.update(aiDocuments).set({ status: 'saved' }).where(eq(aiDocuments.id, d.id));
    });
  }
  const n = await count();
  const failed = (await rows()).find((d) => d.status === 'error');
  await log(n ? `Прочитани ${n} наоди од актот – проверете ги.` : `Актот не е прочитан${failed?.error ? `: ${failed.error}` : ''}.`, n > 0);
  return n;
}

export async function runKontrolaPrep(db: Tx, j: KontrolaPrepJob, deps: KontrolaPrepDeps = {}): Promise<string | null> {
  const step = async (t: string, ok = true) => { await db.transaction((tx) => updateKontrolaPrep(tx, j.firmId, j.kid, j.reqId, { step: t, ok })); };
  const fail = async (error: string) => { await db.transaction((tx) => updateKontrolaPrep(tx, j.firmId, j.kid, j.reqId, { fin: { status: 'error', error: error.slice(0, 500) } })); return null; };
  try {
    if (!(await db.transaction((tx) => updateKontrolaPrep(tx, j.firmId, j.kid, j.reqId, { step: 'Започнато' })))) return null; // replaced by a newer request
    // 1. the act
    const n = await readAct(db, j, deps, step);
    if (!n) return fail('Нема наоди: прикачете го актот (PDF / слика / Word) или внесете ги наодите рачно, па повторете.');
    // 2. proposed marks
    const marks = await db.transaction((tx) => proposeKontrolaMarks(tx, j.firmId, j.kid, j.userId ?? null));
    await db.transaction((tx) => updateKontrolaPrep(tx, j.firmId, j.kid, j.reqId, {
      step: marks.length ? `Предложени ознаки за ${marks.length} ${marks.length === 1 ? 'наод' : 'наоди'} (можете да ги промените).` : 'Наодите се веќе означени – ознаките се задржани.',
      fin: { marks },
    }));
    const c = await loadKontrolaCase(db, j.firmId, j.kid);
    if (!c) return fail('Контролата не е пронајдена.');
    if (!c.input.items.some((it) => isDisputed(it.f))) return fail('Ниту еден наод не е означен „оспори“ / „делумно“ – нема што да се оспорува.');
    await step(`Прилози: ${c.att.length} (${c.att.filter((a) => a.fileIds.length || a.render).length} со документ од програмата).`);
    // 3.–5. AI analysis with the full law texts → the remedy document as a new AI version (draft)
    await step(`AI правна анализа со текстовите на законите (${j.deep ? 'детално – Opus' : 'Sonnet'})…`);
    const vid = await runKontrolaAi(db, { kid: j.kid, firmId: j.firmId, reqId: j.reqId, userId: j.userId ?? null, deep: !!j.deep });
    const [k] = await db.select({ data: kontroli.data }).from(kontroli).where(eq(kontroli.id, j.kid)).limit(1);
    const ai = k ? kontrolaAiState(k) : null;
    if (!vid) return fail(ai?.reqId === j.reqId && ai.error ? ai.error : 'AI анализата не заврши.');
    await db.transaction((tx) => updateKontrolaPrep(tx, j.firmId, j.kid, j.reqId, {
      step: 'Документот и прилозите се подготвени како НАЦРТ – прегледајте, уредете и кликнете „✓ Прифати“.',
      fin: { status: 'done', versionId: vid, model: ai?.model, costUsd: ai?.costUsd },
    }));
    return vid;
  } catch (e) {
    return fail((e as Error).message || String(e)).catch(() => null);
  }
}

export const kontrolaPrep = defineJob<KontrolaPrepJob>({
  name: 'kontrola.prepare',
  queue: { retryLimit: 0, expireInSeconds: 20 * 60 },
  async run(data, { db }) {
    if (data?.kid && data.firmId && data.reqId) await runKontrolaPrep(db as unknown as Tx, data);
  },
});
