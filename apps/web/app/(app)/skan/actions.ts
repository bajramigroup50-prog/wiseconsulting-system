'use server';
/**
 * AI document reading — start / retry / remove reads and batch save (legacy `scanFile` 4649 → 13699, `batchRun`
 * 5357, `batchSaveAll` 5376, `outRun` 8415). The reading itself runs in the worker job `ai.read-document`.
 */
import { revalidatePath } from 'next/cache';
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { canDecidePast, vatPeriodName } from '@wise/core/vat/past-period';
import { z } from 'zod';
import type { ScanSaleDraft } from '@wise/core/sales';
import { learnPartnerAlias, partnerIdLabel, type DraftPartnerMatch } from '@wise/core/partners/match';
import {
  aiDocuments, audit, bulkSaveMessage, confirmAllPastDrafts, saveSelectedScanDrafts, archiveScanDrafts, markScanDraftsChecked, confirmPastDraft, refreshStaleScanDrafts, scanNeedsReread, ensurePartner, fileAlreadyUsed, files, partners, pastPeriodContext, rejectPastDraft, saveReadyScanDrafts, setPastHold, skipDraft,
} from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/jobs';
import { actorOf } from '@/lib/sales';
import { isOfficeOwner } from '@/lib/office-owner';
import { autoMergeAfter, withNote } from '@/lib/partner-automerge';
import { Forbidden } from '@/lib/auth';
import { dmy } from '@/lib/fmt';

const AI_READ_DOCUMENT = 'ai.read-document';

const Start = z.object({
  fileIds: z.array(z.uuid()).min(1).max(100),
  kind: z.enum(['purchase', 'sale']),
  batchId: z.uuid().nullable(),
  cash: z.boolean().default(false), warehouseId: z.string().max(40).default(''), costOnly: z.boolean().default(false),
  /** Scanned inside an opened nalog: the saved documents are posted into it. */
  nalogNo: z.string().trim().max(40).default(''),
  /** Outgoing invoices: the VAT article chosen for all of them ('auto' = as read). */
  vatRule: z.enum(['auto', 'vat', 'art32', 'ded', 'noded', 'novat']).default('auto'),
  /** Read a file that is already attached (legacy `readAtt`): no duplicate-file check. */
  reread: z.boolean().default(false),
  /** Read for an open editor (legacy `readIntoDraft`): not listed on the scan screen. */
  inline: z.boolean().default(false),
  /**
   * The photos / scans are the PAGES of one or several invoices (uploaded together): read in one call and grouped by
   * invoice header — each invoice its own draft, linked to the photos of its pages. Images only, up to 20.
   */
  group: z.boolean().default(false),
});

/** Photos that can be read together as the pages of a document. */
const isImageFile = (f: { name: string; mime: string }) => /^image\//.test(f.mime) || /\.(jpe?g|png|webp)$/i.test(f.name);

/** Register uploaded files for reading and enqueue one job per file (or one job for photos read together). */
export async function startScans(input: z.input<typeof Start>): Promise<ActionState & { skipped?: string[]; ids?: string[] }> {
  try {
    const v = Start.parse(input);
    const { u, firm } = await firmAction('scan');
    const F = (await db().select().from(files).where(and(eq(files.firmId, firm.id), inArray(files.id, v.fileIds), eq(files.status, 'ready'))))
      .sort((a, b) => v.fileIds.indexOf(a.id) - v.fileIds.indexOf(b.id));
    const skipped: string[] = [];
    const ids: string[] = [];
    const grouped = v.group && F.length > 1 && F.length <= 20 && F.every(isImageFile);
    await db().transaction(async (tx) => {
      if (grouped) {
        const used = v.reread ? null : await fileAlreadyUsed(tx, firm.id, F.map((f) => f.id));
        if (used) { skipped.push(`${used.name}: веќе е прикачен на ${used.entityType === 'purchase' ? 'влезна фактура' : 'излезна фактура'}`); return; }
        const [d] = await tx.insert(aiDocuments).values({
          firmId: firm.id, fileId: F[0]!.id, kind: v.kind, batchId: v.batchId, createdBy: u.id,
          options: { cash: v.cash, warehouseId: v.warehouseId || null, costOnly: v.costOnly, extraFileIds: F.slice(1).map((f) => f.id), ...(v.inline ? { inline: true } : {}), ...(v.nalogNo ? { nalogNo: v.nalogNo } : {}), ...(v.vatRule !== 'auto' ? { vatRule: v.vatRule } : {}) },
        }).returning({ id: aiDocuments.id });
        ids.push(d!.id);
        await audit(tx, { userId: u.id, firmId: firm.id, action: 'scanStart', entityType: 'ai_document', data: { count: 1, pages: F.length, kind: v.kind, batchId: v.batchId } });
        return;
      }
      for (const f of F) {
        // Duplicate detection, second half: the same file (sha256) already attached to a document.
        const used = v.reread ? null : await fileAlreadyUsed(tx, firm.id, [f.id]);
        if (used) { skipped.push(`${f.name}: веќе е прикачен на ${used.entityType === 'purchase' ? 'влезна фактура' : 'излезна фактура'}`); continue; }
        const [d] = await tx.insert(aiDocuments).values({
          firmId: firm.id, fileId: f.id, kind: v.kind, batchId: v.batchId, createdBy: u.id,
          options: { cash: v.cash, warehouseId: v.warehouseId || null, costOnly: v.costOnly, ...(v.inline ? { inline: true } : {}), ...(v.nalogNo ? { nalogNo: v.nalogNo } : {}), ...(v.vatRule !== 'auto' ? { vatRule: v.vatRule } : {}) },
        }).returning({ id: aiDocuments.id });
        ids.push(d!.id);
      }
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'scanStart', entityType: 'ai_document', data: { count: ids.length, kind: v.kind, batchId: v.batchId } });
    });
    for (const id of ids) await enqueue(AI_READ_DOCUMENT, { docId: id });
    revalidatePath('/skan');
    revalidatePath('/masovno');
    return { ok: grouped && ids.length ? `Се читаат ${F.length} страници (фотографии) како еден документ – секоја фактура ќе биде посебна.` : `Се читаат ${ids.length} документи.`, skipped, ids };
  } catch (e) { return actionError(e); }
}

