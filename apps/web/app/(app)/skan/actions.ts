'use server';
/**
 * AI document reading — start / retry / remove reads and batch save (legacy `scanFile` 4649 → 13699, `batchRun`
 * 5357, `batchSaveAll` 5376, `outRun` 8415). The reading itself runs in the worker job `ai.read-document`.
 */
import { revalidatePath } from 'next/cache';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { ScanPurchaseDraft } from '@wise/core/sales';
import { aiDocuments, audit, fileAlreadyUsed, files, markDraftSaved, savePurchase, type PurchaseInput } from '@wise/db';
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
});

/** Register uploaded files for reading and enqueue one job per file. */
export async function startScans(input: z.input<typeof Start>): Promise<ActionState & { skipped?: string[] }> {
  try {
    const v = Start.parse(input);
    const { u, firm } = await firmAction('scan');
    const F = await db().select().from(files).where(and(eq(files.firmId, firm.id), inArray(files.id, v.fileIds), eq(files.status, 'ready')));
    const skipped: string[] = [];
    const ids: string[] = [];
    await db().transaction(async (tx) => {
      for (const f of F) {
        // Duplicate detection, second half: the same file (sha256) already attached to a document.
        const used = await fileAlreadyUsed(tx, firm.id, [f.id]);
        if (used) { skipped.push(`${f.name}: веќе е прикачен на ${used.entityType === 'purchase' ? 'влезна фактура' : 'излезна фактура'}`); continue; }
        const [d] = await tx.insert(aiDocuments).values({
          firmId: firm.id, fileId: f.id, kind: v.kind, batchId: v.batchId, createdBy: u.id,
          options: { cash: v.cash, warehouseId: v.warehouseId || null, costOnly: v.costOnly },
        }).returning({ id: aiDocuments.id });
        ids.push(d!.id);
      }
      await audit(tx, { userId: u.id, firmId: firm.id, action: 'scanStart', entityType: 'ai_document', data: { count: ids.length, kind: v.kind, batchId: v.batchId } });
    });
    for (const id of ids) await enqueue(AI_READ_DOCUMENT, { docId: id });
    revalidatePath('/skan');
    revalidatePath('/masovno');
    return { ok: `Се читаат ${ids.length} документи.`, skipped };
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
