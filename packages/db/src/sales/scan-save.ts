/**
 * Bulk save of read documents (legacy `batchSaveAll` 5376 / `outSaveAll` 8439): every draft whose check is `ok` is
 * saved and posted — each invoice its own document with its own journal, in its own transaction (savepoint).
 *
 * „⏸ Минат период – за проверка“ (`@wise/core/vat/past-period`): a draft whose VAT date is in a past VAT period (closed
 * / filed, earlier than today's period when the firm holds those, or locked) is NOT posted — it stays a draft with the
 * status `past` and the reason („ДДВ Q2/2026 (април–јуни), затворен“) for the owner's decision (`vat-past.ts`).
 */
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { ScanPurchaseDraft, ScanSaleDraft } from '@wise/core/sales';
import { draftVatDate, pastHoldMsg, pastPeriodOf, type PastPeriodCtx } from '@wise/core/vat/past-period';
import { audit, type Tx } from '../audit';
import { aiDocuments, fileLinks, files, items, type AiDocument, type AiDraft, type Firm } from '../schema/index';
import type { DocActor } from './context';
import { draftSourceFiles, markDraftSaved, purchaseInputFromDraft, releaseDeletedScanDrafts } from './ai-docs';
import { saveInvoice, type InvoiceInput } from './invoices';
import { ensurePartner } from './partners-auto';
import { savePurchase } from './purchases';

/** A read sales invoice as service input; the buyer is found or created (legacy `outEnsurePartner` 8408). */
/** (The source files are linked by the caller, `saveScanDraft`.) */
export async function saleInputFromDraft(tx: Tx, firmId: string, d: ScanSaleDraft): Promise<InvoiceInput> {
  let partnerId = d.partnerId || null;
  if (!partnerId && d.buyer?.name) partnerId = (await ensurePartner(tx, firmId, { name: d.buyer.name, edb: d.buyer.edb, address: d.buyer.address, city: d.buyer.city, vatRegistered: /^MK/i.test(d.buyer.edb || ''), type: 'customer' })).id;
  if (!partnerId) throw new Error('Изберете го купувачот.');
  return {
    // the number printed on the invoice: never a new one (a re-save after the invoice was deleted keeps it too)
    kind: 'invoice', number: d.number, date: d.date, pdate: d.date, due: d.due || null, partnerId, art32: d.art32, scanned: true, keepNumber: true,
    lines: d.items.map((l) => ({ itemId: l.itemId || null, name: l.name, unit: l.unit, qty: l.qty, price: l.price, disc: l.disc, rate: l.rate, account: l.konto })),
    // legal basis of an exempt invoice as printed and its kind (ЗДДВ чл. 24 → field 08, чл. 23 → 09) — kept and printed
    ...(d.vatNote && !d.art32 ? { data: { vatNote: d.vatNote.slice(0, 500), ...(d.vatExempt ? { vatExempt: d.vatExempt } : {}) } } : {}),
  };
}

/**
 * A read sales invoice whose VAT treatment is not decided: every line at 0 % with no art. 32-a and no exemption kind
 * (reads made before the VAT-note rule, or „провери: нема ДДВ – чл. 32-а или ослободување?“). Never saved in bulk.
 */
export const saleVatUnclear = (dr: Partial<ScanSaleDraft>): boolean =>
  !!dr.vatCheck || (!dr.art32 && !dr.vatExempt && !!dr.items?.length && dr.items.every((l) => !Number(l.rate)));

/** Save draft `i` of a read document as a purchase / an invoice and mark it saved (in the caller's transaction). */
export async function saveScanDraft(tx: Tx, firmId: string, d: AiDocument, i: number, actor: DocActor, over?: { date?: string; docDate?: string | null }, scheme?: number): Promise<string> {
  const x = d.drafts[i]!;
  if (d.kind === 'sale') {
    const src = draftSourceFiles(d, i).fileIds;
    const dr = { ...(x.draft as unknown as ScanSaleDraft), ...(over?.date ? { date: over.date } : {}) };
    const inp = await saleInputFromDraft(tx, firmId, dr);
    // „Шема“ chosen for the batch (numbered posting schemes)
    const r = await saveInvoice(tx, firmId, scheme ? { ...inp, data: { ...(inp.data ?? {}), scheme } } : inp, actor);
    if (src.length) await tx.insert(fileLinks).values(src.map((fileId) => ({ fileId, entityType: 'invoice', entityId: r.id, role: 'source' }))).onConflictDoNothing();
    await markDraftSaved(tx, firmId, d.id, i, r.id);
    return r.id;
  }
  const dr0 = x.draft as unknown as ScanPurchaseDraft;
  const dr = over ? { ...dr0, ...(over.date ? { date: over.date } : {}), ...(over.docDate !== undefined ? { docDate: over.docDate ?? '' } : {}) } : dr0;
  const pin = purchaseInputFromDraft(dr, draftSourceFiles(d, i));
  if (scheme) pin.data = { ...(pin.data ?? {}), scheme };
  const r = await savePurchase(tx, firmId, pin, actor);
  await markDraftSaved(tx, firmId, d.id, i, r.id);
  return r.id;
}

/** Replace draft `i` of a document (read again: an earlier invoice of the same file may have just been saved). */
export async function patchDraft(tx: Tx, docId: string, i: number, f: (x: AiDraft) => AiDraft): Promise<void> {
  const [cur] = await tx.select({ drafts: aiDocuments.drafts }).from(aiDocuments).where(eq(aiDocuments.id, docId)).limit(1);
  if (!cur) return;
  await tx.update(aiDocuments).set({ drafts: cur.drafts.map((y, k) => (k === i ? f(y) : y)) }).where(eq(aiDocuments.id, docId));
}