/**
 * Legacy „Откажи читање“ (`outCancel`): the documents still waiting / being read in this list stop — they are marked
 * as cancelled (the worker skips them and a read in progress does not overwrite the mark); „↻ Повторно“ reads them again.
 */
export async function cancelScans(kind: 'sale' | 'purchase', batchId: string | null): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('scan');
    const n = await db().transaction(async (tx) => {
      const R = await tx.update(aiDocuments).set({ status: 'error', error: 'Читањето е откажано.', options: sql`${aiDocuments.options} || '{"cancelled":true}'::jsonb` })
        .where(and(eq(aiDocuments.firmId, firm.id), inArray(aiDocuments.status, ['queued', 'reading']), batchId ? eq(aiDocuments.batchId, batchId) : and(eq(aiDocuments.kind, kind), sql`${aiDocuments.batchId} is null`)))
        .returning({ id: aiDocuments.id });
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'scanCancel', entityType: 'ai_document', data: { kind, batchId, n: R.length } });
      return R.length;
    });
    revalidatePath('/skan');
    revalidatePath('/masovno');
    revalidatePath('/masovnoM');
    return { ok: `Откажано читање на ${n} документи.` };
  } catch (e) { return actionError(e); }
}

export async function retryScan(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('scan');
    await db().transaction(async (tx) => {
      await tx.update(aiDocuments).set({ status: 'queued', error: null, options: sql`(${aiDocuments.options} - 'cancelled' - 'errCode' - 'errDetail') || '{"retry":true}'::jsonb` }).where(and(eq(aiDocuments.id, id), eq(aiDocuments.firmId, firm.id)));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'scanRetry', entityType: 'ai_document', entityId: id });
    });
    await enqueue(AI_READ_DOCUMENT, { docId: id });
  } catch (e) { return actionError(e); }
  revalidatePath('/skan');
  return { ok: 'Повторно читање.' };
}

/** The unsaved reads of a scan list (the screen's own query: `/skan` without a batch, or one batch). */
async function listDocs(firmId: string, kind: 'purchase' | 'sale', batchId: string | null) {
  return db().select().from(aiDocuments).where(and(eq(aiDocuments.firmId, firmId), eq(aiDocuments.kind, kind), eq(aiDocuments.status, 'done'),
    batchId ? eq(aiDocuments.batchId, batchId) : and(sql`${aiDocuments.batchId} is null`, sql`not (${aiDocuments.options} ? 'inline')`)))
    .orderBy(desc(aiDocuments.createdAt)).limit(300);
}

/**
 * „↻ Примени ги правилата повторно“: the drafts of every unsaved read of the list are rebuilt from the stored read with
 * the current rules (attached pages, supplier kontos, electricity, previous debt, pro-forma) — no AI, no cost. Saved
 * purchases / invoices are never touched.
 */
export async function applyScanRules(kind: 'purchase' | 'sale', batchId: string | null): Promise<ActionState> {
  try {
    if (batchId && !/^[0-9a-f-]{36}$/i.test(batchId)) return { error: 'Неважечка листа.' };
    const { u, firm } = await firmAction('scan');
    const D = await listDocs(firm.id, kind === 'sale' ? 'sale' : 'purchase', batchId);
    const r = await refreshStaleScanDrafts(db(), firm, D, { force: true, userId: u.id });
    await audit(db(), { userId: u.id, firmId: firm.id, action: 'scanRules', entityType: 'ai_document', data: { kind, batchId, n: r.rebuilt } });
    revalidatePath('/skan');
    revalidatePath('/masovno');
    revalidatePath('/masovnoM');
    return { ok: `Правилата се применети повторно на ${r.rebuilt} документи.` };
  } catch (e) { return actionError(e); }
}

