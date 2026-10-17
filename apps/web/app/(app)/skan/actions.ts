'use server';
/**
 * AI document reading — start / retry / remove reads and batch save (legacy `scanFile` 4649 → 13699, `batchRun`
 * 5357, `batchSaveAll` 5376, `outRun` 8415). The reading itself runs in the worker job `ai.read-document`.
 */
import { revalidatePath } from 'next/cache';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ScanPurchaseDraft, ScanSaleDraft } from '@wise/core/sales';
import { aiDocuments, audit, draftSourceFiles, ensurePartner, fileAlreadyUsed, fileLinks, files, markDraftSaved, purchaseInputFromDraft, saveInvoice, savePurchase, skipDraft } from '@wise/db';
import { actionError, firmAction, type ActionState } from '@/lib/books';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/jobs';
import { actorOf } from '@/lib/sales';

const AI_READ_DOCUMENT = 'ai.read-document';

const Start = z.object({
  fileIds: z.array(z.uuid()).min(1).max(100),
  kind: z.enum(['purchase', 'sale']),
  batchId: z.uuid().nullable(),
  cash: z.boolean().default(false), warehouseId: z.string().max(40).default(''), costOnly: z.boolean().default(false),
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
          options: { cash: v.cash, warehouseId: v.warehouseId || null, costOnly: v.costOnly, extraFileIds: F.slice(1).map((f) => f.id), ...(v.inline ? { inline: true } : {}) },
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
          options: { cash: v.cash, warehouseId: v.warehouseId || null, costOnly: v.costOnly, ...(v.inline ? { inline: true } : {}) },
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
 * Duplicates (`dup`), invoices to check and skipped ones are left as they are.
 */
async function savePurchaseDraftsOk(where: Parameters<typeof and>[0]): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('savePur');
    const docs = await db().select().from(aiDocuments).where(and(eq(aiDocuments.firmId, firm.id), eq(aiDocuments.kind, 'purchase'), eq(aiDocuments.status, 'done'), where));
    let n = 0, dup = 0;
    const errs: string[] = [];
    for (const d of docs) {
      for (const [i, x] of d.drafts.entries()) {
        if (x.status === 'dup' && !x.savedId && !x.skipped) dup++;
        if (x.status !== 'ok' || x.savedId || x.skipped) continue;
        try {
          await db().transaction(async (tx) => {
            const r = await savePurchase(tx, firm.id, purchaseInputFromDraft(x.draft as unknown as ScanPurchaseDraft, draftSourceFiles(d, i)), actorOf(u));
            await markDraftSaved(tx, firm.id, d.id, i, r.id);
          });
          n++;
        } catch (e) {
          errs.push(`${(x.draft as { number?: string }).number ?? '?'}: ${e instanceof Error ? e.message : String(e)}`);
          // the document as it is now (an earlier invoice of the same file may have just been saved)
          const [cur] = await db().select({ drafts: aiDocuments.drafts }).from(aiDocuments).where(eq(aiDocuments.id, d.id)).limit(1);
          const D = cur?.drafts ?? d.drafts;
          await db().update(aiDocuments).set({ drafts: D.map((y, k) => (k === i ? { ...y, status: 'check' as const, msg: e instanceof Error ? e.message : 'грешка' } : y)) }).where(eq(aiDocuments.id, d.id));
        }
      }
    }
    revalidatePath('/', 'layout');
    const dupMsg = dup ? ` Прескокнати ${dup} дупликати (веќе заведени).` : '';
    return errs.length ? { error: `Зачувани ${n}; не се зачувани: ${errs.slice(0, 5).join('; ')}${dupMsg}` } : { ok: `${n} фактури се прокнижени.${dupMsg}` };
  } catch (e) { return actionError(e); }
}

/** Save every draft of a batch whose check is `ok` (legacy `batchSaveAll`). */
export async function saveBatchOk(batchId: string): Promise<ActionState> {
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) return { error: 'Неважечка листа.' };
  return savePurchaseDraftsOk(eq(aiDocuments.batchId, batchId));
}

