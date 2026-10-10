'use server';
/**
 * AI document reading — start / retry / remove reads and batch save (legacy `scanFile` 4649 → 13699, `batchRun`
 * 5357, `batchSaveAll` 5376, `outRun` 8415). The reading itself runs in the worker job `ai.read-document`.
 */
import { revalidatePath } from 'next/cache';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ScanPurchaseDraft, ScanSaleDraft } from '@wise/core/sales';
import { aiDocuments, audit, ensurePartner, fileAlreadyUsed, fileLinks, files, markDraftSaved, saveInvoice, savePurchase, type PurchaseInput } from '@wise/db';
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
});

/** Register uploaded files for reading and enqueue one job per file. */
export async function startScans(input: z.input<typeof Start>): Promise<ActionState & { skipped?: string[]; ids?: string[] }> {
  try {
    const v = Start.parse(input);
    const { u, firm } = await firmAction('scan');
    const F = await db().select().from(files).where(and(eq(files.firmId, firm.id), inArray(files.id, v.fileIds), eq(files.status, 'ready')));
    const skipped: string[] = [];
    const ids: string[] = [];
    await db().transaction(async (tx) => {
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
    return { ok: `Се читаат ${ids.length} документи.`, skipped, ids };
  } catch (e) { return actionError(e); }
}

export async function retryScan(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('scan');
    await db().transaction(async (tx) => {
      await tx.update(aiDocuments).set({ status: 'queued', error: null }).where(and(eq(aiDocuments.id, id), eq(aiDocuments.firmId, firm.id)));
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

/** A reviewed purchase draft as service input (used by batch save). */
export async function draftToPurchase(d: ScanPurchaseDraft, fileId: string | null): Promise<PurchaseInput> {
  return {
    number: d.number, date: d.date, docDate: d.docDate || null, due: d.due || null, partnerId: d.partnerId || null,
    supplierName: d.supplierName, supplierEdb: d.supplierEdb, ptype: d.ptype, art32: d.art32, cash: d.cash, warehouseId: d.warehouseId,
    groups: d.groups.map((g) => ({ account: g.konto, rate: g.rate, base: g.base, vat: g.vat })),
    stock: d.stock.map((s) => ({ itemId: s.itemId || null, name: s.name, code: s.code, barcode: s.barcode, unit: s.unit, qty: s.qty, price: s.price, amount: s.amount, sp: s.sp === '' ? null : s.sp, type: s.type, rate: s.rate })),
    fileIds: fileId ? [fileId] : [], scanned: true,
  };
}

/** Save every draft of a batch whose check is `ok` (legacy `batchSaveAll`). Each purchase in its own transaction. */
export async function saveBatchOk(batchId: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('savePur');
    const docs = await db().select().from(aiDocuments).where(and(eq(aiDocuments.firmId, firm.id), eq(aiDocuments.batchId, batchId), eq(aiDocuments.kind, 'purchase'), eq(aiDocuments.status, 'done')));
    let n = 0;
    const errs: string[] = [];
    for (const d of docs) {
      for (const [i, x] of d.drafts.entries()) {
        if (x.status !== 'ok' || x.savedId) continue;
        try {
          await db().transaction(async (tx) => {
            const r = await savePurchase(tx, firm.id, await draftToPurchase(x.draft as unknown as ScanPurchaseDraft, d.fileId), actorOf(u));
            await markDraftSaved(tx, firm.id, d.id, i, r.id);
          });
          n++;
        } catch (e) {
          errs.push(`${(x.draft as { number?: string }).number ?? '?'}: ${e instanceof Error ? e.message : String(e)}`);
          await db().update(aiDocuments).set({ drafts: d.drafts.map((y, k) => (k === i ? { ...y, status: 'check' as const, msg: e instanceof Error ? e.message : 'грешка' } : y)) }).where(eq(aiDocuments.id, d.id));
        }
      }
    }
    revalidatePath('/', 'layout');
    return errs.length ? { error: `Зачувани ${n}; не се зачувани: ${errs.slice(0, 5).join('; ')}` } : { ok: `${n} фактури се прокнижени.` };
  } catch (e) { return actionError(e); }
}

export interface ScanState { id: string; kind: string; status: string; error: string | null; batchId: string | null; drafts: { draft: Record<string, unknown>; status: string; msg: string; savedId?: string }[] }

/** Poll reads started from the scan screen or an editor (legacy `stage()` progress + `scanFile` result). */
export async function scanStatus(ids: string[]): Promise<ScanState[]> {
  const ok = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 100);
  if (!ok.length) return [];
  const { firm } = await firmAction('scan');
  const D = await db().select().from(aiDocuments).where(and(eq(aiDocuments.firmId, firm.id), inArray(aiDocuments.id, ok)));
  return D.map((d) => ({ id: d.id, kind: d.kind, status: d.status, error: d.error, batchId: d.batchId, drafts: d.status === 'done' || d.status === 'saved' ? d.drafts : [] }));
}

/** An editor took over the read result (legacy `readIntoDraft`): mark the read as used. */
export async function scanTaken(id: string): Promise<ActionState> {
  try {
    const { u, firm } = await firmAction('scan');
    await db().transaction(async (tx) => {
      await tx.update(aiDocuments).set({ status: 'saved' }).where(and(eq(aiDocuments.id, id), eq(aiDocuments.firmId, firm.id)));
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'scanIntoDraft', entityType: 'ai_document', entityId: id });
    });
    return { ok: 'ok' };
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
async function saleDraftToInvoice(tx: Parameters<typeof ensurePartner>[0], firmId: string, d: ScanSaleDraft, fileId: string | null) {
  let partnerId = d.partnerId || null;
  if (!partnerId && d.buyer.name) partnerId = (await ensurePartner(tx, firmId, { name: d.buyer.name, edb: d.buyer.edb, address: d.buyer.address, city: d.buyer.city, vatRegistered: /^MK/i.test(d.buyer.edb || ''), type: 'customer' })).id;
  if (!partnerId) throw new Error('Изберете го купувачот.');
  return {
    kind: 'invoice' as const, number: d.number, date: d.date, pdate: d.date, due: d.due || null, partnerId, art32: d.art32, scanned: true,
    lines: d.items.map((l) => ({ itemId: l.itemId || null, name: l.name, unit: l.unit, qty: l.qty, price: l.price, disc: l.disc, rate: l.rate, account: l.konto })),
    fileIds: fileId ? [fileId] : [],
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
        if (x.status !== 'ok' || x.savedId) continue;
        tot++;
        try {
          await db().transaction(async (tx) => {
            const inp = await saleDraftToInvoice(tx, firm.id, x.draft as unknown as ScanSaleDraft, d.fileId);
            const r = await saveInvoice(tx, firm.id, inp, actorOf(u));
            if (d.fileId) await tx.insert(fileLinks).values({ fileId: d.fileId, entityType: 'invoice', entityId: r.id, role: 'source' }).onConflictDoNothing();
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