/**
 * „↻ Прочитај повторно · 💲 AI“: the stored read lacks what the rules need (the previous debt of a bill, which of two
 * same documents is the pro-forma) — read again with AI. With `id`: that read; else every read of the list that needs it
 * (`scanNeedsReread`). Reads with a saved invoice are never read again.
 */
export async function rereadScans(kind: 'purchase' | 'sale', batchId: string | null, id?: string): Promise<ActionState> {
  try {
    if (batchId && !/^[0-9a-f-]{36}$/i.test(batchId)) return { error: 'Неважечка листа.' };
    const { u, firm } = await firmAction('scan');
    const D = id
      ? (await db().select().from(aiDocuments).where(and(eq(aiDocuments.id, id), eq(aiDocuments.firmId, firm.id))).limit(1)).filter((d) => d.status === 'done' || d.status === 'error')
      : (await listDocs(firm.id, kind === 'sale' ? 'sale' : 'purchase', batchId)).filter(scanNeedsReread);
    const ids = D.filter((d) => !d.drafts.some((x) => x.savedId)).map((d) => d.id);
    if (!ids.length) return { error: id ? 'Дел од фактурите се веќе зачувани.' : 'Нема документи за повторно читање.' };
    await db().transaction(async (tx) => {
      // a NEW AI read (`reread`): never the free reader or a reuse of an earlier read of the same file (sha256)
      await tx.update(aiDocuments).set({
        status: 'queued', error: null, drafts: [],
        options: sql`(${aiDocuments.options} - 'cancelled' - 'errCode' - 'errDetail' - 'cachedFrom' - 'aiWhy' - 'progress') || '{"retry":true,"reread":true}'::jsonb`,
      }).where(and(inArray(aiDocuments.id, ids), eq(aiDocuments.firmId, firm.id)));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'scanReread', entityType: 'ai_document', data: { kind, batchId, n: ids.length } });
    });
    for (const x of ids) await enqueue(AI_READ_DOCUMENT, { docId: x });
    revalidatePath('/skan');
    revalidatePath('/masovno');
    return { ok: `Повторно читање со AI: ${ids.length} документи.` };
  } catch (e) { return actionError(e); }
}

export async function removeScan(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('scan');
    await db().transaction(async (tx) => {
      await tx.delete(aiDocuments).where(and(eq(aiDocuments.id, id), eq(aiDocuments.firmId, firm.id)));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'scanRemove', entityType: 'ai_document', entityId: id });
    });
  } catch (e) { return actionError(e); }
  revalidatePath('/skan');
  revalidatePath('/masovno');
  return { ok: 'Отстрането.' };
}

/**
 * Save every purchase draft whose check is `ok` (legacy `batchSaveAll`): each invoice of a file is its own purchase
 * with its own journal, in its own transaction; the source file is linked to each (with the invoice's pages).
 * Duplicates (`dup`), invoices to check and skipped ones are left as they are. A draft dated in a PAST VAT period is
 * held („⏸ минат период – за проверка“, `@wise/db` `saveReadyScanDrafts`) for the owner's decision.
 */
/** „Шема“ chosen for the batch: a number 1…99, or `undefined` = by the rules (partner default / Шема 1). */
const batchScheme = (v: unknown): number | undefined => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 99 ? n : undefined; };

async function savePurchaseDraftsOk(where: SQL | undefined, scheme?: number): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('savePur');
    const R = await saveReadyScanDrafts(db(), { firm, kind: 'purchase', where, actor: actorOf(u), past: await pastPeriodContext(db(), firm), scheme });
    const am = await autoMergeAfter(firm.id);
    revalidatePath('/', 'layout');
    return withNote(bulkSaveMessage('purchase', R), am);
  } catch (e) { return actionError(e); }
}

/** Save every draft of a batch whose check is `ok` (legacy `batchSaveAll`). */
export async function saveBatchOk(batchId: string, scheme?: number | null): Promise<ActionState> {
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) return { error: 'Неважечка листа.' };
  return savePurchaseDraftsOk(eq(aiDocuments.batchId, batchId), batchScheme(scheme));
}

/** „Зачувај ги сите спремни“ on the scan screen: every ready invoice read there (one file may hold several). */
export async function savePurchasesOk(scheme?: number | null): Promise<ActionState> {
  return savePurchaseDraftsOk(and(sql`${aiDocuments.batchId} is null`, sql`not (${aiDocuments.options} ? 'inline')`), batchScheme(scheme));
}