export interface BulkSaveResult { saved: number; total: number; dup: number; held: { number: string; text: string }[]; errs: string[] }

/**
 * „Зачувај ги сите спремни“: save every `ok` draft of the selected documents of `kind`. `past` = the firm's
 * past-period context (`pastPeriodContext`); a draft in a past VAT period is held (status `past`), never posted.
 */
export async function saveReadyScanDrafts(db: Tx, a: { firm: Pick<Firm, 'id'> & { vatRegistered?: boolean | null }; kind: 'purchase' | 'sale'; where?: SQL; actor: DocActor; past: PastPeriodCtx | null; scheme?: number }): Promise<BulkSaveResult> {
  // drafts whose purchase / invoice was deleted are saved again (with their own number), not left as „зачувано“
  await releaseDeletedScanDrafts(db, a.firm.id, [a.kind]);
  const docs = await db.select().from(aiDocuments).where(and(eq(aiDocuments.firmId, a.firm.id), eq(aiDocuments.kind, a.kind), eq(aiDocuments.status, 'done'), a.where));
  const R: BulkSaveResult = { saved: 0, total: 0, dup: 0, held: [], errs: [] };
  let ready = (x: AiDraft) => x.status === 'ok';
  let cancelled = (_d: AiDocument) => false;
  if (a.kind === 'sale') {
    // reads made before the services-firm rule: „ставки не се поврзани со артикл“ only matters where stock is kept,
    // so such a draft (with at most „нов купувач“ besides) counts as ready in a firm without goods in the codebook
    const [{ goods }] = (await db.select({ goods: sql<number>`count(*)::int` }).from(items)
      .where(and(eq(items.firmId, a.firm.id), eq(items.active, true), sql`${items.type} <> 'service'`))) as [{ goods: number }];
    // and a VAT firm's draft whose VAT treatment is unclear (чл. 32-а / ослободување со или без право на одбивка) never is
    const vatOk = (x: AiDraft) => a.firm.vatRegistered === false || !saleVatUnclear(x.draft as Partial<ScanSaleDraft>);
    ready = (x) => vatOk(x) && (x.status === 'ok' || (x.status === 'check' && !goods
      && String(x.msg ?? '').split(' · ').every((m) => !m || m.startsWith('нов купувач') || /ставки не се поврзани со артикл$/.test(m))));
    // a cancelled / storno invoice is never saved in bulk – it is registered and cancelled on purpose, one by one
    const fids = docs.map((d) => d.fileId).filter((x): x is string => !!x);
    const fname = new Map((fids.length ? await db.select({ id: files.id, name: files.name }).from(files).where(inArray(files.id, fids)) : []).map((f) => [f.id, f.name]));
    cancelled = (d) => /cancel|сторн|storn|откаж/i.test(fname.get(d.fileId ?? '') ?? '');
  }
  for (const d of docs) {
    if (cancelled(d)) continue;
    for (const [i, x] of d.drafts.entries()) {
      if (x.status === 'dup' && !x.savedId && !x.skipped) R.dup++;
      if (!ready(x) || x.savedId || x.skipped) continue;
      R.total++;
      const no = String((x.draft as { number?: string }).number ?? '?');
      const hit = a.past ? pastPeriodOf(draftVatDate(a.kind, x.draft as { date?: string; docDate?: string; shifted?: boolean }), a.past) : null;
      if (hit) {
        await patchDraft(db, d.id, i, (y) => ({ ...y, status: 'past', msg: pastHoldMsg(hit), past: { ...hit, heldAt: new Date().toISOString() } }));
        R.held.push({ number: no, text: hit.text });
        continue;
      }
      try {
        // the document as it is now (an earlier invoice of the same file may have just been saved)
        await db.transaction(async (tx) => {
          const [cur] = await tx.select().from(aiDocuments).where(eq(aiDocuments.id, d.id)).limit(1);
          await saveScanDraft(tx as unknown as Tx, a.firm.id, cur ?? d, i, a.actor, undefined, a.scheme);
        });
        R.saved++;
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        R.errs.push(`${no}: ${m}`);
        if (a.kind === 'purchase') await patchDraft(db, d.id, i, (y) => ({ ...y, status: 'check', msg: m || 'грешка' }));
      }
    }
  }
  if (R.held.length) {
    await audit(db, { userId: a.actor.userId, firmId: a.firm.id, action: 'pastHold', entityType: 'ai_document', data: { kind: a.kind, held: R.held.length, numbers: R.held.map((h) => h.number).slice(0, 50) } });
  }
  return R;
}

/** The result line of a bulk save. */
export function bulkSaveMessage(kind: 'purchase' | 'sale', R: BulkSaveResult): { ok?: string; error?: string } {
  const held = R.held.length ? ` ⏸ Задржани ${R.held.length} од минат ДДВ период – за проверка (${[...new Set(R.held.map((h) => h.text))].slice(0, 3).join('; ')}).` : '';
  const dup = kind === 'purchase' && R.dup ? ` Прескокнати ${R.dup} дупликати (веќе заведени).` : '';
  if (R.errs.length) return { error: `Зачувани ${R.saved} од ${R.total}; не се зачувани: ${R.errs.slice(0, 5).join('; ')}.${held}${dup}` };
  return { ok: kind === 'purchase' ? `${R.saved} фактури се прокнижени.${held}${dup}` : `Зачувани ${R.saved} од ${R.total} фактури.${held}` };
}