/** „Зачувај ги сите спремни“ on the scan screen: every ready invoice read there (one file may hold several). */
export async function savePurchasesOk(): Promise<ActionState> {
  return savePurchaseDraftsOk(and(sql`${aiDocuments.batchId} is null`, sql`not (${aiDocuments.options} ? 'inline')`));
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
  revalidatePath('/masovno');
  return { ok: skip ? 'Фактурата е прескокната.' : 'Фактурата е вратена.' };
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

/** A read sales invoice as service input; the buyer is found or created (legacy `outEnsurePartner` 8408). */
async function saleDraftToInvoice(tx: Parameters<typeof ensurePartner>[0], firmId: string, d: ScanSaleDraft, fileIds: string[]) {
  let partnerId = d.partnerId || null;
  if (!partnerId && d.buyer.name) partnerId = (await ensurePartner(tx, firmId, { name: d.buyer.name, edb: d.buyer.edb, address: d.buyer.address, city: d.buyer.city, vatRegistered: /^MK/i.test(d.buyer.edb || ''), type: 'customer' })).id;
  if (!partnerId) throw new Error('Изберете го купувачот.');
  return {
    kind: 'invoice' as const, number: d.number, date: d.date, pdate: d.date, due: d.due || null, partnerId, art32: d.art32, scanned: true,
    lines: d.items.map((l) => ({ itemId: l.itemId || null, name: l.name, unit: l.unit, qty: l.qty, price: l.price, disc: l.disc, rate: l.rate, account: l.konto })),
    fileIds,
  };
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
      await tx.update(aiDocuments).set({ drafts: d.drafts.map((y, k) => (k === index ? { ...y, draft: { ...y.draft, partnerId: r.id } } : y)) }).where(eq(aiDocuments.id, docId));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'scanBuyer', entityType: 'partner', entityId: r.id, data: { created: r.created, name: dr.buyer.name } });
    });
  } catch (e) { return actionError(e); }
  revalidatePath('/skan');
  revalidatePath('/izlez');
  return { ok: 'Купувачот е додаден.' };
}

/** Legacy `outSaveAll` (8439): save every read sales invoice that is „✓ спремна“. */
export async function saveSalesOk(): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('saveInv');
    const docs = await db().select().from(aiDocuments).where(and(eq(aiDocuments.firmId, firm.id), eq(aiDocuments.kind, 'sale'), eq(aiDocuments.status, 'done')));
    let n = 0, tot = 0;
    const errs: string[] = [];
    for (const d of docs) {
      for (const [i, x] of d.drafts.entries()) {
        if (x.status !== 'ok' || x.savedId || x.skipped) continue;
        tot++;
        try {
          await db().transaction(async (tx) => {
            // the source file (photos read together: the photos of this invoice's pages) linked to each invoice
            const src = draftSourceFiles(d, i).fileIds;
            const inp = await saleDraftToInvoice(tx, firm.id, x.draft as unknown as ScanSaleDraft, src);
            const r = await saveInvoice(tx, firm.id, inp, actorOf(u));
            if (src.length) await tx.insert(fileLinks).values(src.map((fileId) => ({ fileId, entityType: 'invoice', entityId: r.id, role: 'source' }))).onConflictDoNothing();
            await markDraftSaved(tx, firm.id, d.id, i, r.id);
          });
          n++;
        } catch (e) { errs.push(`${(x.draft as { number?: string }).number ?? '?'}: ${e instanceof Error ? e.message : String(e)}`); }
      }
    }
    revalidatePath('/', 'layout');
    return errs.length ? { error: `Зачувани ${n} од ${tot} фактури. ${errs.slice(0, 5).join('; ')}` } : { ok: `Зачувани ${n} од ${tot} фактури.` };
  } catch (e) { return actionError(e); }
}