/** „Прескокни“ / „Врати“ one invoice of a read document (the others of the same file stay). */
export async function skipScanDraft(docId: string, index: number, skip = true): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('scan');
    await db().transaction(async (tx) => {
      await skipDraft(tx, firm.id, docId, index, skip);
      await audit(tx, { userId: u.id, firmId: firm.id, action: skip ? 'scanSkip' : 'scanUnskip', entityType: 'ai_document', entityId: docId, data: { index } });
    });
  } catch (e) { return actionError(e); }
  revalidatePath('/skan');
  revalidatePath('/skan/proverka');
  revalidatePath('/masovno');
  return { ok: skip ? 'Фактурата е прескокната.' : 'Фактурата е вратена.' };
}

const PICKED = /^[0-9a-f-]{36}:\d{1,4}$/i;

/** „✓ Прокнижи ги избраните“ (За физичка проверка): the ticked reads, checked against the paper, saved each in its own period. */
export async function saveSelectedScansAction(kind: 'sale' | 'purchase', ids: string[]): Promise<ActionState> {
  try {
    if ((kind !== 'sale' && kind !== 'purchase') || !ids.length || ids.length > 2000 || ids.some((x) => !PICKED.test(x))) return { error: 'Изберете фактури (кутичката лево).' };
    const { u, firm } = await firmAction(kind === 'sale' ? 'saveInv' : 'savePur');
    const r = await db().transaction((tx) => saveSelectedScanDrafts(tx, { firmId: firm.id, kind, ids, actor: actorOf(u) }));
    for (const p of ['/skan', '/skan/proverka', '/vnes', '/ddv', '/izlez', '/vlez', '/nalozi']) revalidatePath(p);
    const bad = r.failed.length ? ` Не се зачувани ${r.failed.length}: ${r.failed.slice(0, 6).map((f) => `${f.number} (${f.why})`).join('; ')}${r.failed.length > 6 ? '…' : ''}` : '';
    const msg = `Зачувани и прокнижени ${r.saved} документи (фактури / сметки).${bad}`;
    return r.saved || !r.failed.length ? { ok: msg } : { error: msg };
  } catch (e) { return actionError(e); }
}

/** „📁 Само за архива“ (`undo` = „Врати“): the ticked reads are checked and not posted — cancelled, not an invoice… */
export async function archiveScansAction(undo: boolean, ids: string[]): Promise<ActionState> {
  try {
    if (!ids.length || ids.length > 2000 || ids.some((x) => !PICKED.test(x))) return { error: 'Изберете фактури (кутичката лево).' };
    const { u, firm } = await firmAction('scan');
    const n = await db().transaction((tx) => archiveScanDrafts(tx, { firmId: firm.id, ids, userId: u.id, undo }));
    for (const p of ['/skan', '/skan/proverka', '/vnes']) revalidatePath(p);
    return { ok: undo ? `Вратени ${n} фактури во листата за проверка.` : `${n} фактури се оставени само за архива (не се книжат).` };
  } catch (e) { return actionError(e); }
}

/** „✓ Проверено“ (`undo` = back to „за физичка проверка“): posted reads checked against the paper documents. */
export async function markScansCheckedAction(undo: boolean, ids: string[]): Promise<ActionState> {
  try {
    if (!ids.length || ids.length > 2000 || ids.some((x) => !PICKED.test(x))) return { error: 'Изберете фактури (кутичката лево).' };
    const { u, firm } = await firmAction('scan');
    const n = await db().transaction((tx) => markScanDraftsChecked(tx, { firmId: firm.id, ids, userId: u.id, undo }));
    for (const p of ['/skan/proverka', '/vnes']) revalidatePath(p);
    return { ok: undo ? `${n} вратени за физичка проверка.` : `${n} означени како физички проверени.` };
  } catch (e) { return actionError(e); }
}

export interface ScanState {
  id: string; kind: string; status: string; error: string | null; batchId: string | null;
  /** Every invoice found; `docId` / `index` = where the draft is stored (a part of a split PDF is its own document). */
  drafts: { draft: Record<string, unknown>; status: string; msg: string; savedId?: string; skipped?: boolean; docId: string; index: number }[];
}

/**
 * Poll reads started from the scan screen or an editor (legacy `stage()` progress + `scanFile` result). A PDF cut
 * into one part per invoice (`result.split`) is reported as one read with the invoices of all its parts — done when
 * every part is read.
 */
