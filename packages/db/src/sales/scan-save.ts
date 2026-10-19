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
import { draftSourceFiles, loadAiDocument, markDraftSaved, purchaseInputFromDraft, releaseDeletedScanDrafts } from './ai-docs';
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
  // scanned inside an opened nalog: the document is posted into that nalog
  const nalogNo = String(((d.options ?? {}) as { nalogNo?: string }).nalogNo ?? '').trim();
  if (d.kind === 'sale') {
    const src = draftSourceFiles(d, i).fileIds;
    const dr = { ...(x.draft as unknown as ScanSaleDraft), ...(over?.date ? { date: over.date } : {}) };
    const inp0 = await saleInputFromDraft(tx, firmId, dr);
    const inp = nalogNo ? { ...inp0, data: { ...(inp0.data ?? {}), nalogNo } } : inp0;
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
  if (nalogNo) pin.data = { ...(pin.data ?? {}), nalogNo };
  const r = await savePurchase(tx, firmId, pin, actor);
  await markDraftSaved(tx, firmId, d.id, i, r.id);
  return r.id;
}

/**
 * „✓ Прокнижи ги избраните“ on the „За физичка проверка“ list: the ticked reads („docId:index“) are saved as they are —
 * after the user checked them against the paper — each in its own savepoint and in its own period (no past-period
 * hold: the user decided). A read buyer that is not a partner yet is added. Refused (listed with the reason, the
 * others go on): no lines / zero total, an unclear VAT treatment, a closed / locked period, a used number.
 */
export async function saveSelectedScanDrafts(tx: Tx, a: { firmId: string; kind: 'sale' | 'purchase'; ids: readonly string[]; actor: DocActor }): Promise<{ saved: number; failed: { number: string; why: string }[] }> {
  let saved = 0;
  const failed: { number: string; why: string }[] = [];
  for (const key of a.ids) {
    const [docId, ix] = key.split(':');
    const i = Number(ix);
    let number = key;
    try {
      await tx.transaction(async (s) => {
        const t = s as unknown as Tx;
        const d = await loadAiDocument(t, a.firmId, docId!);
        const x = d.drafts[i];
        if (d.kind !== a.kind || !x) throw new Error('не е во листата');
        const dr = x.draft as unknown as ScanSaleDraft & ScanPurchaseDraft;
        number = String(dr.number ?? '') || key;
        if (x.savedId) throw new Error('веќе е зачувана');
        if (x.skipped && (x.archived || x.status !== 'skip')) throw new Error('прескокната / во архива – прво „Врати“');
        if (a.kind === 'sale') {
          if (!dr.items?.length || !Number(dr.total ?? 1)) throw new Error('нема ставки / износ 0 – не е фактура');
          if (saleVatUnclear(dr)) throw new Error('нејасен ДДВ (ослободување / 32-а) – отворете „Провери“');
          if (!dr.partnerId && dr.buyer?.name) {
            const r = await ensurePartner(t, a.firmId, { name: dr.buyer.name, edb: dr.buyer.edb, address: dr.buyer.address, city: dr.buyer.city, vatRegistered: /^MK/i.test(dr.buyer.edb || ''), type: 'customer' });
            await patchDraft(t, d.id, i, (y) => ({ ...y, draft: { ...y.draft, partnerId: r.id } }));
          }
        }
        // posted from the check list: the approval IS the check on paper – it goes straight to „Проверени“ (no second
        // click); a read the program put aside as „not an invoice“ (испратница / профактура) — the user checked it is one
        const at = new Date().toISOString();
        await patchDraft(t, d.id, i, (y) => ({ ...y, status: 'ok', skipped: undefined, review: true, checkedAt: at }));
        await saveScanDraft(t, a.firmId, await loadAiDocument(t, a.firmId, d.id), i, a.actor);
        await audit(t, { userId: a.actor.userId, firmId: a.firmId, action: 'scanSaveChecked', entityType: 'ai_document', entityId: d.id, data: { index: i, number } });
      });
      saved++;
    } catch (e) {
      failed.push({ number, why: e instanceof Error ? e.message : String(e) });
    }
  }
  return { saved, failed };
}

/** „✓ Проверено“: the posted reads („docId:index“) were checked against the paper documents (`checkedAt`); `undo` takes it back. */
export async function markScanDraftsChecked(tx: Tx, a: { firmId: string; ids: readonly string[]; userId: string | null; undo?: boolean }): Promise<number> {
  let n = 0;
  const at = new Date().toISOString();
  for (const key of a.ids) {
    const [docId, ix] = key.split(':');
    const d = await loadAiDocument(tx, a.firmId, docId!);
    const x = d.drafts[Number(ix)];
    if (!x?.savedId || !x.review) continue;
    await patchDraft(tx, d.id, Number(ix), (y) => ({ ...y, checkedAt: a.undo ? undefined : at }));
    n++;
  }
  if (n) await audit(tx, { userId: a.userId, firmId: a.firmId, action: a.undo ? 'scanUncheck' : 'scanChecked', entityType: 'ai_document', data: { n, ids: a.ids.slice(0, 200) } });
  return n;
}

/**
 * „📁 Само за архива“: the reads („docId:index“) are checked and not posted (cancelled, not an invoice, entered elsewhere):
 * skipped and marked `archived` — the file stays in the archive and on the check list; `undo` („Врати“) puts them back.
 */
export async function archiveScanDrafts(tx: Tx, a: { firmId: string; ids: readonly string[]; userId: string | null; undo?: boolean }): Promise<number> {
  let n = 0;
  const at = new Date().toISOString();
  for (const key of a.ids) {
    const [docId, ix] = key.split(':');
    const d = await loadAiDocument(tx, a.firmId, docId!);
    const x = d.drafts[Number(ix)];
    if (!x || x.savedId) continue;
    await patchDraft(tx, d.id, Number(ix), (y) => (a.undo ? { ...y, skipped: undefined, archived: undefined } : { ...y, skipped: true, archived: at }));
    n++;
  }
  if (n) await audit(tx, { userId: a.userId, firmId: a.firmId, action: a.undo ? 'scanUnarchive' : 'scanArchive', entityType: 'ai_document', data: { n, ids: a.ids.slice(0, 200) } });
  return n;
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