export async function scanStatus(ids: string[]): Promise<ScanState[]> {
  const ok = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 100);
  if (!ok.length) return [];
  const { firm } = await firmAction('scan');
  const D = await db().select().from(aiDocuments).where(and(eq(aiDocuments.firmId, firm.id), inArray(aiDocuments.id, ok)));
  const splitOf = (d: (typeof D)[number]) => { const s = (d.result as { split?: unknown } | null)?.split; return Array.isArray(s) ? s.filter((x): x is string => typeof x === 'string') : []; };
  const kidIds = D.flatMap(splitOf);
  const K = kidIds.length ? await db().select().from(aiDocuments).where(and(eq(aiDocuments.firmId, firm.id), inArray(aiDocuments.id, kidIds))) : [];
  const ready = (d: (typeof D)[number]) => d.status === 'done' || d.status === 'saved';
  const draftsOf = (d: (typeof D)[number]) => (ready(d) ? d.drafts.map((x, index) => ({ ...x, docId: d.id, index })) : []);
  return D.map((d) => {
    const kids = splitOf(d).map((id) => K.find((k) => k.id === id)).filter((k): k is (typeof K)[number] => !!k);
    if (!kids.length) return { id: d.id, kind: d.kind, status: d.status, error: d.error, batchId: d.batchId, drafts: draftsOf(d) };
    const busy = kids.some((k) => k.status === 'queued' || k.status === 'reading');
    const status = busy ? 'reading' : kids.every((k) => k.status === 'error') ? 'error' : 'done';
    return { id: d.id, kind: d.kind, status, error: status === 'error' ? kids[0]!.error : null, batchId: kids[0]!.batchId, drafts: busy ? [] : kids.flatMap(draftsOf) };
  });
}

/**
 * An editor took over the read result (legacy `readIntoDraft`): mark the read as used. A file with several invoices:
 * only the first one went into the editor (`index`) — the others stay on the scan screen, each to be saved on its own.
 */
export async function scanTaken(id: string, taken?: { docId: string; index: number }): Promise<ActionState & { rest?: number }> {
  try {
    const { u, firm } = await firmAction('scan');
    let rest = 0;
    await db().transaction(async (tx) => {
      const [d] = await tx.select().from(aiDocuments).where(and(eq(aiDocuments.id, id), eq(aiDocuments.firmId, firm.id))).limit(1);
      if (!d) return;
      const split = (d.result as { split?: unknown } | null)?.split;
      const docs = Array.isArray(split) && split.length
        ? await tx.select().from(aiDocuments).where(and(eq(aiDocuments.firmId, firm.id), inArray(aiDocuments.id, split.filter((x): x is string => typeof x === 'string'))))
        : [d];
      rest = docs.reduce((a, x) => a + x.drafts.filter((y, i) => !(x.id === taken?.docId && i === taken.index) && !y.savedId && !y.skipped).length, 0);
      if (!taken || !rest) {
        for (const x of docs) await tx.update(aiDocuments).set({ status: 'saved' }).where(eq(aiDocuments.id, x.id));
      } else {
        // the other invoices of the file leave the editor's hidden read and wait on the scan screen
        for (const x of docs) {
          const options = { ...((x.options ?? {}) as Record<string, unknown>) };
          delete options.inline;
          const drafts = x.drafts.map((y, i) => (x.id === taken.docId && i === taken.index ? { ...y, skipped: true, msg: 'отворена во уредникот' } : y));
          await tx.update(aiDocuments).set({ drafts, options, ...(drafts.every((y) => y.savedId || y.skipped) ? { status: 'saved' as const } : {}) }).where(eq(aiDocuments.id, x.id));
        }
      }
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'scanIntoDraft', entityType: 'ai_document', entityId: id, ...(rest ? { data: { rest } } : {}) });
    });
    revalidatePath('/skan');
    return { ok: 'ok', rest };
  } catch (e) { return actionError(e); }
}

/** Clear a batch list (legacy `batchClear`): the documents leave the batch list, nothing is deleted. */
export async function clearBatch(batchId: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('scan');
    const D = await db().select({ id: aiDocuments.id, status: aiDocuments.status }).from(aiDocuments).where(and(eq(aiDocuments.firmId, firm.id), eq(aiDocuments.batchId, batchId)));
    if (D.some((d) => d.status === 'reading' || d.status === 'queued')) return { error: 'Почекајте да заврши читањето.' };
    await db().transaction(async (tx) => {
      await tx.update(aiDocuments).set({ batchId: null, options: sql`${aiDocuments.options} || jsonb_build_object('inline', true)` })
        .where(and(eq(aiDocuments.firmId, firm.id), eq(aiDocuments.batchId, batchId)));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'batchClear', entityType: 'ai_document', data: { batchId, count: D.length } });
    });
  } catch (e) { return actionError(e); }
  revalidatePath('/masovno');
  return { ok: 'Листата е исчистена.' };
}

/** Legacy `outDeep` (8436): read the document again with the detailed model (slower, ~1–2 min.). */
export async function deepScan(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('scan');
    const [d] = await db().select().from(aiDocuments).where(and(eq(aiDocuments.id, id), eq(aiDocuments.firmId, firm.id))).limit(1);
    if (!d) return { error: 'Документот не постои.' };
    if (d.drafts.some((x) => x.savedId)) return { error: 'Дел од фактурите се веќе зачувани.' };
    await db().transaction(async (tx) => {
      await tx.update(aiDocuments).set({ status: 'queued', error: null, drafts: [], options: { ...d.options, deep: true } }).where(eq(aiDocuments.id, id));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'scanDeep', entityType: 'ai_document', entityId: id });
    });
    await enqueue(AI_READ_DOCUMENT, { docId: id });
  } catch (e) { return actionError(e); }
  revalidatePath('/skan');
  return { ok: 'Подетално читање…' };
}

/** Legacy `outEnsurePartner` from the review list: add the read buyer to the partners and link it to the draft. */
export async function ensureScanBuyer(docId: string, index: number): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('write');
    await db().transaction(async (tx) => {
      const [d] = await tx.select().from(aiDocuments).where(and(eq(aiDocuments.id, docId), eq(aiDocuments.firmId, firm.id))).for('update').limit(1);
      const x = d?.drafts[index];
      if (!d || !x) throw new Error('Документот не постои.');
      const dr = x.draft as unknown as ScanSaleDraft;
      if (dr.partnerId || !dr.buyer?.name) return;
      const r = await ensurePartner(tx, firm.id, { name: dr.buyer.name, edb: dr.buyer.edb, address: dr.buyer.address, city: dr.buyer.city, vatRegistered: /^MK/i.test(dr.buyer.edb || ''), type: 'customer' });
      const match: DraftPartnerMatch = { ...(dr.match ?? { idKind: '', id: dr.buyer.edb, candidates: [] }), by: r.created ? 'new' : 'exact', partner: { id: r.id, name: dr.buyer.name, code: r.code }, created: r.created, declined: false };
      await tx.update(aiDocuments).set({ drafts: d.drafts.map((y, k) => (k === index ? { ...y, draft: { ...y.draft, partnerId: r.id, match } } : y)) }).where(eq(aiDocuments.id, docId));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'scanBuyer', entityType: 'partner', entityId: r.id, data: { created: r.created, name: dr.buyer.name } });
    });
  } catch (e) { return actionError(e); }
  revalidatePath('/skan');
  revalidatePath('/izlez');
  return { ok: 'Купувачот е додаден.' };
}

/* ---------------- partner of a read document: pick a candidate, save its ЕДБ / ЕМБС, undo the automatic partner ---------------- */

class ScanErr extends Error {}
const scanErr = (e: unknown): ActionState => (e instanceof ScanErr ? { error: e.message } : actionError(e));
type AnyDraft = Record<string, unknown> & { partnerId?: string; match?: DraftPartnerMatch; buyer?: { name?: string; edb?: string }; supplierName?: string; supplierEdb?: string };
/** Name and identifier of the partner as read from the document (buyer of a sale, supplier of a purchase). */
const docParty = (d: AnyDraft) => (d.buyer ? { name: d.buyer.name ?? '', id: d.buyer.edb ?? '' } : { name: d.supplierName ?? '', id: d.supplierEdb ?? '' });

async function withDraft<T>(docId: string, index: number, fn: (tx: Parameters<typeof ensurePartner>[0], dr: AnyDraft, firmId: string, userId: string) => Promise<{ draft: AnyDraft; out: T }>): Promise<T> {
  const { u, firm } = await firmAction('write');
  return db().transaction(async (tx) => {
    const [d] = await tx.select().from(aiDocuments).where(and(eq(aiDocuments.id, docId), eq(aiDocuments.firmId, firm.id))).for('update').limit(1);
    const x = d?.drafts[index];
    if (!d || !x) throw new ScanErr('Документот не постои.');
    if (x.savedId) throw new ScanErr('Документот е веќе зачуван.');
    const r = await fn(tx, x.draft as AnyDraft, firm.id, u.id);
    await tx.update(aiDocuments).set({ drafts: d.drafts.map((y, k) => (k === index ? { ...y, draft: r.draft } : y)) }).where(eq(aiDocuments.id, docId));
    return r.out;
  });
}

const PickIn = z.object({ docId: z.uuid(), index: z.number().int().min(0).max(500), partnerId: z.uuid() });

/**
 * „Дали е ова: …“ — the user picked a candidate: the draft gets the partner and the partner learns the document's
 * name / ЕДБ / ЕМБС (`data.aliases`, `data.aliasIds`), so the next document matches at once. An ЕДБ / ЕМБС the
 * partner lacks is offered to be saved on it.
 */
export async function pickScanPartner(docId: string, index: number, partnerId: string): Promise<ActionState & { partner?: { id: string; name: string; code: string | null; edb: string | null }; offerId?: { kind: 'edb' | 'embs'; value: string } }> {
  try {
    const v = PickIn.parse({ docId, index, partnerId });
    const out = await withDraft(v.docId, v.index, async (tx, dr, firmId, userId) => {
      const [p] = await tx.select().from(partners).where(and(eq(partners.id, v.partnerId), eq(partners.firmId, firmId))).limit(1);
      if (!p) throw new ScanErr('Комитентот не постои.');
      const L = learnPartnerAlias(p, docParty(dr));
      if (L.changed) await tx.update(partners).set({ data: L.data }).where(eq(partners.id, p.id));
      await audit(tx, { userId, firmId, action: 'scanPickPartner', entityType: 'partner', entityId: p.id, data: { name: docParty(dr).name, learned: L.changed } });
      const m: DraftPartnerMatch = { ...(dr.match ?? { idKind: '', id: '', candidates: [] }), by: 'picked', partner: { id: p.id, name: p.name, code: p.code }, created: false, ...(L.saveId ? { offerId: L.saveId } : {}) };
      if (!L.saveId) delete m.offerId;
      return { draft: { ...dr, partnerId: p.id, match: m }, out: { partner: { id: p.id, name: p.name, code: p.code, edb: p.edb }, offerId: L.saveId } };
    });
    revalidatePath('/skan');
    return { ok: 'Комитентот е избран и запомнет.', ...out };
  } catch (e) {
    if (e instanceof z.ZodError) return { error: 'Неважечки податоци.' };
    return scanErr(e);
  }
}

/** Save the document's ЕДБ / ЕМБС on the picked partner (only when the partner has none). */
export async function saveScanPartnerId(docId: string, index: number): Promise<ActionState> {
  try {
    const v = PickIn.omit({ partnerId: true }).parse({ docId, index });
    const label = await withDraft(v.docId, v.index, async (tx, dr, firmId, userId) => {
      const o = dr.match?.offerId;
      if (!o || !dr.partnerId) return { draft: dr, out: '' };
      const [p] = await tx.select().from(partners).where(and(eq(partners.id, dr.partnerId), eq(partners.firmId, firmId))).limit(1);
      if (!p) throw new ScanErr('Комитентот не постои.');
      if (!(o.kind === 'edb' ? p.edb : p.embs)?.trim()) {
        await tx.update(partners).set(o.kind === 'edb' ? { edb: o.value, vatRegistered: /^MK/i.test(o.value) || p.vatRegistered } : { embs: o.value }).where(eq(partners.id, p.id));
        await audit(tx, { userId, firmId, action: 'scanPartnerId', entityType: 'partner', entityId: p.id, data: { [o.kind]: o.value } });
      }
      const { offerId: _o, ...m } = dr.match!;
      return { draft: { ...dr, match: m }, out: partnerIdLabel(o.kind) };
    });
    revalidatePath('/skan');
    return { ok: label ? `${label} е запишан кај комитентот.` : 'ok' };
  } catch (e) { return scanErr(e); }
}

/**
 * „откажи“ the partner created automatically from the document: deleted when nothing uses it yet (else only
 * unlinked); the draft then asks „Додај го како партнер“ instead of creating it again.
 */
export async function undoScanPartner(docId: string, index: number): Promise<ActionState> {
  try {
    const v = PickIn.omit({ partnerId: true }).parse({ docId, index });
    await withDraft(v.docId, v.index, async (tx, dr, firmId, userId) => {
      const pid = dr.partnerId;
      if (!dr.match?.created || !pid) return { draft: dr, out: null };
      let deleted = false;
      try {
        await tx.transaction(async (sp) => { await sp.delete(partners).where(and(eq(partners.id, pid), eq(partners.firmId, firmId))); });
        deleted = true;
      } catch { /* already used by a document: only unlinked */ }
      await audit(tx, { userId, firmId, action: 'scanUndoPartner', entityType: 'partner', entityId: pid, data: { deleted, name: docParty(dr).name } });
      const { partner: _p, ...m } = dr.match;
      return { draft: { ...dr, partnerId: '', match: { ...m, by: '', created: false, declined: true } }, out: null };
    });
    revalidatePath('/skan');
    revalidatePath('/izlez');
    return { ok: 'Автоматскиот комитент е откажан.' };
  } catch (e) { return scanErr(e); }
}

/**
 * Legacy `outSaveAll` (8439): save every read sales invoice that is „✓ спремна“ (past VAT periods are held; in a
 * services firm a draft whose only remarks are „нов купувач“ / unlinked lines counts as ready; cancelled / storno files
 * are never saved in bulk — `@wise/db` `saveReadyScanDrafts`).
 */
export async function saveSalesOk(scheme?: number | null): Promise<ActionState> {
  const sch = batchScheme(scheme);
  try {
    const { u, firm } = await firmAction('saveInv');
    const R = await saveReadyScanDrafts(db(), { firm, kind: 'sale', actor: actorOf(u), past: await pastPeriodContext(db(), firm), scheme: sch });
    const am = await autoMergeAfter(firm.id);
    revalidatePath('/', 'layout');
    return withNote(bulkSaveMessage('sale', R), am);
  } catch (e) { return actionError(e); }
}

/* ---------------- „⏸ За проверка – минат период“ ---------------- */

/** The owner / a user with the `fix` or `settings` right decides held documents (book-only colleagues only see them). */
async function pastDecider() {
  const { u, firm } = await firmAction('write');
  if (!canDecidePast(u.principal, firm.id, await isOfficeOwner(u))) throw new Forbidden('Само сопственикот или корисник со право „поправка“ / „поставки“ одлучува за документи од минат ДДВ период.');
  return { u, firm };
}

const revalidatePast = () => { for (const p of ['/skan', '/masovno', '/masovnoM', '/prist', '/ddv', '/vlez', '/izlez', '/nalozi']) revalidatePath(p); };

/**
 * „✓ Прокнижи во својот период“ (`own`, keeps the date — ДДВ-04 of that period must be corrected) or, for an incoming
 * invoice only, „Прокнижи со датум на прием во тековниот период“ (`receipt`). Audited `pastPost` / `pastRecv`.
 */
export async function confirmPastAction(docId: string, index: number, mode: 'own' | 'receipt', receiptDate?: string | null): Promise<ActionState> {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(docId) || !Number.isInteger(index) || index < 0 || (mode !== 'own' && mode !== 'receipt')) return { error: 'Неважечко барање.' };
    const { u, firm } = await pastDecider();
    const r = await db().transaction((tx) => confirmPastDraft(tx, { firm, docId, index, mode, receiptDate: receiptDate || null, actor: actorOf(u) }));
    revalidatePast();
    return { ok: mode === 'receipt'
      ? `Прокнижена со датум на прием ${dmy(r.date)} во тековниот ДДВ период (${vatPeriodName(r.period)}).`
      : `Прокнижена во ${r.hit?.text ?? vatPeriodName(r.period)}.${r.correction ? ' ДДВ-04 за тој период треба да се коригира – видете „Корекции на ДДВ-04 потребни“.' : ''}` };
  } catch (e) { return actionError(e); }
}

/** „✓ Прокнижи ги сите во својот период“: every held document (of `kind`) at once; the ones that cannot be posted are listed. */
export async function confirmAllPastAction(kind?: 'purchase' | 'sale', only?: string[]): Promise<ActionState> {
  try {
    if (kind !== undefined && kind !== 'purchase' && kind !== 'sale') return { error: 'Неважечко барање.' };
    if (only && (only.length > 2000 || only.some((x) => !/^[0-9a-f-]{36}:\d{1,4}$/i.test(x)))) return { error: 'Неважечки избор.' };
    const { u, firm } = await pastDecider();
    const r = await db().transaction((tx) => confirmAllPastDrafts(tx, { firm, kind, actor: actorOf(u), only }));
    revalidatePast();
    const bad = r.failed.length ? ` Не се прокнижени ${r.failed.length}: ${r.failed.slice(0, 5).map((f) => `${f.number} (${f.why})`).join('; ')}${r.failed.length > 5 ? '…' : ''}` : '';
    const msg = `Прокнижени ${r.posted} документи во својот период – ДДВ-04 за тие периоди треба да се коригира.${bad}`;
    return r.posted || !r.failed.length ? { ok: msg } : { error: msg };
  } catch (e) { return actionError(e); }
}

/** „✓ Прокнижи ги избраните“: the ticked held documents („docId:index“), each in its own period. */
export async function confirmSelectedPastAction(ids: string[]): Promise<ActionState> {
  if (!ids.length) return { error: 'Изберете документи (кутичката лево).' };
  return confirmAllPastAction(undefined, ids);
}

/** „✕ Отфрли“: the held draft is deleted. Audited `pastReject`. */
export async function rejectPastAction(docId: string, index: number): Promise<ActionState> {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(docId) || !Number.isInteger(index) || index < 0) return { error: 'Неважечко барање.' };
    const { u, firm } = await pastDecider();
    await db().transaction((tx) => rejectPastDraft(tx, { firmId: firm.id, docId, index, userId: u.id }));
    revalidatePast();
    return { ok: 'Документот е отфрлен.' };
  } catch (e) { return actionError(e); }
}

/** The firm setting (b) „Задржи ги сите документи од претходни ДДВ периоди“. */
export async function setPastHoldAction(on: boolean): Promise<ActionState> {
  try {
    const { u, firm } = await pastDecider();
    await db().transaction((tx) => setPastHold(tx, { firmId: firm.id, on: !!on, userId: u.id }));
    revalidatePast();
    return { ok: on ? 'Се задржуваат сите документи од претходни ДДВ периоди.' : 'Се задржуваат само документите од затворени (поднесени) ДДВ периоди.' };
  } catch (e) { return actionError(e); }
}
